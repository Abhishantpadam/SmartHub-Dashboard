// ==========================================================================
// SmartHub Universal ESP32 Firmware — Zero-Code Auto-Discovery & Cloud MQTT
// ==========================================================================
// Features:
//   • Zero-Code Wi-Fi Provisioning via SoftAP & Captive Portal (SmartHub-Setup-XXXX)
//   • Flash Non-Volatile Persistence (Preferences.h) across power outages
//   • Dynamic Over-The-Air Hardware Reconfiguration from Dashboard
//   • Secure TLS MQTT Bi-Directional Cloud Synchronization
//   • Debounced Physical Wall Switch Input Support
//   • Hardware LED Flash Identification
//
// Required Libraries (Arduino Library Manager):
//   • PubSubClient by Nick O'Leary
//   (WiFi, WebServer, DNSServer, Preferences, WiFiClientSecure are built into ESP32 Core)
// ==========================================================================

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <Preferences.h>
#include <PubSubClient.h>

// ── Optional Private Credentials Header (Ignored by Git) ──────────────────
#if __has_include("secrets.h")
#include "secrets.h"
#endif

// ── Default Factory Fallback MQTT Configuration ──────────────────────────
#ifndef DEFAULT_MQTT_HOST
#define DEFAULT_MQTT_HOST       "your-broker.s1.eu.hivemq.cloud"
#endif
#ifndef DEFAULT_MQTT_PORT
#define DEFAULT_MQTT_PORT       8883
#endif
#ifndef DEFAULT_MQTT_USER
#define DEFAULT_MQTT_USER       "your_username"
#endif
#ifndef DEFAULT_MQTT_PASSWORD
#define DEFAULT_MQTT_PASSWORD   "your_password"
#endif
#ifndef DEFAULT_BASE_TOPIC
#define DEFAULT_BASE_TOPIC      "smarthub"
#endif
#define FIRMWARE_VERSION        "v3.1-universal"

// ── Hardware IO Definitions ──────────────────────────────────────────────
const int BOOT_BUTTON_PIN  = 0;
const int STATUS_LED_PIN   = 2; // Internal blue LED on GPIO 2

enum LedState {
    LED_IDLE,               // Normal running: LED is OFF
    LED_AP_CONFIG,          // AP Captive Portal active: 1 gentle pulse every 2 sec
    LED_WIFI_CONNECTING,    // Connecting to Wi-Fi: 1 pulse per sec
    LED_WIFI_SUCCESS,       // Wi-Fi connected: 2 quick celebration flashes
    LED_MQTT_CONNECTING,    // Connecting to MQTT Broker
    LED_MQTT_FAILED,        // Disconnected / Error: 3 rapid alert flashes
    LED_IDENTIFY,           // Identification strobe from dashboard (2s)
    LED_SINGLE_FLASH        // Single action confirmation blink (turning device ON/OFF)
};

// Default Available Relays & Physical Switch Button Pairs
#define MAX_CHANNELS 8
const int DEFAULT_RELAYS[MAX_CHANNELS]  = {4, 5, 18, 19, 21, 22, 23, 25};
const int DEFAULT_BUTTONS[MAX_CHANNELS] = {-1, -1, -1, -1, -1, -1, -1, -1}; // -1 disables button input to prevent pin conflict
int totalChannels = 5; // Default 5 channels active unless configured otherwise

// ── Relay Hardware Trigger Polarity ──────────────────────────────────────
// Set to true if your relay board is Active-LOW (relays turn ON when GPIO is LOW - standard 5V optocoupled modules)
// Set to false if your relay board is Active-HIGH (relays turn ON when GPIO is HIGH)
#define RELAY_ACTIVE_LOW_DEFAULT false
bool relayActiveLow = RELAY_ACTIVE_LOW_DEFAULT;

inline int relayLevel(bool isOn) {
    if (relayActiveLow) {
        return isOn ? LOW : HIGH;
    } else {
        return isOn ? HIGH : LOW;
    }
}

// Dynamic Channel Structure
struct ChannelMapping {
    int relayGpio;
    int buttonGpio;
    char deviceId[40];
    char name[40];
    char type[20];
    bool state;
    int brightness; // 0 - 100%
    int speed;      // 1 - 3
    bool lastButtonState;
    bool actionLatch;
    unsigned long lastDebounceTime;
    bool active;
};

ChannelMapping channels[MAX_CHANNELS];

// ── Channel Hardware Output Driver (Digital / PWM Dimming & Speed) ────────
void applyChannelOutput(int idx) {
    if (idx < 0 || idx >= totalChannels || !channels[idx].active) return;
    int pin = channels[idx].relayGpio;
    if (pin < 0) return;

    bool isOn = channels[idx].state;
    String devType = String(channels[idx].type);

    if (!isOn) {
        // Device OFF: 0V for Active-HIGH, or 3.3V for Active-LOW
        analogWrite(pin, relayActiveLow ? 255 : 0);
        return;
    }

    // Device ON:
    if (devType == "light") {
        int b = channels[idx].brightness;
        if (b <= 0) b = 80;
        if (b > 100) b = 100;
        int duty = map(b, 0, 100, 0, 255);
        if (relayActiveLow) duty = 255 - duty;
        analogWrite(pin, duty);
    } else if (devType == "fan") {
        int spd = channels[idx].speed;
        int duty = 255;
        if (spd == 1) duty = 85;       // ~33% speed
        else if (spd == 2) duty = 170; // ~66% speed
        else duty = 255;               // 100% speed
        if (relayActiveLow) duty = 255 - duty;
        analogWrite(pin, duty);
    } else {
        // Binary appliances (TV, socket, generic switch): Full ON
        analogWrite(pin, relayActiveLow ? 0 : 255);
    }
}

