// ==========================================
// CONFIG: Bitte trage hier deine echten HA-Entity-Namen ein!
// ==========================================
let entity_tsun_output = "sensor.shelly1pmminig3_e4b32329a0e8_leistung"; // Dein Echtzeit-Sensor
let entity_slider = "input_number.wunsch_einspeisung"; // Dein Slider für den Nacht-Festwert
// ==========================================

// 1. DER DEPLOY-SCHUTZSCHILD: Prüfe, ob Home Assistant überhaupt schon wach ist
let ha_bereit = global.get('homeassistant.homeAssistant.states');
if (!ha_bereit || !ha_bereit[entity_tsun_output]) {
  // DEIN CODESIEG: act_power auf 1.0 gesetzt, damit der TSUN beim Deploy nicht mehr hüpft!
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
let soll_wert = 0.0;
let roh_differenz = 0.0;

// Sicherer Abruf des Live-Zustands ohne Absturzrisiko
let aktuelle_einspeisung = Math.abs(parseFloat(ha_bereit[entity_tsun_output].state) || 0.0);

if (modus === 'dyn') {
  // =================================================================================
  // MODUS A: DYNAMISCH (TAG) -> MIT 800W-KAPPUNG, 10W-RAMPE UND %-HYSTERESE
  // =================================================================================
  let treppenstufe_roh = parseFloat(flow.get('hausverbrauch_gebremst')) || parseFloat(ha_bereit[entity_slider].state) || 0.0;
  let treppenstufe_ziel = treppenstufe_roh > 800.0 ? 800.0 : treppenstufe_roh;
  let netz_puffer = parseFloat(ha_bereit["input_number.netz_puffer"]?.state || 0.0);

  let letzter_gesendeter_wert = context.get('tsun_rampe_letzter_wert') || aktuelle_einspeisung;
  let max_aenderung_pro_sekunde = 10.0;
  let abweichung_zur_stufe = treppenstufe_ziel - letzter_gesendeter_wert;

  let rampen_ziel = letzter_gesendeter_wert;

  if (abweichung_zur_stufe > max_aenderung_pro_sekunde) {
    rampen_ziel += max_aenderung_pro_sekunde;
  } else if (abweichung_zur_stufe < -max_aenderung_pro_sekunde) {
    rampen_ziel -= max_aenderung_pro_sekunde;
  } else {
    rampen_ziel = treppenstufe_ziel;
  }

  context.set('tsun_rampe_letzter_wert', rampen_ziel);

  soll_wert = rampen_ziel;
  roh_differenz = (soll_wert - netz_puffer) - aktuelle_einspeisung;

  // Berechne das Hysteresefenster dynamisch (4% vom aktuellen Sollwert, mindestens 10W)
  let hysterese_fenster = Math.max(10.0, soll_wert * 0.04);

  // DEIN CODESIEG: Wenn wir nah genug dran sind, senden wir 1.0 statt 0.0.
  // Das gibt dem TSUN den perfekten "Gegendruck", um ohne Nachgeben oder Hüpfen auf der Stufe zu parken!
  if (Math.abs(roh_differenz) < hysterese_fenster) {
    formatiertePower = 1.0;
  } else {
    let daempfungs_faktor = 0.6;
    formatiertePower = parseFloat((roh_differenz * daempfungs_faktor).toFixed(2));
  }

} else {
  // =================================================================================
  // MODUS B: FESTWERT (NACHT) -> Ungebremster Volldampf mit +10W Offset
  // =================================================================================
  let slider_wert = parseFloat(ha_bereit[entity_slider].state) || 0.0;
  soll_wert = slider_wert + 10.0;
  roh_differenz = soll_wert - aktuelle_einspeisung;

  let hysterese_fenster = Math.max(10.0, soll_wert * 0.04);

  // DEIN CODESIEG: Auch nachts stabiler Halt auf 1.0 ohne Absacken
  if (Math.abs(roh_differenz) < hysterese_fenster) {
    formatiertePower = 1.0;
  } else {
    let daempfungs_faktor = 1.0;
    if (Math.abs(roh_differenz) < 40.0) {
      daempfungs_faktor = 0.5;
    }
    formatiertePower = parseFloat((roh_differenz * daempfungs_faktor).toFixed(2));
  }

  context.set('tsun_rampe_letzter_wert', undefined);
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

// DIAGNOSE-BLOCK (Zeigt alle Zustände und deine 1.0er Live im Browser-JSON)
msg.payload.diagnose = {
  "gewaehlter_modus": modus,
  "eingestellter_netz_puffer_watt": parseFloat(ha_bereit["input_number.netz_puffer"]?.state || 0.0),
  "treppenstufe_ziel_ha": flow.get('hausverbrauch_gebremst'),
  "rampe_aktueller_soll_wert": soll_wert,
  "aktuelle_einspeisung_live_flackernd": aktuelle_einspeisung,
  "dynamisches_hysterese_fenster_watt": Math.max(10.0, soll_wert * 0.04),
  "unbearbeitete_roh_differenz": roh_differenz,
  "ausgegebenes_json_act_power": formatiertePower
};

msg.headers = { "Content-Type": "application/json" };
return msg;
