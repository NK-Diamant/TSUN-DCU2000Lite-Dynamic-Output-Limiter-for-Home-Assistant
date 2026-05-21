**[English Version](README.md)**

# TSUN DCU2000Lite Dynamic Output Limiter 🔋☀️

Ein intelligenter, materialschonender Regelkreis für Node-RED und Home Assistant, um die träge Regelung von **TSUN-Speichersystemen (SolarCan / DCU2000lite / Gen3-Wechselrichter)** zu zähmen.

Dieses Tool emuliert ein einphasiges Shelly Pro EM Datenprotokoll und löst die hardwarebedingten Schwingungsprobleme des TSUN-Zählermodus ("Stromverbrauch") rein über Software-Mathematik. Es bietet eine **weiche Nulleinspeisung** sowie einen **stabilen Festwert-Modus**.

---

## 🚀 Key Features

* **Einphasige Shelly-Emulation:** Verhindert den bekannten Additions-Fehler der DCU-Firmware, bei dem die eigene Solareinspeisung fälschlicherweise als Hausverbrauch obendrauf gerechnet wird.
* **2-Minuten-Treppenstufen-Dämpfung mit Post-Trigger-Verifikation:** Friert den realen Brutto-Hausverbrauch zeitlich ein. Nach Ablauf der 2 Minuten wird der **aktuelle** Hausverbrauch per `current state` Node neu abgefragt – kurzfristige Lastspitzen (z.B. Kaffeemaschine, Wasserkocher unter 2 Minuten) werden so vollständig ignoriert, was den Akku schont und ein Überschwingen der Einspeisung verhindert.
* **10W/5W Stepped Slew-Rate-Limiter (Rampe):** Verhindert, dass die Einspeisung bei schlagartigen Lastabfällen panisch einbricht. Weit vom Ziel entfernt gleitet der Wert in **10W-Schritten** pro Sekunde, nahe am Ziel (< 40W Differenz) in **5W-Schritten** für ein sanftes Einrasten ohne Überschwingen.
* **800W Software-Clipping:** Kappt Berechnungen bei Großverbrauchern (z.B. Herd mit 3000W) hart bei der physischen Grenze von 800W. Fällt die Last, startet die Rampe ohne Totzeit sofort ab der 800W-Kante abwärts.
* **Nacht-Offset (+10W):** Schlägt im Festwertmodus automatisch 10 Watt auf den Dashboard-Slider auf, um das hardwareseitige 20W-Totband des TSUN-Wechselrichters zu überwinden. Der Speicher rastet nachts präzise auf dem Wunschwert ein (Toleranz: ~4 Watt).
* **Mitahmende Prozent-Hysterese & 1.0-Halte-Logik:** Die Komfortzone passt sich prozentual (4%) an das Leistungsniveau an. Bei Erreichen des Ziels wird statt einer kritischen 0.0 eine minimale 1.0 gesendet. Das hält den physischen Gegendruck im Lastmodus aufrecht und eliminiert das wellenförmige Schwingen vollständig.
* **Intelligente Umschalt-Kupplung (3 Sekunden):** Beim Wechsel zwischen Tag- und Nachtmodus wird der TSUN für 3 Sekunden auf `act_power = 1.0` eingefroren. Die interne Rampe synchronisiert sich währenddessen kontinuierlich mit dem Ist-Wert, sodass nach der Kupplung ein stoßfreier Übergang garantiert ist.
* **Dreifacher Fail-Safe-Schutzschild:** Fängt Datenlöcher beim Deployen, bei kurzen WLAN-Aussetzern des Shelly-Sensors sowie bei `unavailable`/`unknown` Zuständen aller Eingangssensoren ab. Jeder Sensor (Einspeisung, Slider, Hausverbrauch) merkt sich seinen letzten gültigen Wert und verwendet diesen als Fallback – ein harter 0W-Absturz der TSUN-Firmware ist damit ausgeschlossen.
* **Sprungfilter im HA Template Sensor:** Der `Realer Echtzeit Hausverbrauch` Sensor in HA filtert Einbrüche auf unter 20% des letzten Wertes heraus – kurze Sensor-Aussetzer verfälschen die Regelung nicht mehr.

---

