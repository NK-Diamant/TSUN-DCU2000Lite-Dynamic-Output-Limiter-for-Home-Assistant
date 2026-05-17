# TSUN DCU2000Lite Dynamic Output Limiter 🔋☀️

Ein intelligenter, materialschonender Regelkreis für Node-RED und Home Assistant, um die träge Regelung von **TSUN-Speichersystemen (SolarCan / DCU2000lite / Gen3-Wechselrichter)** zu zähmen. 

Dieses Tool emuliert ein einphasiges Shelly Pro EM Datenprotokoll und löst die hardwarebedingten Schwingungsprobleme des TSUN-Zählermodus ("Leistung") rein über Software-Mathematik. Es bietet eine **weiche Nulleinspeisung am Tag** sowie einen **stabilen Festwert-Modus für die Nacht**.

---

## 🚀 Key Features

* **Einphasige Shelly-Emulation:** Verhindert den bekannten Additions-Fehler der DCU-Firmware, bei dem die eigene Solareinspeisung fälschlicherweise als Hausverbrauch obendrauf gerechnet wird.
* **2-Minuten-Treppenstufen-Dämpfung:** Friert den realen Brutto-Hausverbrauch zeitlich ein. Dadurch wird das hektische, sekundenschnelle Jagen des Wechselrichters komplett eliminiert.
* **10W Slew-Rate-Limiter (Rampe):** Verhindert, dass die Einspeisung bei schlagartigen Lastabfällen (z.B. Abschalten der Waschmaschine) panisch auf 0 Watt einbricht. Der Wert gleitet sanft in 10-Watt-Schritten pro Sekunde nach unten.
* **800W Software-Clipping:** Kappt Berechnungen bei Großverbrauchern (z.B. Herd mit 3000W) hart bei der physischen Grenze von 800W. Fällt die Last, startet die Rampe ohne Totzeit sofort ab der 800W-Kante abwärts.
* **Nacht-Offset (+10W):** Schlägt im Festwertmodus automatisch 10 Watt auf den Dashboard-Slider auf, um das hardwareseitige 20W-Totband des TSUN-Wechselrichters zu überwinden. Der Speicher rastet nachts präzise auf dem Wunschwert ein (Toleranz: ~4 Watt).

---

## 🛠️ Systemarchitektur im Node-RED

Der Flow ist in **drei physisch autarke Zeilen** aufgeteilt, die sich konfliktfrei im Hintergrund über den Arbeitsspeicher (`flow` und `global`) unterhalten:

1. **Zeile 1 (Hausverbrauch-Bremse):** Holt im 2-Minuten-Intervall den aktuellen Brutto-Hausverbrauch und friert ihn ein (`flow.hausverbrauch_gebremst`).
2. **Zeile 2 (HTTP-Echtzeit-Poll):** Antwortet im Sekundentakt auf den `/rpc/Shelly.GetStatus`-Poll des TSUN. Berechnet live die Differenz unter Einbezug der Rampe und des Offsets.
3. **Zeile 3 (Dashboard-Weiche):** Schaltet die Logik im Hintergrund basierend auf der HA-Auswahlliste zwischen `dyn` (Tag) und `fix` (Nacht) um.

---

## 📦 Installation & Einrichtung

### 1. Vorbereitungen in Home Assistant
Erstelle unter **Einstellungen ➡️ Geräte & Dienste ➡️ Helfer** folgende zwei Entitäten:
1. **Dropdown (input_select.regelmodus):** Optionen: `Dynamischer Verbrauch` und `Fester Wert`
2. **Nummer (input_number.wunsch_einspeisung):** Bereich `0` bis `800` (Schrittweite 1 oder 5), Anzeigemodus: Schieberegler

### 2. Einstellungen in der TSUN-App
* Richtet euren lokalen virtuellen Shelly-Zähler (`c049efc02345`) ein.
* Stellt den Installationsort in den Zähler-Einstellungen den Installationsort zwingend auf **„Stromverbrauch“**! 
* *Hinweis zur Logik:* Auch wenn es in der App "Leistung" heißt, versucht die TSUN-Firmware den empfangenen Wert intern immer gegen Null zu regeln.

### 3. Node-RED Import
1. Kopiere den unten stehenden JSON-Code.
2. Gehe in Node-RED oben rechts auf **Menü ➡️ Import** und füge den Text ein.
3. Öffne die gelbe/orangefarbene `function Shelly`-Node und trage in den ersten Zeilen deine exakten HA-Entity-Namen für deinen Wechselrichter-Leistungssensor ein.
4. Klicke auf **Übernehmen (Deploy)**.

