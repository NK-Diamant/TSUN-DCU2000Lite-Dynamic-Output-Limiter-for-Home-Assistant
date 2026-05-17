This repository explain how to create a dynamic delimiter for Tsun DCU2000Lite output -> Inverter by using Nginx Proxy Manager & Node-RED

---------------–-------------------------------------------------

# TSUN DCU2000Lite Dynamic Output Limiter 🔋☀️

An intelligent, hardware-friendly control loop for Node-RED and Home Assistant to fully tame the laggy regulation of **TSUN battery storage systems (SolarCan / DCU2000lite / Gen3 Inverters)**.

This tool emulates a single-phase Shelly Pro EM data protocol and solves the hardware-induced oscillation issues of the TSUN smart meter mode purely through software mathematics. It provides a **silky-smooth zero-export control during the day** and a **stable constant value mode for the night**.

---

## 🚀 Key Features

* **Single-Phase Shelly Emulation:** Prevents the well-known addition bug of the DCU firmware, where the system's own solar feed-in is mistakenly added on top of the household consumption.
* **2-Minute Step Damping:** Freezes the real gross household consumption in time, completely eliminating the hectic, second-by-second hunting of the inverter.
* **10W Slew-Rate Limiter (Ramp):** Prevents the feed-in from crashing to 0 watts during sudden load drops (e.g., turning off the washing machine). The value glides down smoothly in 10-watt steps per second.
* **800W Software Clipping:** Caps calculations for large appliances (e.g., stove at 3000W) hard at the physical limit of 800W. When the load drops, the ramp starts downward instantly from the 800W edge without dead time.
* **Night Offset (+10W):** Automatically adds 10 watts to the dashboard slider in constant mode to overcome the TSUN inverter's hardware-side 20W deadband. The storage locks precisely onto the desired night value (tolerance: ~4 watts).

---

## 📦 Installation & Setup

### 1. Preparation in Home Assistant
Create the following two helpers under **Settings ➡️ Devices & Services ➡️ Helpers**:
1. **Dropdown (input_select.regelmodus):** Options: `Dynamischer Verbrauch` and `Fester Wert`
2. **Number (input_number.wunsch_einspeisung):** Range `0` to `800` (Step 1 or 5), Display mode: Slider

### 2. Settings in the TSUN App
* Set up your local virtual Shelly meter (`c049efc02345`).
* Change the installation location in the meter settings to **"Power" (Leistung)**!
* *Note on logic:* Even though it is called "Power" in the app, the TSUN firmware treats the received `act_power` value as a grid node background reference and always tries to regulate it **towards zero**.

### 3. Node-RED Import
1. Copy the JSON code from the flow below.
2. In Node-RED, go to **Menu ➡️ Import** and paste the text.
3. Open the yellow/orange `function Shelly` node and enter your exact HA entity names for your inverter power sensor in the first lines.
4. Click **Deploy**.

## 📄 Node-RED Flow (JSON)

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

