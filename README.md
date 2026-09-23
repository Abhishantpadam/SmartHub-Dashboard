# 🏡 SmartHub Universal Dashboard & ESP32 IoT Architecture

A high-performance, self-hosted smart home automation system featuring a **modern Glassmorphism UI**, real-time **Server-Sent Events (SSE)** synchronization, bidirectional **TLS MQTT communication**, and universal **ESP32 firmware** with dynamic zero-code hardware discovery.

---

## 🌟 Key Features

- **📊 Activity & System Intelligence Hub**:
  - **Live Wireless Console**: Real-time streaming terminal for ESP32 serial logs and MQTT traffic over Wi-Fi.
  - **Device Activity Timeline**: Visual audit trail of switch toggles, scenes, and power draw in Watts.
  - **Security & Access**: User session audit, TLS encryption verification, and PIN-protected actions.
  - **Node Telemetry**: Live hardware health monitors (Wi-Fi RSSI signal strength, Free SRAM Heap, Node Uptime).
- **⚡ Real-Time Bidirectional Control**:
  - Microsecond state updates via SSE (Server-Sent Events) and TLS MQTT (HiveMQ Cloud).
  - Instant hardware-level dimming (PWM) and fan multi-speed control.
- **🛠️ Universal ESP32 Zero-Code Firmware**:
  - Wi-Fi Captive Portal (`SmartHub-Setup-XXXX`) for zero-code provisioning.
  - Flash Non-Volatile Persistence (`Preferences.h`) across power cuts.
  - Debounced physical wall switch inputs with loopback protection.
  - Smart status indicator patterns on onboard LED.

---

## 🏗️ Architecture Overview

```text
┌────────────────────────────────────────────────────────┐
│             Web Dashboard (HTML5 / CSS / JS)           │
│  - Activity Intelligence Hub   - Device Controls       │
│  - Quick Action Scenes          - Energy Monitoring    │
└───────────────────────────┬────────────────────────────┘
                            │ SSE & REST APIs
┌───────────────────────────▼────────────────────────────┐
│               Node.js / Express Backend                │
│  - MQTT Client (TLS 8883)       - SSE Broadcaster      │
│  - Granular Device State Engine - Auto-Discovery Sync  │
└───────────────────────────┬────────────────────────────┘
                            │ MQTT over TLS (HiveMQ)
┌───────────────────────────▼────────────────────────────┐
│                 ESP32 Hardware Nodes                   │
│  - Dynamic Relay Control        - PWM Dimming & Speed  │
│  - Physical Wall Switches       - Flash NVS Storage    │
└────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher
- **Arduino IDE** (or PlatformIO / ESP-IDF) with the ESP32 board package installed
- **Libraries for ESP32**: `PubSubClient` by Nick O'Leary

### 2. Backend Setup
```bash
# Navigate to the backend folder
cd Backend

# Install dependencies
npm install

# Copy configuration templates
cp mqtt-config.example.json mqtt-config.json
cp database.example.json database.json

# Start the local development server
npm run dev
```
The dashboard will be live at `http://localhost:3000`.

### 3. ESP32 Firmware Setup
1. In the project root, copy the template:
   ```bash
   cp secrets.h.example secrets.h
   ```
2. Open `secrets.h` and configure your MQTT broker credentials:
   ```cpp
   #define DEFAULT_MQTT_HOST       "your-broker.s1.eu.hivemq.cloud"
   #define DEFAULT_MQTT_PORT       8883
   #define DEFAULT_MQTT_USER       "your_username"
   #define DEFAULT_MQTT_PASSWORD   "your_password"
   ```
3. Open [`sketch.ino`](./sketch.ino) in the Arduino IDE.
4. Select your ESP32 board and flash the firmware.
5. On boot, connect to the ESP32's SoftAP Wi-Fi network (`SmartHub-Setup-XXXX`) on your phone or laptop to configure your home Wi-Fi credentials.

---

## 🔒 Security & Privacy

- **Decoupled Secrets**: `secrets.h` and `mqtt-config.json` are strictly ignored by `.gitignore` to guarantee that private passwords, tokens, and broker endpoints are never checked into version control.
- **TLS v1.3 Encryption**: All MQTT communication between dashboard nodes and cloud brokers uses TLS port 8883.
- **Isolated Hardware NVS**: Device configurations and Wi-Fi credentials persist locally in the ESP32's encrypted flash memory.

---

## 📄 License
MIT License. Free for personal and commercial smart home use.
