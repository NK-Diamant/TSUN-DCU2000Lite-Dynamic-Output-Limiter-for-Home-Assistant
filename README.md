# TSUN DCU2000Lite Dynamic Output Limiter 🔋☀️

An intelligent, hardware-friendly control loop for Node-RED and Home Assistant designed to tame the sluggish regulation behavior of **TSUN storage systems (SolarCan / DCU2000lite / Gen3 inverters)**.

This tool emulates a single-phase Shelly Pro EM data protocol and solves the hardware-related oscillation issues of the TSUN meter mode ("Power Consumption") purely through software-based mathematics. It provides **soft zero feed-in** as well as a **stable fixed-value mode**.

---

## 🚀 Key Features

* **Single-Phase Shelly Emulation:** Prevents the well-known DCU firmware summation bug, where the inverter’s own solar feed-in is incorrectly added on top of household consumption.

* **2-Minute Step-Level Damping:** Temporarily freezes the real gross household consumption. This completely eliminates the inverter’s frantic second-by-second hunting behavior.

* **10W Slew-Rate Limiter (Ramp):** Prevents feed-in power from collapsing to 0 watts when loads suddenly drop (e.g. washing machine turning off). The value smoothly decreases in 10-watt steps per second.

* **800W Software Clipping:** Hard-limits calculations for high-power consumers (e.g. a 3000W stove) at the physical 800W boundary. When the load drops, the ramp immediately starts descending from the 800W edge without dead time.

* **Night Offset (+10W):** Automatically adds 10 watts to the dashboard slider in fixed-value mode to overcome the TSUN inverter’s hardware-side 20W deadband. At night, the battery locks precisely onto the desired target value (tolerance: ~4 watts).

* **Adaptive Percentage Hysteresis & 1.0 Hold Logic:** The comfort zone adapts proportionally (4%) to the current power level. Once the target is reached, a minimal 1.0 is sent instead of a critical 0.0. This maintains physical counterpressure in load mode and completely eliminates wave-like oscillations.

* **Fail-Safe Shield:** Catches empty data gaps during deployment or brief Shelly sensor Wi-Fi dropouts. In that second, Node-RED automatically sends a safe default packet, making a hard crash (0W hard stop) of the TSUN firmware impossible.

---

## 🛠️ System Architecture in Node-RED

The flow is divided into **three physically autonomous lines** that communicate conflict-free in the background via memory (`flow` and `global`):

1. **Line 1 (Intelligent Household Consumption Brake & Peak Filter):** Retrieves the current consumption every 2 minutes. Via a switch- and trigger-based branch, values up to 800W pass through immediately. Load peaks above 800W (e.g. coffee machine, kettle) are blocked for 1–2 minutes. Short peaks under two minutes are therefore completely ignored, protecting the battery.

2. **Line 2 (HTTP Real-Time Poll):** Responds every second to the TSUN `/rpc/Shelly.GetStatus` poll. Calculates the live difference while taking the ramp and offset into account.

3. **Line 3 (Dashboard Switch):** Switches the background logic between `dyn` (daytime) and `fix` (nighttime) based on the HA selection list.

---

## 📦 Installation & Setup

### 1. Preparations in Home Assistant

Under **Settings ➡️ Devices & Services ➡️ Helpers**, create the following two entities:

1. **Dropdown (input_select.regelmodus):** Options: `Dynamic Consumption` and `Fixed Value`

2. **Number (input_number.wunsch_einspeisung):** Range `0` to `800` (step size 1 or 5), display mode: slider

3. **Number (input_number.netz_puffer):** Range `0` to `100` (step size 1 or 5), display mode: slider

### 2. Settings in the TSUN App

* Set up your local virtual Shelly meter (`c049efc02345`).

* In the meter settings, make sure the installation location is set to **“Power” (Power Consumption)**!

* *Logic note:* Even though the app refers to it as "Power", the TSUN firmware internally always attempts to regulate the received value toward zero.

### 3. Node-RED Import

1. Copy the JSON code below.

2. In Node-RED, go to **Menu ➡️ Import** in the top right corner and paste the text.

3. Open the yellow/orange `function Shelly` node and enter your exact HA entity names for your inverter power sensor in the first lines.

4. Click **Deploy**.

---

## 📄 Node-RED Flow (JSON Export)

**[Click here / Klicke hier](flows.json)**

## 📄 Node-RED Function Shelly (Java)

**[Click here / Klicke hier](functionShelly.js)**

## 🤝 Contributing & License

This project is open source. If you have optimizations for the control loop (e.g. adjustments for other battery manufacturers connected to the DCU), feel free to create a pull request or open an issue!

License: MIT