// ── Globals & Subsystems ──────────────────────────────────────────────────
Preferences prefs;
DNSServer dnsServer;
WebServer server(80);
WiFiClientSecure wifiClient;
PubSubClient mqttClient(wifiClient);

bool isApMode = false;
String chipMac = "";
String nodeId = "";
String nodeRoom = "";
String wifiSsid = "";
String wifiPass = "";
String mqttHost = DEFAULT_MQTT_HOST;
int    mqttPort = DEFAULT_MQTT_PORT;
String mqttUser = DEFAULT_MQTT_USER;
String mqttPass = DEFAULT_MQTT_PASSWORD;
String baseTopic = DEFAULT_BASE_TOPIC;

unsigned long lastHeartbeat = 0;
unsigned long lastDiscoveryAnnounce = 0;
const unsigned long HEARTBEAT_INTERVAL = 30000;      // 30 seconds
const unsigned long DISCOVERY_INTERVAL = 180000;     // 3 minutes
const unsigned long DEBOUNCE_DELAY = 50;             // 50 ms

// ── Forward Declarations ──────────────────────────────────────────────────
void triggerActionBlink();
void triggerLedPattern(LedState state);
void setLedMode(LedState state);
void updateLedIndicator();
void loadConfiguration();
void saveConfiguration();
void loadDeviceStates();
void saveDeviceState(int idx);
void startAccessPoint();
void startStationMode();
void setupWebServer();
void onMqttMessage(char* topic, byte* payload, unsigned int length);
void publishState(int idx, const char* source);
void publishDiscoveryAnnounce();
void publishNodePresence(const char* status);
void sendHeartbeat();
void connectMQTT();
void espLog(const String& msg);

// ── Non-Blocking Status LED State Machine (GPIO 2) ────────────────────────
LedState currentLedState = LED_IDLE;
unsigned long ledStateStartTime = 0;
bool ledPinActive = false;

// Trigger a crisp single flash (120ms) when turning any device on/off
void triggerActionBlink() {
    currentLedState = LED_SINGLE_FLASH;
    ledStateStartTime = millis();
    digitalWrite(STATUS_LED_PIN, HIGH);
    ledPinActive = true;
}

// Trigger temporary pattern with auto-revert
void triggerLedPattern(LedState state) {
    currentLedState = state;
    ledStateStartTime = millis();
    digitalWrite(STATUS_LED_PIN, LOW);
    ledPinActive = false;
}

void setLedMode(LedState state) {
    if (currentLedState == LED_SINGLE_FLASH && (millis() - ledStateStartTime < 150)) {
        return; // Don't interrupt an active device toggle blink
    }
    if (currentLedState != state) {
        currentLedState = state;
        ledStateStartTime = millis();
    }
}

void updateLedIndicator() {
    unsigned long now = millis();

    switch (currentLedState) {
        case LED_IDLE:
            if (ledPinActive) {
                digitalWrite(STATUS_LED_PIN, LOW);
                ledPinActive = false;
            }
            break;

        case LED_SINGLE_FLASH:
            if (now - ledStateStartTime < 120) {
                if (!ledPinActive) {
                    digitalWrite(STATUS_LED_PIN, HIGH);
                    ledPinActive = true;
                }
            } else {
                digitalWrite(STATUS_LED_PIN, LOW);
                ledPinActive = false;
                currentLedState = (WiFi.status() == WL_CONNECTED && mqttClient.connected()) ? LED_IDLE : LED_MQTT_FAILED;
            }
            break;

        case LED_AP_CONFIG: {
            unsigned long cycle = now % 2000;
            bool on = (cycle < 150);
            if (on != ledPinActive) {
                digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
                ledPinActive = on;
            }
            break;
        }

        case LED_WIFI_CONNECTING: {
            unsigned long cycle = now % 1000;
            bool on = (cycle < 200);
            if (on != ledPinActive) {
                digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
                ledPinActive = on;
            }
            break;
        }

        case LED_WIFI_SUCCESS: {
            unsigned long elapsed = now - ledStateStartTime;
            if (elapsed < 80) {
                digitalWrite(STATUS_LED_PIN, HIGH);
                ledPinActive = true;
            } else if (elapsed < 160) {
                digitalWrite(STATUS_LED_PIN, LOW);
                ledPinActive = false;
            } else if (elapsed < 240) {
                digitalWrite(STATUS_LED_PIN, HIGH);
                ledPinActive = true;
            } else {
                digitalWrite(STATUS_LED_PIN, LOW);
                ledPinActive = false;
                currentLedState = LED_MQTT_CONNECTING;
                ledStateStartTime = now;
            }
            break;
        }

        case LED_MQTT_CONNECTING: {
            unsigned long cycle = now % 1000;
            bool on = (cycle < 60) || (cycle >= 140 && cycle < 200);
            if (on != ledPinActive) {
                digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
                ledPinActive = on;
            }
            break;
        }

        case LED_MQTT_FAILED: {
            unsigned long cycle = now % 2500;
            bool on = (cycle < 100) || (cycle >= 200 && cycle < 300) || (cycle >= 400 && cycle < 500);
            if (on != ledPinActive) {
                digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
                ledPinActive = on;
            }
            break;
        }

        case LED_IDENTIFY: {
            if (now - ledStateStartTime < 2000) {
                unsigned long cycle = now % 150;
                bool on = (cycle < 75);
                if (on != ledPinActive) {
                    digitalWrite(STATUS_LED_PIN, on ? HIGH : LOW);
                    ledPinActive = on;
                }
            } else {
                digitalWrite(STATUS_LED_PIN, LOW);
                ledPinActive = false;
                currentLedState = (WiFi.status() == WL_CONNECTED && mqttClient.connected()) ? LED_IDLE : LED_MQTT_FAILED;
            }
            break;
        }
    }
}

