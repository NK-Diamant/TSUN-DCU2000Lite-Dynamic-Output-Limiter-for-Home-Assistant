// ==========================================
// CONFIG
// ==========================================
let entity_tsun_output = "sensor.shelly1pmminig3_e4b32329a0e8_leistung"; // Dein Echtzeit-Sensor
let entity_slider = "input_number.wunsch_einspeisung"; // Dein Slider für den Nacht-Festwert
let entity_puffer = "input_number.netz_puffer"; // Dein Slider für den Netz-Puffer
let entity_debug = "input_number.act_power_debug"; // Debug Sensor
// ==========================================

// 1. DER DEPLOY-SCHUTZSCHILD: Prüfe, ob Home Assistant überhaupt schon wach ist
let ha_bereit = global.get('homeassistant.homeAssistant.states');
if (!ha_bereit || !ha_bereit[entity_tsun_output]) {
  // act_power auf 1.0 gesetzt, damit der TSUN beim Deploy nicht mehr hüpft!
  msg.payload = {
    "sys": { "mac": "C049EFC02345", "unixtime": Math.floor(Date.now() / 1000) },
    "em1:0": { "id": 0, "current": 0.0, "voltage": 230.15, "act_power": 1.0, "aprt_power": 5.0, "pf": 0.98, "freq": 50.01, "calibration": "factory" },
    "em1data:0": { "id": 0, "total_act_energy": 12345.67, "total_act_ret_energy": 0.00 },
    "switch:0": { "id": 0, "output": true }
  };
  msg.headers = { "Content-Type": "application/json" };
  return msg;
}

// AB HIER SIND DIE DATEN GARANTIERT DA:
let modus = flow.get('tsun_modus') || 'dyn';
let formatiertePower = 0.0;
let roh_target = 0.0;
let soll_wert = 0.0;
let roh_differenz = 0.0;
let umschalt_schutz_aktiv = false;

// Sicherer Abruf des Live-Zustands mit Fallback auf letzten gültigen Wert
let raw = ha_bereit[entity_tsun_output]?.state;
let aktuelle_einspeisung;
if (raw && raw !== 'unavailable' && raw !== 'unknown') {
  aktuelle_einspeisung = Math.abs(parseFloat(raw) || 0.0);
  context.set('letzte_gueltige_einspeisung', aktuelle_einspeisung);
} else {
  aktuelle_einspeisung = context.get('letzte_gueltige_einspeisung') || 0.0;
}

// Sicherer Abruf des Sliders mit Fallback auf letzten gültigen Wert
let raw_slider = ha_bereit[entity_slider]?.state;
let slider_wert;
if (raw_slider && raw_slider !== 'unavailable' && raw_slider !== 'unknown') {
  slider_wert = parseFloat(raw_slider) || 0.0;
  context.set('letzter_gueltiger_slider', slider_wert);
} else {
  slider_wert = context.get('letzter_gueltiger_slider') || 0.0;
}

// =================================================================================
// INTELLIGENTE UMSCHALT-KUPPLUNG (3 SEKUNDEN HALTEZEIT BEIM MODUSWECHSEL)
// =================================================================================
let letzter_modus = context.get('tsun_letzter_modus') || modus;
let umschalt_timer = context.get('tsun_umschalt_timer') || 0;

if (modus !== letzter_modus) {
  umschalt_timer = 3;
  context.set('tsun_letzter_modus', modus);
  context.set('tsun_letztes_act_power', 1.0);
}

if (umschalt_timer > 0) {
  umschalt_schutz_aktiv = true;
  formatiertePower = 1.0;
  umschalt_timer--;
  context.set('tsun_umschalt_timer', umschalt_timer);
  if (aktuelle_einspeisung > 10) {
    context.set('tsun_rampe_letzter_wert', aktuelle_einspeisung);
  }
}

