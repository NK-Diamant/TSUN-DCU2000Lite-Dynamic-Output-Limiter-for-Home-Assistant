# TSUN DCU Dynamic Output Limiter 🔋☀️

Ein intelligenter, materialschonender Regelkreis für Node-RED und Home Assistant, um die träge Regelung von **TSUN-Speichersystemen (SolarCan / DCU2000lite / Gen3-Wechselrichter)** vollständig zu zähmen. 

Dieses Tool emuliert ein einphasiges Shelly Pro EM Datenprotokoll und löst die hardwarebedingten Schwingungsprobleme des TSUN-Zählermodus ("Leistung") rein über Software-Mathematik. Es bietet eine **seidenweiche Nulleinspeisung am Tag** sowie einen **stabilen Festwert-Modus für die Nacht**.

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
* Stellt den Installationsort in den Zähler-Einstellungen zwingend auf **„Leistung“**! 
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
    "id": "HIER_DEINEN_KOMPLETTEN_NODE_RED_JSON_EXPORT_EINFÜGEN"
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