// ==========================================================================
// Setup & Initialization
// ==========================================================================
void setup() {
    Serial.begin(115200);
    delay(400);
    Serial.println("\n╔═══════════════════════════════════════════════════╗");
    Serial.println("║   SmartHub Universal ESP32 Firmware " FIRMWARE_VERSION "   ║");
    Serial.println("╚═══════════════════════════════════════════════════╝");

    // Initialize Status Indicator LED (GPIO 2)
    pinMode(STATUS_LED_PIN, OUTPUT);
    digitalWrite(STATUS_LED_PIN, LOW);

    pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);

    // Compute unique hardware Node ID from MAC
    uint8_t mac[6];
    WiFi.macAddress(mac);
    char macStr[18];
    sprintf(macStr, "%02X:%02X:%02X:%02X:%02X:%02X", mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]);
    chipMac = String(macStr);
    
    char shortId[16];
    sprintf(shortId, "esp32-%02x%02x", mac[4], mac[5]);
    nodeId = String(shortId);

    Serial.printf("[System] MAC Address: %s\n", chipMac.c_str());
    Serial.printf("[System] Default Node ID: %s\n", nodeId.c_str());

    // Check if user is holding BOOT button at startup to force Captive Portal
    if (digitalRead(BOOT_BUTTON_PIN) == LOW) {
        Serial.println("[System] 🔘 BOOT button held! Resetting Wi-Fi to Setup Portal...");
        startAccessPoint();
        return;
    }

    loadConfiguration();

    // Initialize default channel mappings first
    for (int i = 0; i < totalChannels; i++) {
        if (channels[i].relayGpio <= 0) channels[i].relayGpio = DEFAULT_RELAYS[i];
        if (channels[i].buttonGpio <= 0 || channels[i].buttonGpio == channels[i].relayGpio || channels[i].buttonGpio == BOOT_BUTTON_PIN) {
            channels[i].buttonGpio = -1;
        }
        if (strlen(channels[i].deviceId) == 0) {
            sprintf(channels[i].deviceId, "device-%d", i + 1);
            sprintf(channels[i].name, "Channel %d", i + 1);
            strcpy(channels[i].type, "light");
        }
        channels[i].brightness = 80;
        channels[i].speed = 3;
        channels[i].lastDebounceTime = 0;
        channels[i].active = true;
    }

    loadDeviceStates(); // Checks what devices were ON/OFF before reboot/power cut

    // Set pin modes and restore physical relay states
    for (int i = 0; i < totalChannels; i++) {
        pinMode(channels[i].relayGpio, OUTPUT);
        applyChannelOutput(i);

        if (channels[i].buttonGpio >= 0) {
            if (channels[i].buttonGpio >= 34) {
                pinMode(channels[i].buttonGpio, INPUT);
            } else {
                pinMode(channels[i].buttonGpio, INPUT_PULLDOWN);
            }
            channels[i].lastButtonState = digitalRead(channels[i].buttonGpio);
            channels[i].actionLatch = channels[i].lastButtonState;
        }
    }

    if (wifiSsid.length() == 0) {
        Serial.println("[WiFi] No saved Wi-Fi credentials found in Flash.");
        startAccessPoint();
    } else {
        startStationMode();
    }
}

// ==========================================================================
// Loop Execution
// ==========================================================================
void loop() {
    updateLedIndicator();

    if (isApMode) {
        dnsServer.processNextRequest();
        server.handleClient();
        return;
    }

    // 2. Wi-Fi Auto-Reconnect Watchdog (Non-blocking: retries every 5s without freezing CPU)
    if (WiFi.status() != WL_CONNECTED) {
        setLedMode(LED_WIFI_CONNECTING);
        static unsigned long lastWifiAttempt = 0;
        if (millis() - lastWifiAttempt > 5000) {
            lastWifiAttempt = millis();
            Serial.println("[WiFi] ⚠️ Wi-Fi disconnected. Reconnecting...");
            WiFi.reconnect();
        }
        return; // Wait for Wi-Fi to establish before attempting MQTT
    }

    // 3. MQTT Watchdog (Non-blocking)
    if (!mqttClient.connected()) {
        connectMQTT();
    }
    mqttClient.loop();

    // Physical Wall Switch Input Processing
    for (int i = 0; i < totalChannels; i++) {
        if (!channels[i].active || channels[i].buttonGpio < 0) continue;
        
        bool reading = digitalRead(channels[i].buttonGpio);
        if (reading != channels[i].lastButtonState) {
            channels[i].lastDebounceTime = millis();
            channels[i].lastButtonState = reading;
        }

        if ((millis() - channels[i].lastDebounceTime) > DEBOUNCE_DELAY) {
            if (reading && !channels[i].actionLatch) {
                // Button Pressed (Rising Edge) -> Toggle relay
                channels[i].actionLatch = true;
                channels[i].state = !channels[i].state;
                applyChannelOutput(i);
                saveDeviceState(i);
                triggerActionBlink();
                espLog(String("[Button ") + i + " / GPIO " + channels[i].relayGpio +
                       "] Toggled " + channels[i].deviceId +
                       " → " + (channels[i].state ? "ON" : "OFF"));
                publishState(i, "button");
            } else if (!reading) {
                channels[i].actionLatch = false;
            }
        }
    }

    // Periodic Heartbeat
    if (millis() - lastHeartbeat > HEARTBEAT_INTERVAL) {
        lastHeartbeat = millis();
        sendHeartbeat();
    }

    // Periodic Discovery Re-Announce
    if (millis() - lastDiscoveryAnnounce > DISCOVERY_INTERVAL) {
        lastDiscoveryAnnounce = millis();
        publishDiscoveryAnnounce();
    }
}