## 🛠️ Systemarchitektur im Node-RED

Der Flow ist in **drei physisch autarke Zeilen** aufgeteilt, die sich konfliktfrei im Hintergrund über den Arbeitsspeicher (`flow` und `global`) unterhalten:

1. **Zeile 1 (Intelligente Hausverbrauch-Bremse & Spitzenfilter):** Holt im 2-Minuten-Intervall den aktuellen Verbrauch. Über eine switch- und trigger-Weiche fließen Werte bis 800W sofort durch. Lastspitzen über 800W werden für 2 Minuten blockiert. Nach Ablauf holt ein `current state` Node den dann aktuellen Wert – ist die Last inzwischen gefallen, wird der niedrigere Wert verwendet. Kurze Peaks unter zwei Minuten werden so vollständig ignoriert.
2. **Zeile 2 (HTTP-Echtzeit-Poll):** Antwortet im Sekundentakt auf den `/rpc/Shelly.GetStatus`-Poll des TSUN. Berechnet live die Differenz unter Einbezug der Rampe, Hysterese, Umschalt-Kupplung und aller Fallbacks.
3. **Zeile 3 (Dashboard-Weiche):** Schaltet die Logik im Hintergrund basierend auf der HA-Auswahlliste zwischen `dyn` (Tag) und `fix` (Nacht) um.

---

## 📦 Installation & Einrichtung

### 1. Vorbereitungen in Home Assistant
Erstelle unter **Einstellungen ➡️ Geräte & Dienste ➡️ Helfer** folgende Entitäten:
1. **Dropdown (input_select.regelmodus):** Optionen: `Dynamischer Verbrauch` und `Fester Wert`
2. **Nummer (input_number.wunsch_einspeisung):** Bereich `0` bis `800` (Schrittweite 1 oder 5), Anzeigemodus: Schieberegler
3. **Nummer (input_number.netz_puffer):** Bereich `0` bis `100` (Schrittweite 1 oder 5), Anzeigemodus: Schieberegler

Füge außerdem folgenden Sprungfilter in deinen `Realer Echtzeit Hausverbrauch` Template Sensor in der `configuration.yaml` ein:

```yaml
- name: "Realer Echtzeit Hausverbrauch"
  state: >
    {% set solar = states('sensor.solar_produktion_terrasse_positiv') | float(0) %}
    {% set einspeisung = states('sensor.netzeinspeisung_echtzeit') | float(0) %}
    {% set bezug = states('sensor.netzbezug_echtzeit') | float(0) %}
    {% set verbrauch = ((solar + einspeisung) + bezug) | round(2) %}
    {% set letzter = this.state | float(0) %}
    {% if letzter > 50 and verbrauch < (letzter * 0.2) %}
      {{ letzter }}
    {% else %}
      {{ [verbrauch, 0] | max }}
    {% endif %}
```

### 2. Einstellungen in der TSUN-App
* Richtet euren lokalen virtuellen Shelly-Zähler (`c049efc02345`) ein.
* Stellt den Installationsort in den Zähler-Einstellungen zwingend auf „Leistung" **(Stromverbrauch)**!
* *Hinweis zur Logik:* Auch wenn es in der App "Leistung" meint, versucht die TSUN-Firmware den empfangenen Wert intern immer gegen Null zu regeln.

### 3. Node-RED Import
1. Kopiere den unten stehenden JSON-Code.
2. Gehe in Node-RED oben rechts auf **Menü ➡️ Import** und füge den Text ein.
3. Öffne die gelbe/orangefarbene `function Shelly`-Node und trage in den ersten Zeilen deine exakten HA-Entity-Namen ein.
4. Klicke auf **Übernehmen (Deploy)**.

---

## 📄 Node-RED Flow (JSON Export)

**[Klicke hier / Click here](flows.json)**

## 📄 Node-RED Function Shelly (Java)

**[Klicke hier / Click here](functionShelly.js)**

## 🤝 Mitwirken & Lizenz

Dieses Projekt ist Open-Source. Wenn du Optimierungen für den Regelkreis hast (z.B. Anpassungen für andere Batterie-Hersteller an der DCU), erstelle gerne einen Pull Request oder öffne ein Issue!

Lizenz: MIT