---

## 📄 Node-RED Flow (JSON Export)

```json
[
    {
        "id": "emulator_status",
        "type": "http in",
        "z": "574dc86ef8f55d6a",
        "name": "Shelly GetStatus",
        "url": "/rpc/Shelly.GetStatus",
        "method": "get",
        "upload": false,
        "skipBodyParsing": false,
        "swaggerDoc": "",
        "x": 260,
        "y": 300,
        "wires": [
            [
                "e487217ec3f65e19"
            ]
        ]
    },
    {
        "id": "response",
        "type": "http response",
        "z": "574dc86ef8f55d6a",
        "name": "Antwort an Speicher",
        "statusCode": "200",
        "headers": {
            "content-type": "application/json"
        },
        "x": 840,
        "y": 300,
        "wires": []
    },
    {
        "id": "e487217ec3f65e19",
        "type": "function",
        "z": "574dc86ef8f55d6a",
        "name": "function Shelly",
        "func": "// ==========================================\n// CONFIG: Bitte trage hier deine echten HA-Entity-Namen ein!\n// ==========================================\nlet entity_tsun_output = \"sensor.shelly1pmminig3_e4b32329a0e8_leistung\"; // Dein Echtzeit-Sensor\nlet entity_slider = \"input_number.wunsch_einspeisung\"; // Dein Slider für den Nacht-Festwert\n// ==========================================\n\nlet modus = flow.get('tsun_modus') || 'dyn';\nlet formatiertePower = 0.0;\n\nlet soll_wert = 0.0;\nlet roh_differenz = 0.0;\n\n// 1. ABSOLUT LIVE & SEKÜNDLICH: Hole die aktuelle Einspeisung (wird positiv gewandelt)\nlet aktuelle_einspeisung = Math.abs(parseFloat(global.get('homeassistant.homeAssistant.states[\"' + entity_tsun_output + '\"].state')) || 0.0);\n\nif (modus === 'dyn') {\n  // =================================================================================\n  // MODUS A: DYNAMISCH (TAG) -> MIT 800W-KAPPUNG UND 10W-RAMPE\n  // =================================================================================\n  let treppenstufe_roh = parseFloat(flow.get('hausverbrauch_gebremst')) || parseFloat(global.get('homeassistant.homeAssistant.states[\"' + entity_slider + '\"].state')) || 0.0;\n\n  // MATHEMATISCHER FIX: Wenn der Hausverbrauch über 800W liegt, kappen wir ihn hart auf 800W!\n  let treppenstufe_ziel = treppenstufe_roh > 800.0 ? 800.0 : treppenstufe_roh;\n\n  // Hole den exakten Wert der allerletzten Sekunde aus dem Gedächtnis\n  let letzter_gesendeter_wert = context.get('tsun_rampe_letzter_wert') || aktuelle_einspeisung;\n\n  // Begrenzung der maximal erlaubten Änderung pro Sekunde (Rampe = 10 Watt)\n  let max_aenderung_pro_sekunde = 10.0;\n  let abweichung_zur_stufe = treppenstufe_ziel - letzter_gesendeter_wert;\n\n  let rampen_ziel = letzter_gesendeter_wert;\n\n  if (abweichung_zur_stufe > max_aenderung_pro_sekunde) {\n    rampen_ziel += max_aenderung_pro_sekunde;\n  } else if (abweichung_zur_stufe < -max_aenderung_pro_sekunde) {\n    rampen_ziel -= max_aenderung_pro_sekunde;\n  } else {\n    rampen_ziel = treppenstufe_ziel;\n  }\n\n  // Speichere den Schritt für die nächste Sekunde ab\n  context.set('tsun_rampe_letzter_wert', rampen_ziel);\n\n  soll_wert = rampen_ziel;\n  roh_differenz = soll_wert - aktuelle_einspeisung;\n\n  let daempfungs_faktor = 1.0;\n  if (Math.abs(roh_differenz) < 40.0) {\n    daempfungs_faktor = 0.5;\n  }\n  formatiertePower = parseFloat((roh_differenz * daempfungs_faktor).toFixed(2));\n\n} else {\n  // =================================================================================\n  // MODUS B: FESTWERT (NACHT) -> Ungebremster Volldampf mit +10W Offset\n  // =================================================================================\n  let slider_wert = parseFloat(global.get('homeassistant.homeAssistant.states[\"' + entity_slider + '\"].state')) || 0.0;\n  soll_wert = slider_wert + 10.0;\n  roh_differenz = soll_wert - aktuelle_einspeisung;\n\n  let daempfungs_faktor = 1.0;\n  if (Math.abs(roh_differenz) < 40.0) {\n    daempfungs_faktor = 0.5;\n  }\n  formatiertePower = parseFloat((roh_differenz * daempfungs_faktor).toFixed(2));\n\n  context.set('tsun_rampe_letzter_wert', undefined);\n}\n\n// 2. Physikalische Derivate berechnen\nlet voltage = 230.15;\nlet current = parseFloat((Math.abs(formatiertePower / voltage)).toFixed(2));\nlet pf = 0.98;\nlet freq = 50.01;\n\nlet scheinLeistung = Math.abs(formatiertePower) > 0 ? parseFloat((Math.abs(formatiertePower / pf)).toFixed(2)) : 5.00;\nlet festerZaehlerstand = 12345.67;\nlet aktuelleUnixzeit = Math.floor(Date.now() / 1000);\n\n// 3. Das originale, einphasige Shelly Pro EM JSON\nmsg.payload = {\n  \"sys\": { \"mac\": \"C049EFC02345\", \"unixtime\": aktuelleUnixzeit },\n  \"em1:0\": {\n    \"id\": 0, \"current\": current, \"voltage\": voltage,\n    \"act_power\": formatiertePower, \"aprt_power\": scheinLeistung,\n    \"pf\": pf, \"freq\": freq, \"calibration\": \"factory\"\n  },\n  \"em1data:0\": { \"id\": 0, \"total_act_energy\": festerZaehlerstand, \"total_act_ret_energy\": 0.00 },\n  \"switch:0\": { \"id\": 0, \"output\": true }\n};\n\n// 4. DIAGNOSE-BLOCK\nmsg.payload.diagnose = {\n  \"gewaehlter_modus\": modus,\n  \"echter_brutto_hausverbrauch_ha\": flow.get('hausverbrauch_gebremst'),\n  \"gekapptes_rampen_ziel\": soll_wert,\n  \"aktuelle_einspeisung_live_flackernd\": aktuelle_einspeisung,\n  \"beruhigter_json_ausgang_act_power\": formatiertePower\n};\n\nmsg.headers = { \"Content-Type\": \"application/json\" };\nreturn msg;\n",
        "outputs": 1,
        "timeout": 0,
        "noerr": 0,
        "initialize": "",
        "finalize": "",
        "libs": [],
        "x": 560,
        "y": 300,
        "wires": [
            [
                "pact_response"
            ]
        ]
    },
    {
        "id": "014a1271969bc296",
        "type": "change",
        "z": "574dc86ef8f55d6a",
        "name": "Hausverbrauch gebremst",
        "rules": [
            {
                "t": "set",
                "p": "hausverbrauch_gebremst",
                "pt": "flow",
                "to": "payload",
                "tot": "msg"
            }
        ],
        "action": "",
        "property": "",
        "from": "",
        "to": "",
        "reg": false,
        "x": 850,
        "y": 180,
        "wires": [
            []
        ]
    },
    {
        "id": "tsun_weiche_trigger_neu",
        "type": "server-state-changed",
        "z": "574dc86ef8f55d6a",
        "name": "HA Regelmodus geändert",
        "server": "5266157.7ab9f6c",
        "version": 6,
        "outputs": 1,
        "exposeAsEntityConfig": "",
        "entities": {
            "entity": [
                "input_select.regelmodus"
            ],
            "substring": [],
            "regex": []
        },
        "outputInitially": false,
        "stateType": "str",
        "ifState": "",
        "ifStateType": "str",
        "outputOnlyOnStateChange": false,
        "for": "",
        "forType": "num",
        "ignorePrevStateNull": false,
        "ignorePrevStateUnknown": false,
        "ignorePrevStateUnavailable": false,
        "ignoreCurrentStateUnknown": false,
        "ignoreCurrentStateUnavailable": false,
        "outputProperties": [
            {
                "property": "payload",
                "propertyType": "msg",
                "value": "string",
                "valueType": "entityState"
            }
        ],
        "x": 290,
        "y": 440,
        "wires": [
            [
                "tsun_modus_switch_neu"
            ]
        ]
    },
    {
        "id": "tsun_modus_switch_neu",
        "type": "switch",
        "z": "574dc86ef8f55d6a",
        "name": "Welcher Modus?",
        "property": "payload",
        "propertyType": "msg",
        "rules": [
            {
                "t": "eq",
                "v": "Dynamisch",
                "vt": "str"
            },
            {
                "t": "eq",
                "v": "Fester Wert",
                "vt": "str"
            }
        ],
        "checkall": "true",
        "repair": false,
        "outputs": 2,
        "x": 570,
        "y": 440,
        "wires": [
            [
                "tsun_save_mode_dyn_neu"
            ],
            [
                "tsun_save_mode_fix_neu"
            ]
        ]
    },
    {
        "id": "tsun_save_mode_dyn_neu",
        "type": "change",
        "z": "574dc86ef8f55d6a",
        "name": "Setze Dyn",
        "rules": [
            {
                "t": "set",
                "p": "tsun_modus",
                "pt": "flow",
                "to": "dyn",
                "tot": "str"
            }
        ],
        "action": "",
        "property": "",
        "from": "",
        "to": "",
        "reg": false,
        "x": 810,
        "y": 400,
        "wires": [
            []
        ]
    },
    {
        "id": "tsun_save_mode_fix_neu",
        "type": "change",
        "z": "574dc86ef8f55d6a",
        "name": "Setze Fix",
        "rules": [
            {
                "t": "set",
                "p": "tsun_modus",
                "pt": "flow",
                "to": "fix",
                "tot": "str"
            }
        ],
        "action": "",
        "property": "",
        "from": "",
        "to": "",
        "reg": false,
        "x": 800,
        "y": 480,
        "wires": [
            []
        ]
    },
    {
        "id": "5e47099e189b6275",
        "type": "inject",
        "z": "574dc86ef8f55d6a",
        "name": "Zeitverzögerung in Minuten",
        "props": [
            {
                "p": "payload"
            },
            {
                "p": "topic",
                "vt": "str"
            }
        ],
        "repeat": "120",
        "crontab": "",
        "once": true,
        "onceDelay": 0.1,
        "topic": "",
        "payload": "",
        "payloadType": "date",
        "x": 300,
        "y": 180,
        "wires": [
            [
                "8117ab55748df23d"
            ]
        ]
    },
    {
        "id": "8117ab55748df23d",
        "type": "api-current-state",
        "z": "574dc86ef8f55d6a",
        "name": "Hole Hausverbrauch",
        "server": "5266157.7ab9f6c",
        "version": 3,
        "outputs": 1,
        "halt_if": "",
        "halt_if_type": "str",
        "halt_if_compare": "is",
        "entity_id": "sensor.realer_echtzeit_hausverbrauch",
        "state_type": "num",
        "blockInputOverrides": false,
        "outputProperties": [
            {
                "property": "payload",
                "propertyType": "msg",
                "value": "string",
                "valueType": "entityState"
            }
        ],
        "for": "0",
        "forType": "num",
        "forUnits": "minutes",
        "override_topic": false,
        "state_location": "payload",
        "override_payload": "msg",
        "entity_location": "data",
        "override_data": "msg",
        "x": 580,
        "y": 180,
        "wires": [
            [
                "014a1271969bc296"
            ]
        ]
    },
    {
        "id": "5266157.7ab9f6c",
        "type": "server",
        "name": "Home Assistant",
        "addon": true
    },
    {
        "id": "4912351d8668d690",
        "type": "global-config",
        "env": [],
        "modules": {
            "node-red-contrib-home-assistant-websocket": "0.80.3"
        }
    }
]
```

---

## 📝 Diagnose & Echtzeit-Kontrolle

Das Skript gibt am Ende des JSON-Pakets automatisch ein `"diagnose"`-Objekt aus. Wenn du die IP-Adresse deiner Node-RED-Instanz im Browser aufrufst (z.B. `http://192.168.x.x:1880/rpc/Shelly.GetStatus`), kannst du live sehen, wie die Rampe rechnet:

```json
"diagnose": {
  "gewaehlter_modus": "dyn",
  "treppenstufe_ziel_ha": 467.2,
  "rampe_aktueller_soll_wert": 450.0,
  "aktuelle_einspeisung_live_flackernd": 448.3,
  "beruhigter_json_ausgang_act_power": 1.7
}
```

---

## 🤝 Mitwirken & Lizenz

Dieses Projekt ist Open-Source. Wenn du Optimierungen für den Regelkreis hast (z.B. Anpassungen für andere Batterie-Hersteller an der DCU), erstelle gerne einen Pull Request oder öffne ein Issue!

Lizenz: MIT