// ==========================================================================
// Flash Persistence (Preferences.h NVS)
// ==========================================================================
void loadDeviceStates() {
    prefs.begin("smarthub_state", true); // read-only mode
    for (int i = 0; i < totalChannels; i++) {
        String devType = String(channels[i].type);
        if (strlen(channels[i].deviceId) > 0) {
            // Restore saved state across power cuts / restarts (default to false / OFF)
            channels[i].state = prefs.getBool(channels[i].deviceId, false);
            if (devType == "light") {
                char bKey[48];
                snprintf(bKey, sizeof(bKey), "b_%s", channels[i].deviceId);
                channels[i].brightness = prefs.getInt(bKey, 80);
            } else if (devType == "fan") {
                char sKey[48];
                snprintf(sKey, sizeof(sKey), "s_%s", channels[i].deviceId);
                channels[i].speed = prefs.getInt(sKey, 3);
            }
        } else {
            channels[i].state = false;
            channels[i].brightness = 80;
            channels[i].speed = 3;
        }
    }
    prefs.end();
    Serial.println("[State] 💾 Checking saved device states from Flash NVS:");
    for (int i = 0; i < totalChannels; i++) {
        String devType = String(channels[i].type);
        String details = "";
        if (devType == "light") {
            details = " (Bright: " + String(channels[i].brightness) + "%)";
        } else if (devType == "fan") {
            details = " (Speed: " + String(channels[i].speed) + ")";
        }
        Serial.printf("  • Channel %d [%s] (GPIO %d, Type: %s) → %s%s\n",
                      i + 1,
                      channels[i].deviceId,
                      channels[i].relayGpio,
                      channels[i].type,
                      channels[i].state ? "ON" : "OFF",
                      details.c_str());
    }
}

void saveDeviceState(int idx) {
    if (idx < 0 || idx >= totalChannels || strlen(channels[idx].deviceId) == 0) return;
    String devType = String(channels[idx].type);
    prefs.begin("smarthub_state", false); // read-write mode
    prefs.putBool(channels[idx].deviceId, channels[idx].state);
    if (devType == "light") {
        char bKey[48];
        snprintf(bKey, sizeof(bKey), "b_%s", channels[idx].deviceId);
        prefs.putInt(bKey, channels[idx].brightness);
    } else if (devType == "fan") {
        char sKey[48];
        snprintf(sKey, sizeof(sKey), "s_%s", channels[idx].deviceId);
        prefs.putInt(sKey, channels[idx].speed);
    }
    prefs.end();

    String details = "";
    if (devType == "light") {
        details = " (Bright: " + String(channels[idx].brightness) + "%)";
    } else if (devType == "fan") {
        details = " (Speed: " + String(channels[idx].speed) + ")";
    }
    Serial.printf("[State] 💾 Saved state for %s → %s%s\n",
                  channels[idx].deviceId,
                  channels[idx].state ? "ON" : "OFF",
                  details.c_str());
}

void loadConfiguration() {
    prefs.begin("smarthub", true); // read-only mode
    wifiSsid  = prefs.getString("ssid", "");
    wifiPass  = prefs.getString("pass", "");
    nodeRoom  = prefs.getString("room", "");
    mqttHost  = prefs.getString("mqHost", DEFAULT_MQTT_HOST);
    mqttPort  = prefs.getInt("mqPort", DEFAULT_MQTT_PORT);
    mqttUser  = prefs.getString("mqUser", DEFAULT_MQTT_USER);
    mqttPass  = prefs.getString("mqPass", DEFAULT_MQTT_PASSWORD);
    baseTopic = prefs.getString("baseTopic", DEFAULT_BASE_TOPIC);
    relayActiveLow = prefs.getBool("relActiveLow", RELAY_ACTIVE_LOW_DEFAULT);
    
    String customId = prefs.getString("nodeId", "");
    if (customId.length() > 0) nodeId = customId;
    
    prefs.end();

    // Restore dynamic pin configurations if saved
    prefs.begin("smarthub_pins", true);
    int savedChannels = prefs.getInt("total_ch", 0);
    if (savedChannels > 0 && savedChannels <= MAX_CHANNELS) {
        totalChannels = savedChannels;
        for (int i = 0; i < totalChannels; i++) {
            char kG[16], kI[16], kN[16], kT[16];
            sprintf(kG, "g_%d", i);
            sprintf(kI, "i_%d", i);
            sprintf(kN, "n_%d", i);
            sprintf(kT, "t_%d", i);
            int pin = prefs.getInt(kG, DEFAULT_RELAYS[i]);
            String idStr = prefs.getString(kI, "");
            String nameStr = prefs.getString(kN, "");
            String typeStr = prefs.getString(kT, "light");

            channels[i].relayGpio = pin;
            channels[i].buttonGpio = -1; // disable button to prevent pin conflict
            if (idStr.length() > 0) strncpy(channels[i].deviceId, idStr.c_str(), sizeof(channels[i].deviceId) - 1);
            if (nameStr.length() > 0) strncpy(channels[i].name, nameStr.c_str(), sizeof(channels[i].name) - 1);
            if (typeStr.length() > 0) strncpy(channels[i].type, typeStr.c_str(), sizeof(channels[i].type) - 1);
            channels[i].brightness = 80;
            channels[i].speed = 3;
            channels[i].active = true;
        }
        Serial.printf("[Storage] Restored %d dynamic hardware channels from Flash NVS.\n", totalChannels);
    }
    prefs.end();

    Serial.printf("[Storage] Loaded Config — SSID: %s | Room: %s | Host: %s | Relay Active-LOW: %s\n",
                  wifiSsid.c_str(), nodeRoom.c_str(), mqttHost.c_str(), relayActiveLow ? "YES" : "NO");
}