// =================================================================================
// HIER LÄUFT DIE NORMALE REGLERLOGIK (WIRD WÄHREND DER KUPPLUNG ÜBERSPRUNGEN)
// =================================================================================
if (!umschalt_schutz_aktiv) {

  if (modus === 'dyn') {
    let raw_hausverbrauch = flow.get('hausverbrauch_gebremst');
    let hausverbrauch;
    if (raw_hausverbrauch !== null && raw_hausverbrauch !== undefined) {
      hausverbrauch = parseFloat(raw_hausverbrauch) || 0.0;
      context.set('letzter_gueltiger_hausverbrauch', hausverbrauch);
    } else {
      hausverbrauch = context.get('letzter_gueltiger_hausverbrauch') || slider_wert || 0.0;
    }
    roh_target = hausverbrauch > 800.0 ? 800.0 : hausverbrauch;
  } else {
    roh_target = slider_wert + 10.0;
  }

  let letzter_gesendeter_wert = context.get('tsun_rampe_letzter_wert');
  if (letzter_gesendeter_wert === undefined) {
    letzter_gesendeter_wert = aktuelle_einspeisung;
  }

  let max_aenderung_pro_sekunde = 10.0;
  let abweichung_zur_stufe = roh_target - letzter_gesendeter_wert;
  let rampen_ziel = letzter_gesendeter_wert;

  if (abweichung_zur_stufe > max_aenderung_pro_sekunde) {
    rampen_ziel += max_aenderung_pro_sekunde;
  } else if (abweichung_zur_stufe < -max_aenderung_pro_sekunde) {
    rampen_ziel -= max_aenderung_pro_sekunde;
  } else {
    rampen_ziel = roh_target;
  }

  context.set('tsun_rampe_letzter_wert', rampen_ziel);
  soll_wert = rampen_ziel;

  let netz_puffer = parseFloat(ha_bereit[entity_puffer]?.state || 0.0);

  if (modus === 'dyn') {
    roh_differenz = (soll_wert - netz_puffer) - aktuelle_einspeisung;
  } else {
    roh_differenz = soll_wert - aktuelle_einspeisung;
  }

  let hysterese_fenster = Math.max(10.0, soll_wert * 0.04);
  let letztes_act_power = context.get('tsun_letztes_act_power') || 1.0;

  if (Math.abs(roh_differenz) < hysterese_fenster) {
    formatiertePower = 1.0;
  } else if (roh_differenz > 0) {
    let schritt = Math.abs(roh_differenz) < 40.0 ? 5.0 : 10.0;
    formatiertePower = parseFloat(Math.min(letztes_act_power + schritt, roh_differenz).toFixed(2));
  } else {
    let schritt = Math.abs(roh_differenz) < 40.0 ? 5.0 : 10.0;
    formatiertePower = parseFloat(Math.max(letztes_act_power - schritt, roh_differenz).toFixed(2));
  }

  context.set('tsun_letztes_act_power', formatiertePower);
}

// Physikalische Derivate berechnen
let voltage = 230.15;
let current = parseFloat((Math.abs(formatiertePower / voltage)).toFixed(2));
let pf = 0.98;
let grid_freq = 50.01;

let scheinLeistung = Math.abs(formatiertePower) > 0 ? parseFloat((Math.abs(formatiertePower / pf)).toFixed(2)) : 5.00;
let festerZaehlerstand = 12345.67;
let aktuelleUnixzeit = Math.floor(Date.now() / 1000);

// Das originale, einphasige Shelly Pro EM JSON
msg.payload = {
  "sys": { "mac": "C049EFC02345", "unixtime": aktuelleUnixzeit },
  "em1:0": {
    "id": 0, "current": current, "voltage": voltage,
    "act_power": formatiertePower,
    "aprt_power": scheinLeistung,
    "pf": pf, "freq": grid_freq, "calibration": "factory"
  },
  "em1data:0": { "id": 0, "total_act_energy": festerZaehlerstand, "total_act_ret_energy": 0.00 },
  "switch:0": { "id": 0, "output": true }
};

// DIAGNOSE-BLOCK
msg.payload.diagnose = {
  "gewaehlter_modus": modus,
  "umschalt_kupplung_aktiv": umschalt_schutz_aktiv,
  "kupplung_restzeit_sekunden": umschalt_timer,
  "eingestellter_netz_puffer_watt": parseFloat(ha_bereit[entity_puffer]?.state || 0.0),
  "treppenstufe_ziel_ha": flow.get('hausverbrauch_gebremst'),
  "rampe_aktueller_soll_wert": umschalt_schutz_aktiv ? "GEFROREN" : soll_wert,
  "aktuelle_einspeisung_live_flackernd": aktuelle_einspeisung,
  "sensor_status": raw || "unavailable",
  "slider_status": raw_slider || "unavailable",
  "dynamisches_hysterese_fenster_watt": Math.max(10.0, soll_wert * 0.04),
  "unbearbeitete_roh_differenz": roh_differenz,
  "letztes_act_power_vor_berechnung": context.get('tsun_letztes_act_power'),
  "ausgegebenes_json_act_power": formatiertePower
};

msg.headers = { "Content-Type": "application/json" };

// =================================================================================
// DEBUG: Nur schreiben wenn Debug-Schalter aktiv ist
// =================================================================================
let debug_aktiv = ha_bereit["input_boolean.debug_modus"]?.state === "on";

// if (debug_aktiv) {
//   fetch('http://supervisor/core/api/states/input_number.act_power_debug', {
//     method: 'POST',
//     headers: {
//       'Authorization': 'Bearer ' + global.get('homeassistant.hassioToken'),
//       'Content-Type': 'application/json'
//     },
//     body: JSON.stringify({ state: formatiertePower })
//   });
// }

return msg;
