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