void saveConfiguration() {
    prefs.begin("smarthub", false); // read-write mode
    prefs.putString("ssid", wifiSsid);
    prefs.putString("pass", wifiPass);
    prefs.putString("room", nodeRoom);
    prefs.putString("mqHost", mqttHost);
    prefs.putInt("mqPort", mqttPort);
    prefs.putString("mqUser", mqttUser);
    prefs.putString("mqPass", mqttPass);
    prefs.putString("baseTopic", baseTopic);
    prefs.putString("nodeId", nodeId);
    prefs.putBool("relActiveLow", relayActiveLow);
    prefs.end();
    Serial.println("[Storage] ✅ Configuration written to Flash NVS.");
}

// ==========================================================================
// Captive Portal & SoftAP Mode
// ==========================================================================
void startAccessPoint() {
    isApMode = true;
    setLedMode(LED_AP_CONFIG);
    WiFi.mode(WIFI_AP);
    
    String apName = "SmartHub-Setup-" + nodeId.substring(nodeId.length() - 4);
    apName.toUpperCase();
    WiFi.softAP(apName.c_str());
    
    IPAddress apIP(192, 168, 4, 1);
    WiFi.softAPConfig(apIP, apIP, IPAddress(255, 255, 255, 0));

    // Captive Portal DNS redirection
    dnsServer.start(53, "*", apIP);
    setupWebServer();

    Serial.println("\n╔═══════════════════════════════════════════════════╗");
    Serial.printf("║  📶 Setup Wi-Fi AP Active: %-22s ║\n", apName.c_str());
    Serial.println("║  🌐 Open Browser: http://192.168.4.1             ║");
    Serial.println("╚═══════════════════════════════════════════════════╝\n");
}

void setupWebServer() {
    server.on("/", HTTP_GET, []() {
        int n = WiFi.scanNetworks();
        String options = "";
        for (int i = 0; i < n; ++i) {
            String net = WiFi.SSID(i);
            int rssi = WiFi.RSSI(i);
            options += "<option value='" + net + "'>" + net + " (" + String(rssi) + " dBm)</option>";
        }

        String html = "<!DOCTYPE html><html lang='en'><head><meta charset='UTF-8'>"
                      "<meta name='viewport' content='width=device-width,initial-scale=1.0'>"
                      "<title>SmartHub Device Setup</title><style>"
                      ":root{--bg:#0b0f19;--card:rgba(255,255,255,0.06);--border:rgba(255,255,255,0.12);--accent:#0071e3;--text:#f5f5f7;--sub:#86868b;}"
                      "*{box-sizing:border-box;margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',sans-serif;}"
                      "body{background:var(--bg);color:var(--text);display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px;}"
                      ".card{background:var(--card);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid var(--border);border-radius:24px;padding:32px 28px;width:100%;max-width:400px;box-shadow:0 20px 40px rgba(0,0,0,0.5);}"
                      "h1{font-size:1.5rem;font-weight:600;margin-bottom:6px;letter-spacing:-0.5px;}"
                      "p{font-size:0.875rem;color:var(--sub);margin-bottom:24px;}"
                      "label{display:block;font-size:0.75rem;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:var(--sub);margin-bottom:6px;}"
                      "select,input{width:100%;background:rgba(255,255,255,0.08);border:1px solid var(--border);color:var(--text);padding:12px 14px;border-radius:12px;font-size:0.95rem;margin-bottom:18px;outline:none;transition:border 0.2s;}"
                      "select:focus,input:focus{border-color:var(--accent);}"
                      "details{margin-bottom:20px;border-radius:12px;background:rgba(255,255,255,0.03);padding:12px;border:1px solid var(--border);}"
                      "summary{font-size:0.825rem;font-weight:500;color:var(--sub);cursor:pointer;outline:none;user-select:none;}"
                      "button{width:100%;background:var(--accent);color:#fff;border:none;padding:14px;border-radius:14px;font-size:1rem;font-weight:600;cursor:pointer;transition:transform 0.15s,filter 0.2s;}"
                      "button:active{transform:scale(0.98);filter:brightness(0.9);}"
                      ".badge{display:inline-block;padding:3px 8px;border-radius:6px;background:rgba(0,113,227,0.2);color:#2997ff;font-size:0.75rem;font-weight:600;margin-bottom:12px;}"
                      "</style></head><body><div class='card'>"
                      "<div class='badge'>SmartHub Zero-Code Setup</div>"
                      "<h1>Connect Device</h1>"
                      "<p>Select your home Wi-Fi network to link this ESP32 controller to your dashboard.</p>"
                      "<form action='/save' method='POST'>"
                      "<label>Wi-Fi Network</label><select name='ssid'>" + options + "</select>"
                      "<label>Wi-Fi Password</label><input type='password' name='pass' placeholder='Enter password' required>"
                      "<details><summary>Advanced Cloud Settings (Optional)</summary><div style='margin-top:14px;'>"
                      "<label>MQTT Host</label><input type='text' name='mqHost' value='" + mqttHost + "'>"
                      "<label>MQTT Port</label><input type='number' name='mqPort' value='" + String(mqttPort) + "'>"
                      "<label>MQTT User</label><input type='text' name='mqUser' value='" + mqttUser + "'>"
                      "<label>MQTT Password</label><input type='password' name='mqPass' value='" + mqttPass + "'>"
                      "<label>Base Topic</label><input type='text' name='baseTopic' value='" + baseTopic + "'>"
                      "<label style='display:flex;align-items:center;gap:8px;font-size:0.85rem;color:var(--text);margin-top:10px;cursor:pointer;text-transform:none;letter-spacing:normal;'><input type='checkbox' name='activeLow' value='1' style='width:auto;margin:0;'" + String(relayActiveLow ? " checked" : "") + "> Active-LOW Relay Module (Triggers on GND/0V)</label>"
                      "</div></details>"
                      "<button type='submit'>Save & Connect Device</button>"
                      "</form></div></body></html>";
        server.send(200, "text/html", html);
    });

    server.on("/save", HTTP_POST, []() {
        wifiSsid = server.arg("ssid");
        wifiPass = server.arg("pass");
        if (server.hasArg("mqHost") && server.arg("mqHost").length() > 0) mqttHost = server.arg("mqHost");
        if (server.hasArg("mqPort") && server.arg("mqPort").length() > 0) mqttPort = server.arg("mqPort").toInt();
        if (server.hasArg("mqUser")) mqttUser = server.arg("mqUser");
        if (server.hasArg("mqPass")) mqttPass = server.arg("mqPass");
        if (server.hasArg("baseTopic")) baseTopic = server.arg("baseTopic");
        relayActiveLow = server.hasArg("activeLow");

        saveConfiguration();

        String html = "<!DOCTYPE html><html><head><meta name='viewport' content='width=device-width,initial-scale=1.0'>"
                      "<title>Config Saved</title><style>body{background:#0b0f19;color:#fff;font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;text-align:center;padding:20px;}</style></head>"
                      "<body><div><h2 style='color:#30d158;margin-bottom:10px;'>✅ Config Saved!</h2><p style='color:#86868b;'>Connecting to " + wifiSsid + "... Check your Smart Home Dashboard under Settings > Device Pairing.</p></div></body></html>";
        server.send(200, "text/html", html);
        delay(1500);
        ESP.restart();
    });

    server.onNotFound([]() {
        server.sendHeader("Location", "http://192.168.4.1/", true);
        server.send(302, "text/plain", "");
    });

    server.begin();
}

// ==========================================================================
// Station Mode & Cloud MQTT
// ==========================================================================
void startStationMode() {
    isApMode = false;
    WiFi.mode(WIFI_STA);
    WiFi.begin(wifiSsid.c_str(), wifiPass.c_str());
    setLedMode(LED_WIFI_CONNECTING);

    Serial.printf("[WiFi] Connecting to '%s'", wifiSsid.c_str());
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 30) {
        digitalWrite(STATUS_LED_PIN, (attempts % 2 == 0) ? HIGH : LOW);
        delay(500);
        Serial.print(".");
        attempts++;
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.println("\n[WiFi] ✅ Connected — Local IP: " + WiFi.localIP().toString());
        triggerLedPattern(LED_WIFI_SUCCESS);
    } else {
        Serial.println("\n[WiFi] ❌ Connection failed. Falling back to Setup Access Point.");
        setLedMode(LED_MQTT_FAILED);
        delay(1000);
        startAccessPoint();
        return;
    }

    // TLS Configuration
    wifiClient.setInsecure(); // Skip strict CA checking for cloud HiveMQ broker
    mqttClient.setServer(mqttHost.c_str(), mqttPort);
    mqttClient.setCallback(onMqttMessage);
    mqttClient.setBufferSize(1024);

    connectMQTT();
}

// ==========================================================================
// MQTT Inbound Callback (OTA Configuration & Relay Control)
// ==========================================================================
void onMqttMessage(char* topic, byte* payload, unsigned int length) {
    String topicStr = String(topic);
    String payloadStr = "";
    for (unsigned int i = 0; i < length; i++) payloadStr += (char)payload[i];

    Serial.println("[MQTT] ← " + topicStr + " " + payloadStr);

    // 1. Handle Dynamic Pin Configuration from Dashboard
    // Topic: <baseTopic>/nodes/<nodeId>/configure
    String configTopic = baseTopic + "/nodes/" + nodeId + "/configure";
    if (topicStr == configTopic) {
        Serial.println("[MQTT] ⚙️ Processing dynamic pin configuration...");
        
        // Check for room assignment
        int roomIdx = payloadStr.indexOf("\"room\":\"");
        if (roomIdx >= 0) {
            int endRoom = payloadStr.indexOf("\"", roomIdx + 8);
            if (endRoom > 0) {
                nodeRoom = payloadStr.substring(roomIdx + 8, endRoom);
                prefs.begin("smarthub", false);
                prefs.putString("room", nodeRoom);
                prefs.end();
                espLog(String("[Config] Room assigned: ") + nodeRoom);
            }
        }

        // Parse dynamic pin array: [{"gpio":4,"deviceId":"device-bed-4","type":"light","name":"Main Light"},...]
        int pinsStart = payloadStr.indexOf("\"pins\":[");
        if (pinsStart >= 0) {
            int currentPos = pinsStart + 8;
            int count = 0;
            prefs.begin("smarthub_pins", false);
            prefs.clear();

            while (count < MAX_CHANNELS) {
                int objStart = payloadStr.indexOf('{', currentPos);
                if (objStart < 0) break;
                int objEnd = payloadStr.indexOf('}', objStart);
                if (objEnd < 0) break;

                String item = payloadStr.substring(objStart, objEnd + 1);

                // Extract gpio
                int gpioIdx = item.indexOf("\"gpio\":");
                int gpio = -1;
                if (gpioIdx >= 0) {
                    gpio = item.substring(gpioIdx + 7).toInt();
                }

                // Extract deviceId
                String devId = "";
                int devIdIdx = item.indexOf("\"deviceId\":\"");
                if (devIdIdx >= 0) {
                    int endDev = item.indexOf("\"", devIdIdx + 12);
                    if (endDev > 0) devId = item.substring(devIdIdx + 12, endDev);
                }

                // Extract name
                String devName = "";
                int nameIdx = item.indexOf("\"name\":\"");
                if (nameIdx >= 0) {
                    int endName = item.indexOf("\"", nameIdx + 8);
                    if (endName > 0) devName = item.substring(nameIdx + 8, endName);
                }

                // Extract type
                String devType = "light";
                int typeIdx = item.indexOf("\"type\":\"");
                if (typeIdx >= 0) {
                    int endType = item.indexOf("\"", typeIdx + 8);
                    if (endType > 0) devType = item.substring(typeIdx + 8, endType);
                }

                if (gpio >= 0) {
                    channels[count].relayGpio = gpio;
                    channels[count].buttonGpio = -1; // disable button on this pin to prevent loopback
                    strncpy(channels[count].deviceId, devId.c_str(), sizeof(channels[count].deviceId) - 1);
                    strncpy(channels[count].name, devName.c_str(), sizeof(channels[count].name) - 1);
                    strncpy(channels[count].type, devType.c_str(), sizeof(channels[count].type) - 1);
                    channels[count].active = true;

                    // Restore state for this deviceId from NVS so it preserves state across OTA configuration
                    prefs.begin("smarthub_state", true);
                    channels[count].state = prefs.getBool(devId.c_str(), false);
                    if (devType == "light") {
                        char bKey[48];
                        snprintf(bKey, sizeof(bKey), "b_%s", devId.c_str());
                        channels[count].brightness = prefs.getInt(bKey, 80);
                    } else if (devType == "fan") {
                        char sKey[48];
                        snprintf(sKey, sizeof(sKey), "s_%s", devId.c_str());
                        channels[count].speed = prefs.getInt(sKey, 3);
                    }
                    prefs.end();

                    pinMode(gpio, OUTPUT);
                    applyChannelOutput(count);

                    // Save pin mapping in NVS
                    char kG[16], kI[16], kN[16], kT[16];
                    sprintf(kG, "g_%d", count);
                    sprintf(kI, "i_%d", count);
                    sprintf(kN, "n_%d", count);
                    sprintf(kT, "t_%d", count);

                    prefs.putInt(kG, gpio);
                    prefs.putString(kI, devId);
                    prefs.putString(kN, devName);
                    prefs.putString(kT, devType);

                    espLog(String("[Config] 📌 Channel ") + (count + 1) +
                           " mapped: GPIO " + gpio +
                           " → '" + devName + "' (" + devId + ")");
                    count++;
                }
                currentPos = objEnd + 1;
            }
            totalChannels = count;
            prefs.putInt("total_ch", totalChannels);
            prefs.end();
            espLog(String("[Config] ✅ Total ") + totalChannels + " dynamic channels saved to Flash NVS.");
        }

        // Re-announce discovery with updated paired status
        publishDiscoveryAnnounce();
        return;
    }

    // 2. Handle Node Commands (Identify, Unpair, Reset)
    // Topic: <baseTopic>/nodes/<nodeId>/cmd
    String cmdTopic = baseTopic + "/nodes/" + nodeId + "/cmd";
    if (topicStr == cmdTopic) {
        if (payloadStr.indexOf("\"cmd\":\"identify\"") >= 0) {
            Serial.println("[CMD] 💡 Identifying physical device!");
            triggerLedPattern(LED_IDENTIFY);
        } else if (payloadStr.indexOf("\"cmd\":\"unpair\"") >= 0) {
            Serial.println("[CMD] 🔗 Unpairing device from room...");
            nodeRoom = "";
            prefs.begin("smarthub", false);
            prefs.remove("room");
            prefs.end();
            publishDiscoveryAnnounce();
        } else if (payloadStr.indexOf("\"cmd\":\"reset_wifi\"") >= 0) {
            Serial.println("[CMD] ⚠️ Factory Resetting Wi-Fi...");
            prefs.begin("smarthub", false);
            prefs.clear();
            prefs.end();
            delay(500);
            ESP.restart();
        }
        return;
    }

    // 3. Handle Relay Toggle Set Command
    // Topic: <baseTopic>/devices/<id>/set
    String setPrefix = baseTopic + "/devices/";
    String setSuffix = "/set";
    if (topicStr.startsWith(setPrefix) && topicStr.endsWith(setSuffix)) {
        String devId = topicStr.substring(setPrefix.length(), topicStr.length() - setSuffix.length());
        
        int channelIdx = -1;
        for (int i = 0; i < totalChannels; i++) {
            if (String(channels[i].deviceId) == devId) {
                channelIdx = i;
                break;
            }
        }

        if (channelIdx >= 0) {
            bool stateChanged = false;

            // 1. Parse ON / OFF
            if (payloadStr.indexOf("\"on\":true") >= 0 || payloadStr.indexOf("\"on\": true") >= 0) {
                if (!channels[channelIdx].state) {
                    channels[channelIdx].state = true;
                    stateChanged = true;
                }
            } else if (payloadStr.indexOf("\"on\":false") >= 0 || payloadStr.indexOf("\"on\": false") >= 0) {
                if (channels[channelIdx].state) {
                    channels[channelIdx].state = false;
                    stateChanged = true;
                }
            }

            String devType = String(channels[channelIdx].type);

            // 2. Parse Brightness (0 - 100) — ONLY for light devices
            if (devType == "light") {
                int bIdx = payloadStr.indexOf("\"brightness\":");
                if (bIdx >= 0) {
                    int bVal = payloadStr.substring(bIdx + 13).toInt();
                    if (bVal >= 0 && bVal <= 100 && bVal != channels[channelIdx].brightness) {
                        channels[channelIdx].brightness = bVal;
                        stateChanged = true;
                    }
                }
            }

            // 3. Parse Fan Speed (1 - 3) — ONLY for fan devices
            if (devType == "fan") {
                int sIdx = payloadStr.indexOf("\"speed\":");
                if (sIdx >= 0) {
                    int sVal = payloadStr.substring(sIdx + 8).toInt();
                    if (sVal >= 1 && sVal <= 3 && sVal != channels[channelIdx].speed) {
                        channels[channelIdx].speed = sVal;
                        stateChanged = true;
                    }
                }
            }

            if (stateChanged) {
                applyChannelOutput(channelIdx);
                saveDeviceState(channelIdx);
                triggerActionBlink();

                String logMsg = String("[Device ") + channelIdx +
                               " / GPIO " + channels[channelIdx].relayGpio +
                               "] " + devId + " → " + (channels[channelIdx].state ? "ON" : "OFF");
                if (devType == "light") {
                    logMsg += " (Bright: " + String(channels[channelIdx].brightness) + "%)";
                } else if (devType == "fan") {
                    logMsg += " (Speed: " + String(channels[channelIdx].speed) + ")";
                }
                espLog(logMsg);
                publishState(channelIdx, "command");
            }
        }
    }
}

// ==========================================================================
// MQTT Outbound Helpers
// ==========================================================================
void publishState(int idx, const char* source) {
    if (!mqttClient.connected()) return;
    String topic = baseTopic + "/devices/" + String(channels[idx].deviceId) + "/state";
    String devType = String(channels[idx].type);

    String payload = "{\"on\":" + String(channels[idx].state ? "true" : "false");
    if (devType == "light") {
        payload += ",\"brightness\":" + String(channels[idx].brightness);
    } else if (devType == "fan") {
        payload += ",\"speed\":" + String(channels[idx].speed);
    }
    payload += ",\"source\":\"" + String(source) + "\"}";

    mqttClient.publish(topic.c_str(), payload.c_str(), true);
    Serial.println("[MQTT] → " + topic + " " + payload);
}

void publishDiscoveryAnnounce() {
    if (!mqttClient.connected()) return;
    String topic = baseTopic + "/discovery/announce";
    
    String payload = "{";
    payload += "\"nodeId\":\"" + nodeId + "\",";
    payload += "\"mac\":\"" + chipMac + "\",";
    payload += "\"ip\":\"" + WiFi.localIP().toString() + "\",";
    payload += "\"rssi\":" + String(WiFi.RSSI()) + ",";
    payload += "\"chip\":\"ESP32-WROOM-32\",";
    payload += "\"firmware\":\"" FIRMWARE_VERSION "\",";
    payload += "\"paired\":" + String(nodeRoom.length() > 0 ? "true" : "false") + ",";
    payload += "\"room\":\"" + nodeRoom + "\",";
    // Build dynamic relay list from active channels
    payload += "\"relays\":["; 
    for (int i = 0; i < totalChannels; i++) {
        if (i > 0) payload += ",";
        payload += String(channels[i].relayGpio);
    }
    payload += "],";

    // Build dynamic button list from active channels
    payload += "\"buttons\":["; 
    for (int i = 0; i < totalChannels; i++) {
        if (i > 0) payload += ",";
        payload += String(channels[i].buttonGpio);
    }
    payload += "]";
    payload += "}";

    mqttClient.publish(topic.c_str(), payload.c_str(), true);
    Serial.println("[MQTT] 📡 Auto-Discovery Announce Published: " + nodeId);
}

void publishNodePresence(const char* status) {
    if (!mqttClient.connected()) return;
    String topic = baseTopic + "/nodes/" + nodeId + "/status";
    String payload = "{\"status\":\"" + String(status) +
                     "\",\"nodeId\":\"" + nodeId +
                     "\",\"ip\":\"" + WiFi.localIP().toString() +
                     "\",\"rssi\":" + String(WiFi.RSSI()) + "}";
    mqttClient.publish(topic.c_str(), payload.c_str(), true);
}

void sendHeartbeat() {
    if (!mqttClient.connected()) return;
    String topic = baseTopic + "/nodes/" + nodeId + "/heartbeat";
    String payload = "{\"nodeId\":\"" + nodeId +
                     "\",\"uptime\":" + String(millis() / 1000) +
                     ",\"rssi\":" + String(WiFi.RSSI()) +
                     ",\"freeHeap\":" + String(ESP.getFreeHeap()) + "}";
    mqttClient.publish(topic.c_str(), payload.c_str(), false);
}

void espLog(const String& msg) {
    Serial.println(msg);
    if (mqttClient.connected()) {
        String logTopic = baseTopic + "/nodes/" + nodeId + "/log";
        mqttClient.publish(logTopic.c_str(), msg.c_str(), false);
    }
}

void connectMQTT() {
    static unsigned long lastMqttAttempt = 0;
    // Non-blocking cooldown: retry connection every 4 seconds without freezing the ESP32
    if (millis() - lastMqttAttempt < 4000 && lastMqttAttempt != 0) {
        return;
    }
    lastMqttAttempt = millis();

    Serial.printf("[MQTT] Connecting to %s:%d (Client: %s)...\n", mqttHost.c_str(), mqttPort, nodeId.c_str());
    setLedMode(LED_MQTT_CONNECTING);

    String willTopic = baseTopic + "/nodes/" + nodeId + "/status";
    String willPayload = "{\"status\":\"offline\",\"nodeId\":\"" + nodeId + "\"}";

    if (mqttClient.connect(nodeId.c_str(), mqttUser.c_str(), mqttPass.c_str(),
                           willTopic.c_str(), 1, true, willPayload.c_str())) {
        Serial.println("[MQTT] ✅ Broker Connected!");
        setLedMode(LED_IDLE);

        // 1. Publish Presence & Auto-Discovery
        publishNodePresence("online");
        publishDiscoveryAnnounce();

        // 2. Subscriptions
        String subDevices = baseTopic + "/devices/+/set";
        String subConfig  = baseTopic + "/nodes/" + nodeId + "/configure";
        String subCmd     = baseTopic + "/nodes/" + nodeId + "/cmd";
        
        mqttClient.subscribe(subDevices.c_str(), 1);
        mqttClient.subscribe(subConfig.c_str(), 1);
        mqttClient.subscribe(subCmd.c_str(), 1);

        // 3. Publish initial relay states
        for (int i = 0; i < totalChannels; i++) {
            publishState(i, "boot");
        }
    } else {
        Serial.printf("[MQTT] ❌ Connection failed (state: %d). Will retry in 4s...\n", mqttClient.state());
        setLedMode(LED_MQTT_FAILED);
    }
}
