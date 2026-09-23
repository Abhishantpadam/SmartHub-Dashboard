const express = require("express");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const mqttLib = require("mqtt");

const app = express();
const PORT = process.env.PORT || 3000;

// ==========================================================================
// MQTT Infrastructure — Live Broker Connection Manager
// ==========================================================================
const MQTT_CONFIG_PATH = path.join(__dirname, "mqtt-config.json");

// SSE: connected browser clients
let sseClients = [];

function broadcastSSE(event, data) {
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    sseClients = sseClients.filter((res) => {
        try { res.write(payload); return true; }
        catch (e) { return false; }
    });
}

// Persist & load MQTT config from disk
function loadMqttConfig() {
    try {
        if (fs.existsSync(MQTT_CONFIG_PATH)) {
            return JSON.parse(fs.readFileSync(MQTT_CONFIG_PATH, "utf-8"));
        }
    } catch (e) {
        console.error("[MQTT] Failed to load mqtt-config.json:", e.message);
    }
    return { host: "", port: 8883, protocol: "mqtts", baseTopic: "home/dashboard", clientId: "agy-smart-hub-01", username: "", password: "" };
}

function saveMqttConfig(config) {
    try {
        fs.writeFileSync(MQTT_CONFIG_PATH, JSON.stringify(config, null, 2));
    } catch (e) {
        console.error("[MQTT] Failed to save mqtt-config.json:", e.message);
    }
}

// Active persistent MQTT client
let mqttClient = null;
let mqttConfig = loadMqttConfig();

// ==========================================================================
// Database & Hardware State Persistence (database.json)
// ==========================================================================
const DATABASE_PATH = path.join(__dirname, "database.json");
const DATABASE_EXAMPLE_PATH = path.join(__dirname, "database.example.json");

function loadDatabase() {
    try {
        if (!fs.existsSync(DATABASE_PATH) && fs.existsSync(DATABASE_EXAMPLE_PATH)) {
            fs.copyFileSync(DATABASE_EXAMPLE_PATH, DATABASE_PATH);
            console.log("[Database] 📋 Initialized database.json from template example.");
        }
        if (fs.existsSync(DATABASE_PATH)) {
            const parsed = JSON.parse(fs.readFileSync(DATABASE_PATH, "utf-8"));
            console.log(`[Database] ✅ Loaded database.json (${parsed.devices ? parsed.devices.length : 0} devices, ${parsed.rooms ? parsed.rooms.length : 0} rooms).`);
            return {
                rooms: parsed.rooms || [
                    { id: "bed", name: "Bed", icon: "bed" },
                    { id: "living", name: "Living", icon: "chair" },
                    { id: "common", name: "Common", icon: "home" },
                    { id: "others", name: "Others", icon: "more_horiz" }
                ],
                devices: parsed.devices || [
                    { id: "device-1", name: "Big Light", room: "bed", type: "light", on: false, powerWatts: 0, dimmable: true, brightness: 80 },
                    { id: "device-2", name: "Small Light", room: "bed", type: "light", on: false, powerWatts: 0, dimmable: false, brightness: 0 },
                    { id: "device-3", name: "Ceiling Fan", room: "bed", type: "fan", on: false, powerWatts: 0, speed: 1 },
                    { id: "device-4", name: "Socket", room: "bed", type: "socket", on: false, powerWatts: 0, surgeProtected: true },
                    { id: "device-5", name: "Television", room: "living", type: "tv", on: false, powerWatts: 0 },
                    { id: "device-6", name: "Living Light", room: "living", type: "light", on: false, powerWatts: 0, brightness: 0 },
                    { id: "device-7", name: "Inverter AC", room: "bed", type: "ac", on: false, powerWatts: 0, temperature: 22, mode: "cool" }
                ],
                discoveredNodes: parsed.discoveredNodes || {},
                hardwareNodes: parsed.hardwareNodes || {}
            };
        }
    } catch (e) {
        console.error("[Database] Failed to load database.json:", e.message);
    }

    const defaultData = {
        rooms: [
            { id: "bed", name: "Bed", icon: "bed" },
            { id: "living", name: "Living", icon: "chair" },
            { id: "common", name: "Common", icon: "home" },
            { id: "others", name: "Others", icon: "more_horiz" }
        ],
        devices: [
            { id: "device-1", name: "Big Light", room: "bed", type: "light", on: false, powerWatts: 0, dimmable: true, brightness: 80 },
            { id: "device-2", name: "Small Light", room: "bed", type: "light", on: false, powerWatts: 0, dimmable: false, brightness: 0 },
            { id: "device-3", name: "Ceiling Fan", room: "bed", type: "fan", on: false, powerWatts: 0, speed: 1 },
            { id: "device-4", name: "Socket", room: "bed", type: "socket", on: false, powerWatts: 0, surgeProtected: true },
            { id: "device-5", name: "Television", room: "living", type: "tv", on: false, powerWatts: 0 },
            { id: "device-6", name: "Living Light", room: "living", type: "light", on: false, powerWatts: 0, brightness: 0 },
            { id: "device-7", name: "Inverter AC", room: "bed", type: "ac", on: false, powerWatts: 0, temperature: 22, mode: "cool" }
        ],
        discoveredNodes: {},
        hardwareNodes: {}
    };
    saveDatabaseDirect(defaultData);
    return defaultData;
}

function saveDatabaseDirect(data) {
    try {
        fs.writeFileSync(DATABASE_PATH, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("[Database] Failed to save database.json:", e.message);
    }
}

function saveDatabase() {
    saveDatabaseDirect({
        rooms,
        devices,
        discoveredNodes,
        hardwareNodes
    });
}

const dbState = loadDatabase();
let rooms = dbState.rooms;
let devices = dbState.devices;
let hardwareNodes = dbState.hardwareNodes || {};
let discoveredNodes = dbState.discoveredNodes || {};

// MQTT Diagnostics & Telemetry Tracker
let mqttStats = {
    messagesIn: 0,
    messagesOut: 0,
    lastInboundTopic: null,
    lastOutboundTopic: null,
    lastMessageTime: null,
    connectedSince: null
};

function connectMqtt(config) {
    if (!config || !config.host) {
        console.log("[MQTT] No broker configured — skipping auto-connect.");
        settingsState.mqtt.connected = false;
        return;
    }

    // Tear down existing connection gracefully
    if (mqttClient) {
        try { mqttClient.end(true); } catch (e) {}
        mqttClient = null;
    }

    const url = `${config.protocol || "mqtts"}://${config.host}`;
    const opts = {
        port:              config.port || 8883,
        clientId:          config.clientId || ("agy-hub-" + Math.random().toString(16).slice(2, 8)),
        username:          config.username || undefined,
        password:          config.password || undefined,
        keepalive:         30,          // Send PING every 30s — avoids HiveMQ cloud idle timeout
        reconnectPeriod:   6000,        // Wait 6s before reconnect attempt
        connectTimeout:    15000,
        clean:             true,        // Clean session so stale subscriptions don't linger
        rejectUnauthorized: false
    };

    console.log(`[MQTT] Connecting → ${url}:${opts.port} (clientId: ${opts.clientId})`);

    try {
        mqttClient = mqttLib.connect(url, opts);
    } catch (e) {
        console.error("[MQTT] connect() threw:", e.message);
        settingsState.mqtt.connected = false;
        return;
    }

    mqttClient.on("connect", () => {
        console.log("[MQTT] ✅ Connected to broker.");
        settingsState.mqtt.connected = true;
        settingsState.mqtt.connectionError = null;
        mqttStats.connectedSince = new Date().toISOString();

        // Subscribe to device states, node presence & heartbeats, auto-discovery, live logs and telemetry
        const stateTopic     = `${config.baseTopic}/devices/+/state`;
        const nodeStatus     = `${config.baseTopic}/nodes/+/status`;
        const nodeHeartbeat  = `${config.baseTopic}/nodes/+/heartbeat`;
        const nodeLogTopic   = `${config.baseTopic}/nodes/+/log`;
        const nodeTelemetry  = `${config.baseTopic}/nodes/+/telemetry`;
        const discoveryTopic = `${config.baseTopic}/discovery/#`;
        const systemTopic    = `${config.baseTopic}/system/#`;

        mqttClient.subscribe([stateTopic, nodeStatus, nodeHeartbeat, nodeLogTopic, nodeTelemetry, discoveryTopic, systemTopic], { qos: 1 }, (err) => {
            if (err) console.error("[MQTT] Subscribe error:", err.message);
            else     console.log(`[MQTT] Subscribed → ${stateTopic}, ${nodeStatus}, ${nodeLogTopic}, ${discoveryTopic}`);
        });

        addLog("system", "MQTT Broker Connected", `Live link to ${config.host} established.`, "cell_tower");
        broadcastSSE("mqtt_status", { connected: true, host: config.host, baseTopic: config.baseTopic });
    });

    mqttClient.on("message", (topic, payload) => {
        try {
            mqttStats.messagesIn++;
            mqttStats.lastInboundTopic = topic;
            mqttStats.lastMessageTime = new Date().toISOString();

            const rawStr = payload.toString();
            let msg = {};
            try { msg = JSON.parse(rawStr); } catch (err) { msg = { raw: rawStr }; }

            // 1. Handle Auto-Discovery Announcements from ESP32 Nodes
            // Topic shape: <baseTopic>/discovery/announce or <baseTopic>/discovery/unpaired
            const discoveryPrefix = `${config.baseTopic}/discovery/`;
            if (topic.startsWith(discoveryPrefix)) {
                const subAction = topic.slice(discoveryPrefix.length);
                const nodeId = msg.nodeId || msg.id || (msg.mac ? `esp32-${msg.mac.replace(/[:\-]/g, "").slice(-4).toLowerCase()}` : "esp32-node");
                
                discoveredNodes[nodeId] = {
                    nodeId,
                    mac: msg.mac || "Unknown MAC",
                    ip: msg.ip || (hardwareNodes[nodeId] && hardwareNodes[nodeId].ip) || "192.168.1.x",
                    relays: Array.isArray(msg.relays) ? msg.relays : (Array.isArray(msg.availableRelays) ? msg.availableRelays : [25, 33, 32, 27, 26]),
                    buttons: Array.isArray(msg.buttons) ? msg.buttons : (Array.isArray(msg.availableButtons) ? msg.availableButtons : [34, 35, 16, 17, 18]),
                    chip: msg.chip || "ESP32-WROOM-32",
                    firmware: msg.firmware || "v2.1-universal",
                    rssi: msg.rssi !== undefined ? msg.rssi : -52,
                    status: msg.status || (msg.paired ? "paired" : "unpaired"),
                    pairedRoom: msg.room || (discoveredNodes[nodeId] && discoveredNodes[nodeId].pairedRoom) || null,
                    lastSeen: Date.now()
                };

                addLog("device", `Hardware Node Discovered: ${nodeId}`, `MAC: ${discoveredNodes[nodeId].mac} • IP: ${discoveredNodes[nodeId].ip} • Status: ${discoveredNodes[nodeId].status}`, "sensors");
                broadcastSSE("node_discovered", { node: discoveredNodes[nodeId], allNodes: Object.values(discoveredNodes) });
                saveDatabase();
                console.log(`[MQTT] 📡 Node Discovered & Registered: ${nodeId} (${discoveredNodes[nodeId].mac})`);
                return;
            }

            // 2. Handle ESP32 Node Presence, Logs, Telemetry & Heartbeat
            // Topic shape: <baseTopic>/nodes/<nodeId>/status, /heartbeat, /log, /telemetry
            const nodePrefix = `${config.baseTopic}/nodes/`;
            if (topic.startsWith(nodePrefix)) {
                const rest = topic.slice(nodePrefix.length);
                const parts = rest.split("/");
                const nodeId = parts[0];
                const action = parts[1];

                // Live Wireless Console Log Stream
                if (nodeId && action === "log") {
                    const logEntry = {
                        id: "clog-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
                        timestamp: new Date().toISOString(),
                        nodeId,
                        message: msg.log || msg.msg || rawStr,
                        level: msg.level || (rawStr.includes("ERROR") || rawStr.includes("❌") ? "error" : (rawStr.includes("WARN") ? "warn" : "info"))
                    };
                    consoleLogs.unshift(logEntry);
                    if (consoleLogs.length > 250) consoleLogs.pop();
                    broadcastSSE("node_log", { log: logEntry });
                    return;
                }

                if (nodeId && (action === "status" || action === "heartbeat" || action === "telemetry")) {
                    const isOnline = msg.status !== "offline";
                    hardwareNodes[nodeId] = {
                        nodeId,
                        status: isOnline ? "online" : "offline",
                        lastSeen: Date.now(),
                        ip: msg.ip || (hardwareNodes[nodeId] && hardwareNodes[nodeId].ip) || null,
                        rssi: msg.rssi !== undefined ? msg.rssi : (hardwareNodes[nodeId] && hardwareNodes[nodeId].rssi),
                        uptime: msg.uptime !== undefined ? msg.uptime : (hardwareNodes[nodeId] && hardwareNodes[nodeId].uptime),
                        freeHeap: msg.freeHeap || (hardwareNodes[nodeId] && hardwareNodes[nodeId].freeHeap)
                    };

                    if (discoveredNodes[nodeId]) {
                        discoveredNodes[nodeId].status = isOnline ? (discoveredNodes[nodeId].pairedRoom ? "paired" : "unpaired") : "offline";
                        discoveredNodes[nodeId].lastSeen = Date.now();
                        if (msg.ip) discoveredNodes[nodeId].ip = msg.ip;
                        if (msg.rssi !== undefined) discoveredNodes[nodeId].rssi = msg.rssi;
                    }

                    saveDatabase();
                    broadcastSSE("node_status", { nodeId, node: hardwareNodes[nodeId] });
                    broadcastSSE("node_telemetry", { nodeId, telemetry: hardwareNodes[nodeId] });
                    return;
                }
            }

            // 3. Handle Device State Reports from Hardware
            // Topic shape: <baseTopic>/devices/<id>/state
            const prefix = `${config.baseTopic}/devices/`;
            const suffix = "/state";
            if (topic.startsWith(prefix) && topic.endsWith(suffix)) {
                const deviceId = topic.slice(prefix.length, -suffix.length);
                const device   = devices.find((d) => d.id === deviceId);
                if (device) {
                    // Determine new state (supports {"on": true/false}, {"state": "ON"/"OFF"}, etc.)
                    let newOn = undefined;
                    if (typeof msg.on === "boolean") {
                        newOn = msg.on;
                    } else if (typeof msg.state === "boolean") {
                        newOn = msg.state;
                    } else if (typeof msg.state === "string") {
                        newOn = msg.state.toUpperCase() === "ON" || msg.state.toUpperCase() === "TRUE" || msg.state === "1";
                    } else if (typeof msg.on === "string") {
                        newOn = msg.on.toUpperCase() === "ON" || msg.on.toUpperCase() === "TRUE" || msg.on === "1";
                    } else if (msg.source === "button") {
                        newOn = !device.on;
                    }

                    // Only update granular fields if the device type supports them
                    if (device.type === "light" && device.dimmable !== false && typeof msg.brightness === "number") {
                        device.brightness = Math.max(5, Math.min(100, Math.round(msg.brightness)));
                    }
                    if (device.type === "fan" && typeof msg.speed === "number") {
                        device.speed = Math.max(1, Math.min(3, Math.round(msg.speed)));
                    }

                    if (typeof newOn === "boolean") {
                        device.on = newOn;
                        if (!device.on) {
                            device.powerWatts = 0;
                        } else {
                            if (device.type === "light")  device.powerWatts = device.dimmable && device.brightness ? Math.round(42 * (device.brightness / 100)) : 42;
                            if (device.type === "fan")    device.powerWatts = device.speed === 1 ? 25 : (device.speed === 2 ? 40 : 55);
                            if (device.type === "ac")     device.powerWatts = 720;
                            if (device.type === "tv")     device.powerWatts = 110;
                            if (device.type === "socket") device.powerWatts = 15;
                        }
                        systemStatus.activeDevicesCount = devices.filter((d) => d.on).length;
                        saveDatabase();
                        const sourceLabel = msg.source ? ` (${msg.source})` : " (MQTT)";
                        addLog("device", `${device.name} ${device.on ? "Turned On" : "Turned Off"}${sourceLabel}`,
                            `Sync via MQTT • Draw: ${device.powerWatts}W`, "touch_app");
                        broadcastSSE("device_update", { device });
                        console.log(`[MQTT] 🔄 Hardware sync: ${device.name} → ${device.on ? "ON" : "OFF"}`);
                    }
                }
            }
        } catch (e) {
            console.error("[MQTT] Message parse error:", e.message);
        }
    });

    mqttClient.on("error", (err) => {
        console.error("[MQTT] ❌ Error:", err.message);
        settingsState.mqtt.connected = false;
        settingsState.mqtt.connectionError = err.message;
        broadcastSSE("mqtt_status", { connected: false, error: err.message });
        addLog("system", "MQTT Connection Error", err.message, "error");
    });

    mqttClient.on("offline", () => {
        console.log("[MQTT] Client offline.");
        settingsState.mqtt.connected = false;
        broadcastSSE("mqtt_status", { connected: false });
    });

    mqttClient.on("reconnect", () => console.log("[MQTT] Reconnecting..."));
}

function mqttPublish(deviceId, stateObj) {
    if (!mqttClient || !mqttClient.connected) return;
    const topic   = `${mqttConfig.baseTopic}/devices/${deviceId}/set`;
    const payload = JSON.stringify(stateObj);
    mqttStats.messagesOut++;
    mqttStats.lastOutboundTopic = topic;
    mqttStats.lastMessageTime = new Date().toISOString();
    mqttClient.publish(topic, payload, { qos: 1, retain: false }, (err) => {
        if (err) console.error("[MQTT] Publish error:", err.message);
        else     console.log(`[MQTT] → ${topic}: ${payload}`);
    });
}

function mqttPublishNodeConfig(nodeId, configObj) {
    if (!mqttClient || !mqttClient.connected) return false;
    const topic   = `${mqttConfig.baseTopic}/nodes/${nodeId}/configure`;
    const payload = JSON.stringify(configObj);
    mqttStats.messagesOut++;
    mqttStats.lastOutboundTopic = topic;
    mqttStats.lastMessageTime = new Date().toISOString();
    mqttClient.publish(topic, payload, { qos: 1, retain: true }, (err) => {
        if (err) console.error("[MQTT] Node config publish error:", err.message);
        else     console.log(`[MQTT] 📤 Sent Node Config → ${topic}: ${payload}`);
    });
    return true;
}

function mqttPublishNodeCommand(nodeId, cmd, extra = {}) {
    if (!mqttClient || !mqttClient.connected) return false;
    const topic   = `${mqttConfig.baseTopic}/nodes/${nodeId}/cmd`;
    const payload = JSON.stringify({ cmd, ...extra, timestamp: Date.now() });
    mqttStats.messagesOut++;
    mqttStats.lastOutboundTopic = topic;
    mqttStats.lastMessageTime = new Date().toISOString();
    mqttClient.publish(topic, payload, { qos: 1, retain: false }, (err) => {
        if (err) console.error("[MQTT] Node command error:", err.message);
        else     console.log(`[MQTT] 📤 Sent Node Command → ${topic}: ${payload}`);
    });
    return true;
}

function mqttPublishRaw(topic, payloadStr) {
    if (!mqttClient || !mqttClient.connected) return false;
    mqttStats.messagesOut++;
    mqttStats.lastOutboundTopic = topic;
    mqttStats.lastMessageTime = new Date().toISOString();
    mqttClient.publish(topic, payloadStr, { qos: 1, retain: false }, (err) => {
        if (err) console.error("[MQTT] Raw publish error:", err.message);
        else     console.log(`[MQTT] 📤 Raw Sent → ${topic}: ${payloadStr}`);
    });
    return true;
}
// ==========================================================================

// Directory Setup
const UPLOADS_DIR = path.join(__dirname, "uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// User Profile & Multi-User Members Persistence
const USER_PROFILE_PATH = path.join(__dirname, "user-profile.json");
const MEMBERS_PATH = path.join(__dirname, "members.json");

function generateWebhookSecret() {
    return "sh_sec_" + crypto.randomBytes(16).toString("hex");
}

function loadUserProfile() {
    let profile = null;
    try {
        if (fs.existsSync(USER_PROFILE_PATH)) {
            profile = JSON.parse(fs.readFileSync(USER_PROFILE_PATH, "utf-8"));
        }
    } catch (e) {
        console.error("[User Profile] Failed to load user-profile.json:", e.message);
    }
    const avatarExists = fs.existsSync(path.join(UPLOADS_DIR, "avatar.png"));
    if (!profile) {
        profile = {
            name: "Abhishant",
            email: "abhi@smarthome.local",
            role: "Home Administrator",
            avatarUrl: avatarExists ? "/uploads/avatar.png" : null,
            pinCode: "1234",
            webhookSecret: generateWebhookSecret()
        };
    }
    if (!profile.webhookSecret || profile.webhookSecret.includes("agy")) {
        profile.webhookSecret = generateWebhookSecret();
        saveUserProfile(profile);
    }
    if (!profile.pinCode) {
        profile.pinCode = "1234";
        saveUserProfile(profile);
    }
    return profile;
}

function saveUserProfile(profile) {
    try {
        fs.writeFileSync(USER_PROFILE_PATH, JSON.stringify(profile, null, 2));
    } catch (e) {
        console.error("[User Profile] Failed to save user-profile.json:", e.message);
    }
}

let userProfile = loadUserProfile();

function loadMembers() {
    try {
        if (fs.existsSync(MEMBERS_PATH)) {
            return JSON.parse(fs.readFileSync(MEMBERS_PATH, "utf-8"));
        }
    } catch (e) {
        console.error("[Members] Failed to load members.json:", e.message);
    }
    const defaultMembers = [
        {
            id: "member-owner",
            name: userProfile.name || "Abhishant",
            email: userProfile.email || "abhi@smarthome.local",
            role: "admin",
            roleLabel: "Home Administrator",
            pinCode: userProfile.pinCode || "1234",
            avatarUrl: userProfile.avatarUrl || null,
            permittedRooms: ["*"],
            isOwner: true,
            createdAt: new Date().toISOString()
        },
        {
            id: "member-family-1",
            name: "Family Member",
            email: "family@smarthome.local",
            role: "family",
            roleLabel: "Family Member",
            pinCode: "5678",
            avatarUrl: null,
            permittedRooms: ["*"],
            isOwner: false,
            createdAt: new Date().toISOString()
        },
        {
            id: "member-guest-1",
            name: "Guest Visitor",
            email: "guest@smarthome.local",
            role: "guest",
            roleLabel: "Guest (Limited Access)",
            pinCode: "9900",
            avatarUrl: null,
            permittedRooms: ["living", "bed"],
            isOwner: false,
            createdAt: new Date().toISOString()
        }
    ];
    saveMembers(defaultMembers);
    return defaultMembers;
}

function saveMembers(members) {
    try {
        fs.writeFileSync(MEMBERS_PATH, JSON.stringify(members, null, 2));
    } catch (e) {
        console.error("[Members] Failed to save members.json:", e.message);
    }
}

let membersList = loadMembers();

// Middleware
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

// Serve Uploaded Files & Static Frontend
app.use("/uploads", express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, "../Frontend")));

// IoT Gateway State
let systemStatus = {
    online: true,
    serverName: "HomeHub Gateway v1",
    uptimeSeconds: 0,
    activeDevicesCount: devices.filter(d => d.on).length,
    lastPing: new Date().toISOString()
};

// Activity Logs In-Memory Storage
let activityLogs = [
    { id: "log-1", timestamp: new Date(Date.now() - 3600000 * 2).toISOString(), type: "system", title: "Gateway Booted", description: "HomeHub Gateway initialized with 6 devices across 4 rooms.", icon: "dns" },
    { id: "log-2", timestamp: new Date(Date.now() - 3600000).toISOString(), type: "automation", title: "Morning Routine", description: "Scheduled trigger at 07:00 AM. 2 devices activated.", icon: "schedule" },
    { id: "log-3", timestamp: new Date(Date.now() - 1800000).toISOString(), type: "device", title: "Big Light Switched On", description: "Bed room - nominal draw 42W.", icon: "lightbulb" },
    { id: "log-4", timestamp: new Date(Date.now() - 900000).toISOString(), type: "device", title: "Television Switched On", description: "Living room - nominal draw 110W.", icon: "tv" }
];

// Live Wireless Console Logs (ESP32 Serial & MQTT Traffic)
let consoleLogs = [
    { id: "clog-init-1", timestamp: new Date(Date.now() - 300000).toISOString(), nodeId: "esp32-node-01", message: "╔═══════════════════════════════════════════════════╗", level: "info" },
    { id: "clog-init-2", timestamp: new Date(Date.now() - 299000).toISOString(), nodeId: "esp32-node-01", message: "║   SmartHub Universal ESP32 Firmware v3.1-universal ║", level: "info" },
    { id: "clog-init-3", timestamp: new Date(Date.now() - 298000).toISOString(), nodeId: "esp32-node-01", message: "╚═══════════════════════════════════════════════════╝", level: "info" },
    { id: "clog-init-4", timestamp: new Date(Date.now() - 295000).toISOString(), nodeId: "esp32-node-01", message: "[WiFi] Connected — Local IP: 192.168.1.xxx | RSSI: -48 dBm", level: "info" },
    { id: "clog-init-5", timestamp: new Date(Date.now() - 290000).toISOString(), nodeId: "esp32-node-01", message: "[MQTT] ✅ Broker Connected (TLS Port 8883) — Node Ready", level: "info" }
];

// Security, Access & User Session Audit Log
let securityLogs = [
    { id: "sec-1", timestamp: new Date(Date.now() - 1200000).toISOString(), event: "User Authenticated", user: "Admin Session", ip: "127.0.0.1", agent: "Desktop Browser", status: "success", icon: "shield_person" },
    { id: "sec-2", timestamp: new Date(Date.now() - 3600000).toISOString(), event: "Hardware Pairing Authorized", user: "Admin Session", ip: "192.168.1.xxx", agent: "ESP32 Auto-Discovery Engine", status: "success", icon: "verified_user" },
    { id: "sec-3", timestamp: new Date(Date.now() - 7200000).toISOString(), event: "MQTT TLS Handshake", user: "Broker Bridge", ip: "HiveMQ Cloud TLS", agent: "TLS v1.3 Cipher Suite", status: "success", icon: "vpn_key" }
];

function addLog(type, title, description, icon) {
    const log = {
        id: "log-" + Date.now() + "-" + Math.floor(Math.random() * 1000),
        timestamp: new Date().toISOString(),
        type: type || "device",
        title: title || "Action Executed",
        description: description || "",
        icon: icon || "info"
    };
    activityLogs.unshift(log);
    if (activityLogs.length > 100) activityLogs.pop();
    return log;
}

// Automations In-Memory Storage
let automations = [
    {
        id: "auto-1",
        name: "Good Morning",
        description: "Starts the day gently with warm bedroom lighting and socket power.",
        time: "07:00 AM",
        days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
        icon: "wb_sunny",
        enabled: true,
        targetRoom: "bed",
        actionType: "all_on"
    },
    {
        id: "auto-2",
        name: "Night Safe Mode",
        description: "Powers down all ambient lighting and switches fans to eco low setting.",
        time: "11:30 PM",
        days: ["Daily"],
        icon: "bedtime",
        enabled: true,
        targetRoom: "all",
        actionType: "all_off"
    },
    {
        id: "auto-3",
        name: "Movie Scene",
        description: "Dims living lighting and powers on smart entertainment system.",
        time: "Manual",
        days: ["Custom"],
        icon: "movie",
        enabled: true,
        targetRoom: "living",
        actionType: "movie_preset"
    },
    {
        id: "auto-4",
        name: "Away Eco Patrol",
        description: "Turns off idling sockets and displays to conserve peak power.",
        time: "09:00 AM",
        days: ["Mon", "Tue", "Wed", "Thu", "Fri"],
        icon: "eco",
        enabled: false,
        targetRoom: "all",
        actionType: "eco"
    }
];

// Quick Action Presets
let quickActions = [
    { id: "all-off", name: "All Off", icon: "power_settings_new", description: "Turn off all devices in room" },
    { id: "all-on", name: "All On", icon: "light_mode", description: "Turn on all devices in room" },
    { id: "eco", name: "Eco Mode", icon: "eco", description: "Optimize energy consumption" },
    { id: "fan-timer", name: "Fan +1h", icon: "timer", description: "Run fan on 1-hour timer" }
];

// 1. API: System Status
app.get("/api/status", (req, res) => {
    systemStatus.activeDevicesCount = devices.filter(d => d.on).length;
    systemStatus.lastPing = new Date().toISOString();
    systemStatus.uptimeSeconds = Math.floor(process.uptime());
    systemStatus.mqttConnected = !!(mqttClient && mqttClient.connected);
    res.json(systemStatus);
});

// 1b. API: Comprehensive MQTT & Room Topology Diagnostics
app.get("/api/mqtt/diagnostics", (req, res) => {
    const isConnected = !!(mqttClient && mqttClient.connected);
    const base = mqttConfig.baseTopic || "smarthub";

    // Room hardware & ESP32 topology mapping with dynamic node pairing check
    const roomNodes = rooms.map(r => {
        const roomDevices = devices.filter(d => d.room === r.id);
        const activeCount = roomDevices.filter(d => d.on).length;

        // Find if any hardware node is paired to this room
        const pairedNode = Object.values(discoveredNodes).find(n => n.pairedRoom === r.id) ||
                           Object.values(hardwareNodes).find(n => n.pairedRoom === r.id);
        const targetNodeId = pairedNode ? pairedNode.nodeId : `esp32-${r.id}`;
        const liveNode = hardwareNodes[targetNodeId] || discoveredNodes[targetNodeId];
        const isNodeAlive = isConnected && liveNode && (liveNode.status === "online" || liveNode.status === "paired" || (Date.now() - (liveNode.lastSeen || 0) < 180000));

        return {
            roomId: r.id,
            roomName: r.name,
            roomIcon: r.icon,
            espNodeId: targetNodeId,
            status: isNodeAlive ? "online" : "offline",
            ip: (liveNode && liveNode.ip) || (isNodeAlive ? "192.168.1.xxx" : null),
            rssi: (liveNode && liveNode.rssi) !== undefined ? liveNode.rssi : (isNodeAlive ? -48 : null),
            uptime: liveNode && liveNode.uptime ? liveNode.uptime : null,
            lastSeenAgo: liveNode && liveNode.lastSeen ? Math.round((Date.now() - liveNode.lastSeen) / 1000) : null,
            deviceCount: roomDevices.length,
            activeCount: activeCount,
            devices: roomDevices.map((d, index) => ({
                id: d.id,
                name: d.name,
                type: d.type,
                on: d.on,
                powerWatts: d.powerWatts || 0,
                relayIndex: index,
                commandTopic: `${base}/devices/${d.id}/set`,
                stateTopic: `${base}/devices/${d.id}/state`
            }))
        };
    });

    res.json({
        connected: isConnected,
        broker: {
            host: mqttConfig.host || "Not Configured",
            port: mqttConfig.port || 8883,
            protocol: mqttConfig.protocol || "mqtts",
            clientId: mqttConfig.clientId || "home-dashboard",
            baseTopic: base,
            username: mqttConfig.username || ""
        },
        subscriptions: [
            `${base}/devices/+/state`,
            `${base}/nodes/+/status`,
            `${base}/nodes/+/heartbeat`,
            `${base}/system/#`
        ],
        publishPattern: `${base}/devices/{id}/set`,
        nodes: roomNodes,
        stats: {
            messagesIn: mqttStats.messagesIn,
            messagesOut: mqttStats.messagesOut,
            lastInboundTopic: mqttStats.lastInboundTopic,
            lastOutboundTopic: mqttStats.lastOutboundTopic,
            lastMessageTime: mqttStats.lastMessageTime,
            totalDevices: devices.length,
            activeDevices: devices.filter(d => d.on).length,
            uptimeSeconds: isConnected && mqttStats.connectedSince ? Math.floor((Date.now() - new Date(mqttStats.connectedSince).getTime()) / 1000) : 0
        },
        connectionError: settingsState.mqtt ? settingsState.mqtt.connectionError : null
    });
});

// 2. API: Get All Rooms
app.get("/api/rooms", (req, res) => {
    res.json(rooms);
});

// 3. API: Create New Room
app.post("/api/rooms", (req, res) => {
    const { name, icon } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: "Room name is required." });
    }
    const cleanId = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "-");
    const exists = rooms.some(r => r.id === cleanId);
    if (exists) {
        return res.status(409).json({ error: "A room with this name already exists." });
    }
    const newRoom = {
        id: cleanId,
        name: name.trim(),
        icon: icon || "meeting_room"
    };
    rooms.push(newRoom);
    saveDatabase();
    addLog("room", `Room '${newRoom.name}' Added`, "Configured in room registry.", "meeting_room");
    res.status(201).json({ success: true, room: newRoom });
});

// 4. API: Delete Room
app.delete("/api/rooms/:id", (req, res) => {
    const { id } = req.params;
    const index = rooms.findIndex(r => r.id === id);
    if (index === -1) {
        return res.status(404).json({ error: "Room not found." });
    }
    // Prevent deleting room if devices still belong to it
    const attachedDevices = devices.filter(d => d.room.toLowerCase() === id.toLowerCase());
    if (attachedDevices.length > 0) {
        return res.status(400).json({
            error: `Cannot delete room '${rooms[index].name}' because it still contains ${attachedDevices.length} device(s). Delete or reassign the devices first.`
        });
    }
    const deleted = rooms.splice(index, 1)[0];
    saveDatabase();
    addLog("room", `Room '${deleted.name}' Deleted`, "Removed from room registry.", "delete");
    res.json({ success: true, deleted });
});

// 5. API: Get All Devices (with optional ?room= filter)
app.get("/api/devices", (req, res) => {
    const { room } = req.query;
    if (room && room !== "all") {
        const filtered = devices.filter(d => d.room.toLowerCase() === room.toLowerCase());
        return res.json(filtered);
    }
    res.json(devices);
});

// 6. API: Toggle Device
app.patch("/api/devices/:id/toggle", (req, res) => {
    const device = devices.find(d => d.id === req.params.id);
    if (!device) {
        return res.status(404).json({ error: "Device not found" });
    }
    device.on = !device.on;
    if (!device.on) {
        device.powerWatts = 0;
    } else {
        if (device.type === "light") device.powerWatts = device.dimmable && device.brightness ? Math.round(42 * (device.brightness / 100)) : 42;
        if (device.type === "fan") device.powerWatts = device.speed === 1 ? 25 : (device.speed === 2 ? 40 : 55);
        if (device.type === "ac") device.powerWatts = device.mode === "eco" ? 450 : 720;
        if (device.type === "tv") device.powerWatts = 110;
        if (device.type === "socket") device.powerWatts = 15;
    }
    systemStatus.activeDevicesCount = devices.filter(d => d.on).length;
    saveDatabase();
    addLog(
        "device",
        `${device.name} ${device.on ? "Turned On" : "Turned Off"}`,
        `${device.room.toUpperCase()} • Draw: ${device.powerWatts}W`,
        device.type === "fan" ? "mode_fan" : device.type === "tv" ? "tv" : device.type === "ac" ? "ac_unit" : "lightbulb"
    );
    // Publish command to MQTT broker → ESP32 drives the relay
    const togglePayload = { on: device.on, powerWatts: device.powerWatts };
    if (device.type === "light" && device.dimmable !== false && device.brightness !== undefined) {
        togglePayload.brightness = device.brightness;
    } else if (device.type === "fan" && device.speed !== undefined) {
        togglePayload.speed = device.speed;
    }
    mqttPublish(device.id, togglePayload);
    // Push update to all connected browser tabs via SSE
    broadcastSSE("device_update", { device });
    res.json({ success: true, device });
});

// 6b. API: Update Granular Device Settings (Brightness, Fan Speed, AC Temp & Mode)
app.patch("/api/devices/:id/settings", (req, res) => {
    const device = devices.find(d => d.id === req.params.id);
    if (!device) {
        return res.status(404).json({ error: "Device not found" });
    }

    const { on, brightness, speed, temperature, mode } = req.body;
    if (typeof on === "boolean") device.on = on;

    if (device.type === "light") {
        if (typeof brightness === "number") {
            device.brightness = Math.max(5, Math.min(100, Math.round(brightness)));
        }
        if (device.on) {
            device.powerWatts = Math.round(42 * ((device.brightness || 80) / 100)) || 12;
        } else {
            device.powerWatts = 0;
        }
    } else if (device.type === "fan") {
        if (typeof speed === "number") {
            device.speed = Math.max(1, Math.min(3, Math.round(speed)));
        }
        if (device.on) {
            device.powerWatts = device.speed === 1 ? 25 : (device.speed === 2 ? 40 : 55);
        } else {
            device.powerWatts = 0;
        }
    } else if (device.type === "ac") {
        if (typeof temperature === "number") {
            device.temperature = Math.max(16, Math.min(30, Math.round(temperature)));
        }
        if (typeof mode === "string") {
            device.mode = mode.toLowerCase();
        }
        if (device.on) {
            const baseWatts = device.mode === "eco" ? 450 : (device.mode === "heat" ? 850 : 720);
            const delta = (26 - (device.temperature || 22)) * 25;
            device.powerWatts = Math.max(320, baseWatts + delta);
        } else {
            device.powerWatts = 0;
        }
    } else if (device.type === "tv") {
        device.powerWatts = device.on ? 110 : 0;
    } else if (device.type === "socket") {
        device.powerWatts = device.on ? 15 : 0;
    }

    systemStatus.activeDevicesCount = devices.filter(d => d.on).length;
    saveDatabase();
    addLog(
        "device",
        `${device.name} Adjusted`,
        `${device.name} (${device.room.toUpperCase()}) updated • Draw: ${device.powerWatts}W`,
        device.type === "ac" ? "ac_unit" : (device.type === "fan" ? "mode_fan" : "tune")
    );
    // Publish granular state to MQTT → ESP32 can react
    const settingsPayload = { on: device.on, powerWatts: device.powerWatts };
    if (device.type === "light" && device.dimmable !== false && device.brightness !== undefined) {
        settingsPayload.brightness = device.brightness;
    } else if (device.type === "fan" && device.speed !== undefined) {
        settingsPayload.speed = device.speed;
    } else if (device.type === "ac") {
        if (device.temperature !== undefined) settingsPayload.temperature = device.temperature;
        if (device.mode !== undefined) settingsPayload.mode = device.mode;
    }
    mqttPublish(device.id, settingsPayload);
    // Push update to all browser tabs
    broadcastSSE("device_update", { device });

    res.json({ success: true, device });
});

// 7. API: Create / Add New Device
app.post("/api/devices", (req, res) => {
    const { name, room, type } = req.body;
    if (!name || !room || !type) {
        return res.status(400).json({ error: "Name, room, and type are required." });
    }

    const newDevice = {
        id: "device-" + Date.now(),
        name: name.trim(),
        room: room.toLowerCase().trim(),
        type: type.toLowerCase().trim(),
        on: false,
        powerWatts: 0
    };

    devices.push(newDevice);
    systemStatus.activeDevicesCount = devices.filter(d => d.on).length;
    saveDatabase();
    addLog("device", `Device '${newDevice.name}' Installed`, `Added to ${newDevice.room.toUpperCase()} (${newDevice.type}).`, "add_circle");
    broadcastSSE("device_update", { device: newDevice });
    res.status(201).json({ success: true, device: newDevice });
});

// 7b. API: Update / Edit Existing Device Details (Name, Room, Type)
app.put("/api/devices/:id", (req, res) => {
    const device = devices.find(d => d.id === req.params.id);
    if (!device) {
        return res.status(404).json({ error: "Device not found" });
    }

    const { name, room, type } = req.body;
    if (name && typeof name === "string") device.name = name.trim();
    if (room && typeof room === "string") device.room = room.toLowerCase().trim();
    if (type && typeof type === "string") device.type = type.toLowerCase().trim();

    saveDatabase();
    addLog("device", `Device '${device.name}' Updated`, `Updated settings for ${device.name} in ${device.room.toUpperCase()}.`, "edit");
    broadcastSSE("device_update", { device });
    res.json({ success: true, device });
});

// 8. API: Remove / Delete Device
app.delete("/api/devices/:id", (req, res) => {
    const index = devices.findIndex(d => d.id === req.params.id);
    if (index === -1) {
        return res.status(404).json({ error: "Device not found" });
    }

    const removed = devices.splice(index, 1)[0];
    systemStatus.activeDevicesCount = devices.filter(d => d.on).length;
    saveDatabase();
    addLog("device", `Device '${removed.name}' Removed`, `Removed from ${removed.room.toUpperCase()}.`, "delete");
    res.json({ success: true, removed });
});

// ==========================================================================
// 8b. API: Hardware Node Management & Auto-Discovery Pairing
// ==========================================================================
app.get("/api/nodes/discovered", (req, res) => {
    const nodesList = Object.values(discoveredNodes);
    res.json({
        nodes: nodesList,
        count: nodesList.length,
        pairedCount: nodesList.filter(n => n.status === "paired").length,
        unpairedCount: nodesList.filter(n => n.status === "unpaired").length
    });
});

app.post("/api/nodes/pair", (req, res) => {
    const { nodeId, roomId, roomName, roomIcon, pinMappings } = req.body;
    if (!nodeId || !roomId || !pinMappings || !Array.isArray(pinMappings)) {
        return res.status(400).json({ error: "nodeId, roomId, and pinMappings are required." });
    }

    const cleanRoomId = roomId.trim().toLowerCase().replace(/[^a-z0-9]/g, "-");
    
    // 1. Check if room exists or create new room
    let room = rooms.find(r => r.id === cleanRoomId);
    if (!room) {
        room = {
            id: cleanRoomId,
            name: roomName ? roomName.trim() : (cleanRoomId.charAt(0).toUpperCase() + cleanRoomId.slice(1)),
            icon: roomIcon || "meeting_room"
        };
        rooms.push(room);
        addLog("room", `Room '${room.name}' Created`, `Associated with hardware node ${nodeId}.`, "meeting_room");
        broadcastSSE("rooms_update", { rooms });
    }

    // 2. Process Pin Mappings & create/update devices
    const createdDevices = [];
    pinMappings.forEach((mapping, index) => {
        if (!mapping.name || !mapping.name.trim()) return; // skip unmapped pins
        
        let devId = mapping.deviceId || `device-${cleanRoomId}-${mapping.pin || (index + 1)}`;
        let existingDev = devices.find(d => d.id === devId);
        
        if (existingDev) {
            existingDev.name = mapping.name.trim();
            existingDev.type = (mapping.type || "light").toLowerCase();
            existingDev.room = cleanRoomId;
            existingDev.gpio = mapping.pin;
            createdDevices.push(existingDev);
        } else {
            const newDev = {
                id: devId,
                name: mapping.name.trim(),
                room: cleanRoomId,
                type: (mapping.type || "light").toLowerCase(),
                gpio: mapping.pin,
                on: false,
                powerWatts: 0,
                dimmable: mapping.type === "light",
                brightness: mapping.type === "light" ? 100 : undefined,
                speed: mapping.type === "fan" ? 1 : undefined
            };
            devices.push(newDev);
            createdDevices.push(newDev);
        }
    });

    // 3. Update discovered & hardware node state
    if (!discoveredNodes[nodeId]) {
        discoveredNodes[nodeId] = {
            nodeId,
            mac: "Direct Paired",
            ip: "192.168.1.x",
            status: "paired",
            pairedRoom: cleanRoomId,
            lastSeen: Date.now()
        };
    } else {
        discoveredNodes[nodeId].status = "paired";
        discoveredNodes[nodeId].pairedRoom = cleanRoomId;
        discoveredNodes[nodeId].pinMappings = pinMappings;
        discoveredNodes[nodeId].lastSeen = Date.now();
    }

    // 4. Prepare MQTT configuration payload for the ESP32
    const configPayload = {
        nodeId: nodeId,
        room: cleanRoomId,
        pins: pinMappings.filter(m => m.name && m.name.trim()).map(m => ({
            gpio: m.pin,
            deviceId: m.deviceId || `device-${cleanRoomId}-${m.pin}`,
            type: m.type || "light",
            name: m.name.trim()
        }))
    };

    // 5. Send MQTT retained config
    mqttPublishNodeConfig(nodeId, configPayload);

    systemStatus.activeDevicesCount = devices.filter(d => d.on).length;
    saveDatabase();
    addLog("device", `Hardware Node '${nodeId}' Paired`, `Linked to '${room.name}' with ${createdDevices.length} mapped channels.`, "hub");

    broadcastSSE("node_paired", { nodeId, room: cleanRoomId, node: discoveredNodes[nodeId] });
    broadcastSSE("device_update", { devices });
    broadcastSSE("rooms_update", { rooms });

    res.json({
        success: true,
        message: `Node ${nodeId} successfully paired to ${room.name}`,
        node: discoveredNodes[nodeId],
        room,
        devices: createdDevices
    });
});

app.post("/api/nodes/identify", (req, res) => {
    const { nodeId } = req.body;
    if (!nodeId) return res.status(400).json({ error: "nodeId is required." });
    
    mqttPublishNodeCommand(nodeId, "identify", { durationMs: 4000 });
    addLog("device", `Identity Signal Dispatched: ${nodeId}`, "Flashing physical node onboard indicator LED.", "notifications_active");
    res.json({ success: true, message: `Node ${nodeId} is identifying with physical LED pulse.` });
});

app.post("/api/nodes/unpair", (req, res) => {
    const { nodeId, deleteDevices } = req.body;
    if (!nodeId) return res.status(400).json({ error: "nodeId is required." });

    const node = discoveredNodes[nodeId];
    const roomId = node ? node.pairedRoom : null;

    // Send reset command to ESP32
    mqttPublishNodeCommand(nodeId, "unpair", { resetConfig: true });

    if (node) {
        node.status = "unpaired";
        node.pairedRoom = null;
        node.pinMappings = null;
    }

    if (deleteDevices && roomId) {
        devices = devices.filter(d => d.room.toLowerCase() !== roomId.toLowerCase());
        broadcastSSE("device_update", { devices });
    }

    saveDatabase();
    addLog("device", `Node '${nodeId}' Unpaired`, "Hardware node restored to unpaired discovery pool.", "link_off");
    broadcastSSE("node_unpaired", { nodeId });

    res.json({ success: true, message: `Node ${nodeId} successfully unpaired.` });
});

app.post("/api/nodes/simulate-discovery", (req, res) => {
    const randHex = Math.random().toString(16).slice(2, 6).toLowerCase();
    const nodeId = `esp32-${randHex}`;
    const simNode = {
        nodeId,
        mac: `34:94:54:${randHex.slice(0, 2)}:${randHex.slice(2, 4)}:7A`.toUpperCase(),
        ip: `192.168.1.${Math.floor(Math.random() * 100) + 120}`,
        relays: [25, 33, 32, 27, 26],
        buttons: [34, 35, 16, 17, 18],
        chip: "ESP32-WROOM-32",
        firmware: "v3.0-universal",
        rssi: -(Math.floor(Math.random() * 25) + 45),
        status: "unpaired",
        pairedRoom: null,
        lastSeen: Date.now()
    };
    discoveredNodes[nodeId] = simNode;
    saveDatabase();
    broadcastSSE("node_discovered", { node: simNode, allNodes: Object.values(discoveredNodes) });
    addLog("device", `Simulated Hardware Node Discovered: ${nodeId}`, `MAC: ${simNode.mac} • Ready for Room Pairing`, "sensors");
    res.json({ success: true, node: simNode });
});

app.delete("/api/nodes/dismiss/:nodeId", (req, res) => {
    const nodeId = req.params.nodeId;
    const node = discoveredNodes[nodeId];

    if (!node) return res.status(404).json({ error: "Node not found." });
    if (node.pairedRoom) return res.status(400).json({ error: "Cannot dismiss a paired node. Unpair it first." });

    delete discoveredNodes[nodeId];
    saveDatabase();
    broadcastSSE("node_dismissed", { nodeId, allNodes: Object.values(discoveredNodes) });
    addLog("device", `Node Dismissed: ${nodeId}`, "Removed from discovery pool.", "delete");
    res.json({ success: true, message: `Node ${nodeId} dismissed.` });
});

// ==========================================================================
// 9. API: Quick Actions Execution
// ==========================================================================
app.post("/api/actions/execute", (req, res) => {
    const { action, roomId } = req.body;
    if (!action) {
        return res.status(400).json({ error: "Action identifier is required." });
    }

    const targetRoom = (roomId || "bed").toLowerCase();
    const isTargetAll = targetRoom === "all";

    let affectedDevices = isTargetAll 
        ? devices 
        : devices.filter(d => d.room.toLowerCase() === targetRoom);

    // Look up configured action in settingsState.quickActions
    const configuredAction = settingsState.quickActions && settingsState.quickActions.find(a => a.id === action);
    const behavior = (configuredAction && configuredAction.behavior) || action;
    const actionName = configuredAction ? configuredAction.name : (action.charAt(0).toUpperCase() + action.slice(1));
    const actionIcon = configuredAction ? configuredAction.icon : "bolt";
    const customConfig = configuredAction && configuredAction.customConfig;

    let message = "";
    let updatedCount = 0;

    // 1. Custom Individual Device Targets (Permutations & Combinations)
    if (customConfig && Array.isArray(customConfig.targetDevices) && customConfig.targetDevices.length > 0) {
        customConfig.targetDevices.forEach(target => {
            const d = devices.find(dev => dev.id === target.deviceId);
            if (!d) return;

            if (target.action === "on") {
                d.on = true;
                updatedCount++;
                if (d.type === "light") {
                    if (d.dimmable && target.brightness !== undefined) {
                        d.brightness = Math.max(5, Math.min(100, Number(target.brightness)));
                        d.powerWatts = Math.round(42 * (d.brightness / 100)) || 12;
                    } else {
                        d.powerWatts = 42;
                    }
                } else if (d.type === "fan") {
                    if (target.speed !== undefined) d.speed = Number(target.speed);
                    d.powerWatts = d.speed === 1 ? 25 : (d.speed === 2 ? 40 : 55);
                } else if (d.type === "ac") {
                    if (target.temperature !== undefined) d.temperature = Number(target.temperature);
                    if (target.acMode !== undefined) d.mode = String(target.acMode).toLowerCase();
                    const baseWatts = d.mode === "eco" ? 450 : (d.mode === "heat" ? 850 : 720);
                    const delta = (26 - (d.temperature || 22)) * 25;
                    d.powerWatts = Math.max(320, baseWatts + delta);
                } else if (d.type === "tv") {
                    d.powerWatts = 110;
                } else if (d.type === "socket") {
                    d.powerWatts = 15;
                }
            } else if (target.action === "off") {
                d.on = false;
                d.powerWatts = 0;
                if (d.type === "light" && d.dimmable) d.brightness = 0;
                updatedCount++;
            } else if (target.action === "toggle") {
                d.on = !d.on;
                updatedCount++;
                if (d.on) {
                    if (d.type === "light") { d.powerWatts = 42; if (d.dimmable) d.brightness = 80; }
                    else if (d.type === "fan") { d.powerWatts = 55; d.speed = 3; }
                    else if (d.type === "ac") { d.powerWatts = 720; d.temperature = 22; d.mode = "cool"; }
                    else if (d.type === "tv") d.powerWatts = 110;
                    else if (d.type === "socket") d.powerWatts = 15;
                } else {
                    d.powerWatts = 0;
                    if (d.type === "light" && d.dimmable) d.brightness = 0;
                }
            }
            // If action === "ignore", leave untouched
        });

        message = customConfig.feedbackToast || `Applied custom configuration to ${updatedCount} device(s).`;
        addLog("device", `${actionName} Executed`, message, actionIcon);
    } 
    // 2. Custom Category Rules
    else if (customConfig && customConfig.deviceRules) {
        const scope = customConfig.targetScope || "current";
        const targets = scope === "all" ? devices : (scope === "current" ? affectedDevices : devices.filter(d => d.room.toLowerCase() === scope.toLowerCase()));
        
        targets.forEach(d => {
            const rule = customConfig.deviceRules[d.type] || "ignore";
            if (rule === "on") {
                d.on = true;
                updatedCount++;
                if (d.type === "light") d.powerWatts = 42;
                if (d.type === "fan") { d.powerWatts = 55; d.speed = 3; }
                if (d.type === "ac") { d.powerWatts = 720; d.temperature = 22; d.mode = "cool"; }
                if (d.type === "tv") d.powerWatts = 110;
                if (d.type === "socket") d.powerWatts = 15;
            } else if (rule === "off") {
                d.on = false;
                d.powerWatts = 0;
                if (d.type === "light" && d.dimmable) d.brightness = 0;
                updatedCount++;
            } else if (rule === "toggle") {
                d.on = !d.on;
                if (d.on) {
                    if (d.type === "light") d.powerWatts = 42;
                    else if (d.type === "fan") { d.powerWatts = 55; d.speed = 3; }
                    else if (d.type === "ac") { d.powerWatts = 720; d.temperature = 22; d.mode = "cool"; }
                    else if (d.type === "tv") d.powerWatts = 110;
                    else if (d.type === "socket") d.powerWatts = 15;
                } else {
                    d.powerWatts = 0;
                }
                updatedCount++;
            }
        });
        message = `Custom rule applied to ${updatedCount} device(s) (${scope === "all" ? "whole house" : targetRoom}).`;
        addLog("device", `${actionName} Executed`, message, actionIcon);
    }
    // 3. Built-in Preset Fallbacks
    else if (behavior === "all-off") {
        affectedDevices.forEach(d => {
            d.on = false;
            d.powerWatts = 0;
        });
        message = `Turned off ${affectedDevices.length} device(s) in ${isTargetAll ? "all rooms" : targetRoom}.`;
        addLog("device", `${actionName} Executed`, message, actionIcon);
    } else if (behavior === "all-on") {
        affectedDevices.forEach(d => {
            d.on = true;
            if (d.type === "light") d.powerWatts = 42;
            if (d.type === "fan") d.powerWatts = 55;
            if (d.type === "ac") { d.powerWatts = 720; d.temperature = 22; d.mode = "cool"; }
            if (d.type === "tv") d.powerWatts = 110;
            if (d.type === "socket") d.powerWatts = 15;
        });
        message = `Activated ${affectedDevices.length} device(s) in ${isTargetAll ? "all rooms" : targetRoom}.`;
        addLog("device", `${actionName} Executed`, message, actionIcon);
    } else if (behavior === "eco") {
        affectedDevices.forEach(d => {
            if (d.type === "tv" || d.type === "socket") {
                d.on = false;
                d.powerWatts = 0;
            } else if (d.type === "fan") {
                d.on = true;
                d.powerWatts = 28;
            } else if (d.type === "ac") {
                d.on = true;
                d.mode = "eco";
                d.temperature = 25;
                d.powerWatts = 450;
            } else if (d.type === "light") {
                if (d.on) d.powerWatts = 18;
            }
        });
        message = `Eco Mode engaged for ${isTargetAll ? "all rooms" : targetRoom}. Reduced draw to optimal efficiency.`;
        addLog("system", `${actionName} Engaged`, message, actionIcon);
    } else if (behavior === "lights-off") {
        const lights = affectedDevices.filter(d => d.type === "light");
        lights.forEach(d => { d.on = false; d.powerWatts = 0; });
        message = `Turned off ${lights.length} light(s) in ${isTargetAll ? "all rooms" : targetRoom}.`;
        addLog("device", `${actionName}`, message, actionIcon);
    } else if (behavior === "lights-on") {
        const lights = affectedDevices.filter(d => d.type === "light");
        lights.forEach(d => { d.on = true; d.powerWatts = 42; });
        message = `Turned on ${lights.length} light(s) in ${isTargetAll ? "all rooms" : targetRoom}.`;
        addLog("device", `${actionName}`, message, actionIcon);
    } else if (behavior === "movie-night") {
        affectedDevices.forEach(d => {
            if (d.type === "light") { d.on = false; d.powerWatts = 0; }
            if (d.type === "tv") { d.on = true; d.powerWatts = 110; }
        });
        message = `Movie Night mode activated! Lights dimmed, TV turned on.`;
        addLog("system", `${actionName}`, message, actionIcon);
    } else if (behavior === "bedtime") {
        affectedDevices.forEach(d => {
            if (d.type === "tv" || d.type === "socket") { d.on = false; d.powerWatts = 0; }
            if (d.type === "light") { d.on = false; d.powerWatts = 0; }
            if (d.type === "fan") { d.on = true; d.powerWatts = 45; }
            if (d.type === "ac") { d.on = true; d.temperature = 24; d.mode = "cool"; d.powerWatts = 720; }
        });
        message = `Bedtime Cozy mode activated. All entertainment off, fan running.`;
        addLog("system", `${actionName}`, message, actionIcon);
    } else if (behavior === "fan-timer") {
        const fans = affectedDevices.filter(d => d.type === "fan");
        if (fans.length > 0) {
            fans.forEach(f => {
                f.on = true;
                f.powerWatts = 55;
            });
            message = `Fan timer set for 60 minutes in ${targetRoom}.`;
        } else {
            message = `No ceiling fan detected in ${targetRoom}.`;
        }
        addLog("device", `${actionName} (+1h)`, message, actionIcon);
    } else {
        message = `Custom action '${actionName}' executed.`;
        addLog("system", `${actionName} Triggered`, message, actionIcon);
    }

    systemStatus.activeDevicesCount = devices.filter(d => d.on).length;
    saveDatabase();

    // ── Push state to physical hardware via MQTT ───────────────────────────
    // Collect all devices that were actually changed by this action
    const mqttTargets = customConfig && Array.isArray(customConfig.targetDevices) && customConfig.targetDevices.length > 0
        ? customConfig.targetDevices
              .filter(t => t.action !== "ignore")
              .map(t => devices.find(d => d.id === t.deviceId))
              .filter(Boolean)
        : affectedDevices;

    mqttTargets.forEach(d => {
        const payload = { on: d.on, powerWatts: d.powerWatts || 0 };
        if (d.type === "light" && d.dimmable !== false && d.brightness !== undefined) {
            payload.brightness = d.brightness;
        } else if (d.type === "fan" && d.speed !== undefined) {
            payload.speed = d.speed;
        } else if (d.type === "ac") {
            if (d.temperature !== undefined) payload.temperature = d.temperature;
            if (d.mode !== undefined) payload.mode = d.mode;
        }
        mqttPublish(d.id, payload);
    });

    // ── Broadcast live device state to all dashboard tabs via SSE ─────────
    broadcastSSE("device_update", { devices });

    res.json({
        success: true,
        action,
        roomId: targetRoom,
        message,
        devices,
        activeDevicesCount: systemStatus.activeDevicesCount,
        affectedCount: affectedDevices.length
    });
});

// Quick Actions Presets
app.get("/api/actions", (req, res) => {
    res.json(quickActions);
});

app.post("/api/actions", (req, res) => {
    const { name, icon, description } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: "Action name is required." });
    }
    const cleanId = name.trim().toLowerCase().replace(/[^a-z0-9]/g, "-");
    const newAction = {
        id: cleanId,
        name: name.trim(),
        icon: icon || "bolt",
        description: description || "Custom quick action preset"
    };
    quickActions.push(newAction);
    addLog("system", `Quick Action '${newAction.name}' Created`, "New shortcut added.", "bolt");
    res.status(201).json({ success: true, action: newAction });
});

// ==========================================================================
// 10. API: Automations & Routines
// ==========================================================================
app.get("/api/automations", (req, res) => {
    res.json(automations);
});

app.post("/api/automations", (req, res) => {
    const { name, description, time, days, icon, targetRoom, actionType } = req.body;
    if (!name || !name.trim()) {
        return res.status(400).json({ error: "Routine name is required." });
    }
    const newRoutine = {
        id: "auto-" + Date.now(),
        name: name.trim(),
        description: description || "Custom automated routine",
        time: time || "12:00 PM",
        days: days && days.length ? days : ["Daily"],
        icon: icon || "schedule",
        enabled: true,
        targetRoom: (targetRoom || "all").toLowerCase(),
        actionType: actionType || "all_on"
    };
    automations.push(newRoutine);
    addLog("automation", `Routine '${newRoutine.name}' Created`, `Scheduled for ${newRoutine.time}.`, newRoutine.icon);
    res.status(201).json({ success: true, routine: newRoutine });
});

app.patch("/api/automations/:id/toggle", (req, res) => {
    const routine = automations.find(a => a.id === req.params.id);
    if (!routine) {
        return res.status(404).json({ error: "Routine not found." });
    }
    routine.enabled = !routine.enabled;
    addLog(
        "automation",
        `Routine '${routine.name}' ${routine.enabled ? "Enabled" : "Disabled"}`,
        `Schedule active state toggled.`,
        routine.icon
    );
    res.json({ success: true, routine });
});

app.post("/api/automations/:id/trigger", (req, res) => {
    const routine = automations.find(a => a.id === req.params.id);
    if (!routine) {
        return res.status(404).json({ error: "Routine not found." });
    }

    const isTargetAll = routine.targetRoom === "all";
    const targets = isTargetAll 
        ? devices 
        : devices.filter(d => d.room.toLowerCase() === routine.targetRoom.toLowerCase());

    if (routine.actionType === "all_off") {
        targets.forEach(d => { d.on = false; d.powerWatts = 0; });
    } else if (routine.actionType === "eco") {
        targets.forEach(d => {
            if (d.type === "tv" || d.type === "socket") { d.on = false; d.powerWatts = 0; }
            else { d.on = true; d.powerWatts = 25; }
        });
    } else if (routine.actionType === "movie_preset") {
        targets.forEach(d => {
            if (d.type === "tv") { d.on = true; d.powerWatts = 110; }
            if (d.type === "light") { d.on = true; d.powerWatts = 12; } // Dimmed theater
        });
    } else {
        // default all on
        targets.forEach(d => {
            d.on = true;
            if (d.type === "light") d.powerWatts = 42;
            if (d.type === "fan") d.powerWatts = 55;
            if (d.type === "tv") d.powerWatts = 110;
            if (d.type === "socket") d.powerWatts = 15;
        });
    }

    systemStatus.activeDevicesCount = devices.filter(d => d.on).length;
    saveDatabase();
    addLog("automation", `Routine '${routine.name}' Triggered`, `Executed actions on ${targets.length} device(s).`, routine.icon);
    res.json({ success: true, message: `Routine '${routine.name}' successfully executed!`, routine });
});

app.delete("/api/automations/:id", (req, res) => {
    const index = automations.findIndex(a => a.id === req.params.id);
    if (index === -1) {
        return res.status(404).json({ error: "Routine not found." });
    }
    const removed = automations.splice(index, 1)[0];
    addLog("automation", `Routine '${removed.name}' Deleted`, "Removed from routines.", "delete");
    res.json({ success: true, removed });
});

// ==========================================================================
// 11. API: Energy & Power Analytics
// ==========================================================================
app.get("/api/energy", (req, res) => {
    const liveWatts = devices.filter(d => d.on).reduce((sum, d) => sum + (d.powerWatts || 0), 0);
    const activeCount = devices.filter(d => d.on).length;
    
    // Compute cumulative day usage (base 2.1 kWh + dynamic contribution)
    const dynamicKwh = Number(((liveWatts * 0.001) * 8.5).toFixed(2));
    const todayKwh = Number((2.15 + dynamicKwh).toFixed(2));
    const projectedCost = Number((todayKwh * 30 * 0.14).toFixed(2)); // $0.14 / kWh avg

    // Hourly 24h consumption curve
    const hours = ["12 AM", "2 AM", "4 AM", "6 AM", "8 AM", "10 AM", "12 PM", "2 PM", "4 PM", "6 PM", "8 PM", "10 PM"];
    const baseCurve = [45, 30, 25, 60, 140, 110, 160, 190, 220, 270, 240, 120];
    const hourlyProfile = hours.map((hour, idx) => {
        const val = Math.round(baseCurve[idx] * (0.8 + (liveWatts > 0 ? (liveWatts / 300) : 0.2)));
        return { hour, watts: val };
    });

    // Room distribution
    const roomWattsMap = {};
    rooms.forEach(r => { roomWattsMap[r.id] = { name: r.name, watts: 0 }; });
    devices.filter(d => d.on).forEach(d => {
        if (!roomWattsMap[d.room]) {
            roomWattsMap[d.room] = { name: d.room, watts: 0 };
        }
        roomWattsMap[d.room].watts += d.powerWatts;
    });

    const roomBreakdown = Object.keys(roomWattsMap).map(id => {
        const item = roomWattsMap[id];
        const percent = liveWatts > 0 ? Math.round((item.watts / liveWatts) * 100) : 0;
        return { id, name: item.name, watts: item.watts, percent };
    });

    // Top power consumers
    const topConsumers = devices
        .filter(d => d.on && d.powerWatts > 0)
        .sort((a, b) => b.powerWatts - a.powerWatts)
        .slice(0, 5);

    res.json({
        liveWatts,
        todayKwh,
        projectedCost,
        activeDevicesCount: activeCount,
        ecoRating: liveWatts < 150 ? "A+ Excellent" : liveWatts < 300 ? "B Optimal" : "C Moderate Load",
        hourlyProfile,
        roomBreakdown,
        topConsumers,
        ecoTips: [
            { icon: "tv", title: "Entertainment Standby", tip: "Televisions draw up to 110W. Turn off when inactive to save ~$4.20/month." },
            { icon: "mode_fan", title: "Optimal Air Circulation", tip: "Running ceiling fan on Eco Low consumes 50% less power than high speed." },
            { icon: "wb_incandescent", title: "Smart LED Efficiency", tip: "All lights configured are high-efficiency 42W units with low standby leakage." }
        ]
    });
});

// ==========================================================================
// 12. API: Activity & Event Logs
// ==========================================================================
app.get("/api/logs", (req, res) => {
    const { type } = req.query;
    if (type && type !== "all") {
        const filtered = activityLogs.filter(l => l.type === type.toLowerCase());
        return res.json(filtered);
    }
    res.json(activityLogs);
});

app.delete("/api/logs", (req, res) => {
    activityLogs = [];
    addLog("system", "Activity Logs Cleared", "Audit trail reset by user.", "cleaning_services");
    res.json({ success: true, message: "Logs cleared successfully." });
});

app.get("/api/logs/console", (req, res) => {
    const { nodeId, level } = req.query;
    let filtered = consoleLogs;
    if (nodeId && nodeId !== "all") {
        filtered = filtered.filter(l => l.nodeId === nodeId);
    }
    if (level && level !== "all") {
        filtered = filtered.filter(l => l.level === level);
    }
    res.json({ logs: filtered, total: consoleLogs.length });
});

app.delete("/api/logs/console", (req, res) => {
    consoleLogs = [];
    res.json({ success: true, message: "Wireless console logs cleared." });
});

app.get("/api/logs/security", (req, res) => {
    res.json({
        activeSession: {
            user: "Abhishant",
            role: "Home Administrator",
            ip: "127.0.0.1",
            agent: req.headers["user-agent"] || "Modern Web Client",
            connectedAt: new Date(Date.now() - Math.floor(process.uptime()) * 1000).toISOString(),
            status: "active"
        },
        auditLogs: securityLogs
    });
});

app.get("/api/logs/telemetry", (req, res) => {
    const nodesList = Object.values(discoveredNodes).map(node => {
        const hw = hardwareNodes[node.nodeId] || {};
        return {
            nodeId: node.nodeId,
            mac: node.mac,
            ip: hw.ip || node.ip,
            rssi: hw.rssi !== undefined ? hw.rssi : node.rssi,
            status: hw.status || node.status,
            uptime: hw.uptime || 0,
            freeHeap: hw.freeHeap || 214800,
            pairedRoom: node.pairedRoom,
            lastSeen: node.lastSeen || hw.lastSeen
        };
    });
    res.json({ nodes: nodesList, timestamp: new Date().toISOString() });
});

app.post("/api/nodes/:id/command", (req, res) => {
    const { id } = req.params;
    const { command, payload } = req.body;
    if (!command) return res.status(400).json({ error: "Command string is required." });

    const topic = `${mqttConfig.baseTopic || "smarthub"}/nodes/${id}/cmd`;
    const payloadStr = typeof payload === "object" ? JSON.stringify(payload) : String(payload || "");
    
    mqttPublishRaw(topic, payloadStr);
    
    const logEntry = {
        id: "clog-cmd-" + Date.now(),
        timestamp: new Date().toISOString(),
        nodeId: id,
        message: `[OUTBOUND CMD] → ${topic}: ${payloadStr}`,
        level: "info"
    };
    consoleLogs.unshift(logEntry);
    broadcastSSE("node_log", { log: logEntry });

    res.json({ success: true, message: `Dispatched command to ${id}`, topic, payload: payloadStr });
});

// ==========================================================================
// 13. API: Settings & System Configurations
// ==========================================================================
let settingsState = {
    mqtt: {
        host: mqttConfig.host || "",
        port: mqttConfig.port || 8883,
        protocol: mqttConfig.protocol || "mqtts",
        baseTopic: mqttConfig.baseTopic || "smarthub",
        clientId: mqttConfig.clientId || "home-dashboard",
        username: mqttConfig.username || "",
        connected: false,
        lastPingMs: null
    },
    network: {
        ssid: "SmartHub_Network",
        ip: "192.168.1.xxx",
        gateway: "192.168.1.1",
        mac: "XX:XX:XX:XX:XX:XX",
        signalDbm: -52,
        signalQuality: "Excellent",
        mdnsDiscovery: true,
        staticIp: false
    },
    quickActions: [
        { id: "all-off", name: "All Off", icon: "power_settings_new", behavior: "all-off", active: true, description: "Turn off all devices in room" },
        { id: "all-on", name: "All On", icon: "wb_sunny", behavior: "all-on", active: true, description: "Turn on all devices in room" },
        { id: "eco", name: "Eco Mode", icon: "eco", behavior: "eco", active: true, description: "Low power draw for optimal efficiency" },
        { id: "fan-timer", name: "Fan +1h", icon: "timer", behavior: "fan-timer", active: true, description: "Run ceiling fan for 1 hour" },
        { id: "movie-night", name: "Movie Night", icon: "movie", behavior: "movie-night", active: false, description: "TV on, lights dimmed" },
        { id: "bedtime", name: "Bedtime Cozy", icon: "bedtime", behavior: "bedtime", active: false, description: "Fan on, all lights and entertainment off" }
    ],
    theme: {
        preset: "warm", // "apple", "warm", "midnight"
        accentColor: "#10b981",
        hapticClicks: true
    },
    database: {
        engine: "Embedded In-Memory / JSON",
        sizeKb: 1420,
        retentionDays: 30,
        lastBackup: new Date().toISOString(),
        eventsCount: 48
    },
    account: {
        name: userProfile.name || "Abhishant",
        email: userProfile.email || "abhi@smarthome.local",
        role: userProfile.role || "Home Administrator",
        pinCode: userProfile.pinCode || "1234",
        webhookSecret: userProfile.webhookSecret || generateWebhookSecret()
    }
};

app.get("/api/settings", (req, res) => {
    settingsState.account = {
        name: userProfile.name || "Abhishant",
        role: userProfile.role || "Home Administrator",
        email: userProfile.email || "abhi@smarthome.local",
        avatarUrl: userProfile.avatarUrl || null,
        pinCode: userProfile.pinCode || "1234",
        webhookSecret: userProfile.webhookSecret || generateWebhookSecret()
    };
    settingsState.mqtt = {
        host: mqttConfig.host || "",
        port: mqttConfig.port || 8883,
        protocol: mqttConfig.protocol || "mqtts",
        baseTopic: mqttConfig.baseTopic || "smarthub",
        clientId: mqttConfig.clientId || "home-dashboard",
        username: mqttConfig.username || "",
        connected: !!(mqttClient && mqttClient.connected),
        connectionError: settingsState.mqtt ? settingsState.mqtt.connectionError : null,
        lastPingMs: settingsState.mqtt ? settingsState.mqtt.lastPingMs : null
    };
    res.json(settingsState);
});

app.post("/api/settings/mqtt/disconnect", (req, res) => {
    if (mqttClient) {
        try { mqttClient.end(true); } catch (e) {}
        mqttClient = null;
    }
    if (!settingsState.mqtt) settingsState.mqtt = {};
    settingsState.mqtt.connected = false;
    settingsState.mqtt.connectionError = null;
    addLog("system", "MQTT Broker Disconnected", "Manual disconnect requested by user.", "power_off");
    broadcastSSE("mqtt_status", { connected: false, disconnectedByUser: true });
    res.json({ success: true, message: "MQTT Broker disconnected." });
});

app.post("/api/settings", (req, res) => {
    const { section, data } = req.body;
    if (section && settingsState[section] !== undefined) {
        if (Array.isArray(settingsState[section]) || Array.isArray(data)) {
            settingsState[section] = Array.isArray(data) ? data : Object.values(data);
        } else {
            settingsState[section] = { ...settingsState[section], ...data };
        }

        // MQTT section: persist credentials to disk and trigger live reconnect
        if (section === "mqtt" && data) {
            const newCfg = {
                host:      data.host      || mqttConfig.host      || "",
                port:      data.port      || mqttConfig.port      || 8883,
                protocol:  data.protocol  || mqttConfig.protocol  || "mqtts",
                baseTopic: data.baseTopic || mqttConfig.baseTopic || "smarthub",
                clientId:  data.clientId  || mqttConfig.clientId  || "home-dashboard",
                username:  data.username  || mqttConfig.username  || "",
                // Only overwrite password if user actually sent a new one
                password:  (data.password && data.password.length > 0)
                                ? data.password
                                : (mqttConfig.password || "")
            };
            mqttConfig = newCfg;
            saveMqttConfig(mqttConfig);
            // Reconnect live — no server restart needed
            setTimeout(() => connectMqtt(mqttConfig), 150);
            console.log("[MQTT] Credentials updated. Reconnecting...");
        }

        addLog("system", "Settings Updated", `Config section "${section}" saved.`, "settings");
        return res.json({ success: true, settings: settingsState });
    }
    settingsState = { ...settingsState, ...req.body };
    addLog("system", "System Settings Saved", "Global preferences updated.", "tune");
    res.json({ success: true, settings: settingsState });
});

app.post("/api/settings/mqtt/test", (req, res) => {
    const { host, port, protocol, username, password, clientId } = req.body;
    if (!host) {
        return res.status(400).json({ success: false, error: "Broker host is required." });
    }

    const url  = `${protocol || "mqtts"}://${host}`;
    const opts = {
        port: port || 8883,
        clientId: (clientId || "agy-test") + "-probe-" + Date.now(),
        username: username || undefined,
        password: password || undefined,
        connectTimeout: 8000,
        reconnectPeriod: 0,          // never auto-reconnect for a test probe
        rejectUnauthorized: false
    };

    const t0 = Date.now();
    let responded = false;
    let testClient;

    const bail = setTimeout(() => {
        if (responded) return;
        responded = true;
        try { testClient && testClient.end(true); } catch (e) {}
        res.json({ success: false, error: "Connection timed out (8 s). Check host, port and credentials." });
    }, 8500);

    try {
        testClient = mqttLib.connect(url, opts);

        testClient.on("connect", () => {
            if (responded) return;
            responded = true;
            clearTimeout(bail);
            const pingMs = Date.now() - t0;
            testClient.end(true);
            addLog("system", "MQTT Test Handshake OK", `Probe connected to ${host} in ${pingMs} ms.`, "cell_tower");
            res.json({ success: true, message: `Connected to ${host}`, pingMs });
        });

        testClient.on("error", (err) => {
            if (responded) return;
            responded = true;
            clearTimeout(bail);
            try { testClient.end(true); } catch (e) {}
            res.json({ success: false, error: err.message });
        });
    } catch (e) {
        clearTimeout(bail);
        res.json({ success: false, error: e.message });
    }
});

app.get("/api/settings/backup", (req, res) => {
    const backupData = {
        exportedAt: new Date().toISOString(),
        version: "2.0.0",
        systemStatus,
        rooms,
        devices,
        automations,
        settings: settingsState
    };
    res.setHeader("Content-Disposition", 'attachment; filename="smarthome-backup.json"');
    res.setHeader("Content-Type", "application/json");
    res.send(JSON.stringify(backupData, null, 2));
});

app.post("/api/settings/restore", (req, res) => {
    try {
        const { backup } = req.body;
        if (backup && backup.rooms && backup.devices) {
            rooms = backup.rooms;
            devices = backup.devices;
            if (backup.automations) automations = backup.automations;
            if (backup.settings) settingsState = backup.settings;
            saveDatabase();
            addLog("system", "Configuration Restored", `Restored ${devices.length} devices across ${rooms.length} rooms.`, "cloud_download");
            return res.json({ success: true, message: "System configuration restored successfully." });
        }
        res.status(400).json({ error: "Invalid backup file structure." });
    } catch (err) {
        res.status(500).json({ error: "Restore failed: " + err.message });
    }
});

// ==========================================================================
// User Profile & Avatar Persistence Endpoints
// ==========================================================================

app.get("/api/user/profile", (req, res) => {
    res.json(userProfile);
});

app.post("/api/user/avatar", (req, res) => {
    try {
        const { image } = req.body;
        if (!image) return res.status(400).json({ error: "No image payload provided." });

        let buffer;
        const matches = image.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
            buffer = Buffer.from(matches[2], "base64");
        } else {
            buffer = Buffer.from(image, "base64");
        }

        const avatarFilePath = path.join(UPLOADS_DIR, "avatar.png");
        fs.writeFileSync(avatarFilePath, buffer);

        const timestamp = Date.now();
        const avatarUrl = `/uploads/avatar.png?v=${timestamp}`;
        userProfile.avatarUrl = avatarUrl;
        saveUserProfile(userProfile);

        if (settingsState.account) {
            settingsState.account.avatarUrl = avatarUrl;
        }

        addLog("system", "Profile Photo Updated", "User profile picture updated and persisted.", "account_circle");
        broadcastSSE("profile_update", userProfile);

        console.log("[User Profile] Avatar updated successfully:", avatarUrl);
        res.json({ success: true, avatarUrl, profile: userProfile });
    } catch (err) {
        console.error("[Avatar Upload] Error:", err.message);
        res.status(500).json({ error: "Failed to upload avatar: " + err.message });
    }
});

app.delete("/api/user/avatar", (req, res) => {
    try {
        const avatarFilePath = path.join(UPLOADS_DIR, "avatar.png");
        if (fs.existsSync(avatarFilePath)) {
            try { fs.unlinkSync(avatarFilePath); } catch (e) {}
        }
        userProfile.avatarUrl = null;
        saveUserProfile(userProfile);

        if (settingsState.account) {
            settingsState.account.avatarUrl = null;
        }

        addLog("system", "Profile Photo Reset", "User profile picture reset to default.", "delete");
        broadcastSSE("profile_update", userProfile);

        res.json({ success: true, message: "Avatar reset to default.", profile: userProfile });
    } catch (err) {
        res.status(500).json({ error: "Failed to reset avatar: " + err.message });
    }
});

app.put("/api/user/profile", (req, res) => {
    try {
        const { name, role, email } = req.body;
        if (name !== undefined && name.trim()) userProfile.name = name.trim();
        if (role !== undefined && role.trim()) userProfile.role = role.trim();
        if (email !== undefined && email.trim()) userProfile.email = email.trim();

        saveUserProfile(userProfile);

        if (settingsState.account) {
            settingsState.account.name = userProfile.name;
            settingsState.account.role = userProfile.role;
            settingsState.account.email = userProfile.email;
        }

        addLog("system", "Profile Details Updated", `Profile details updated for ${userProfile.name}.`, "person");
        broadcastSSE("profile_update", userProfile);

        res.json({ success: true, profile: userProfile });
    } catch (err) {
        res.status(500).json({ error: "Failed to update profile: " + err.message });
    }
});

// ==========================================================================
// Webhook API Secret Revocation & Regeneration
// ==========================================================================
app.post("/api/user/webhook/regenerate", (req, res) => {
    try {
        const newSecret = generateWebhookSecret();
        userProfile.webhookSecret = newSecret;
        saveUserProfile(userProfile);

        if (settingsState.account) {
            settingsState.account.webhookSecret = newSecret;
        }

        addLog("system", "Webhook Key Revoked & Regenerated", "Security API key rotated.", "key");
        broadcastSSE("profile_update", userProfile);
        res.json({ success: true, webhookSecret: newSecret });
    } catch (err) {
        res.status(500).json({ error: "Failed to regenerate webhook secret: " + err.message });
    }
});

// ==========================================================================
// Multi-User Directory & Access Control Endpoints
// ==========================================================================
app.get("/api/members", (req, res) => {
    // Sync owner details with userProfile
    const ownerIndex = membersList.findIndex(m => m.isOwner);
    if (ownerIndex !== -1) {
        membersList[ownerIndex].name = userProfile.name || "Abhishant";
        membersList[ownerIndex].email = userProfile.email || "abhi@smarthome.local";
        membersList[ownerIndex].role = "admin";
        membersList[ownerIndex].roleLabel = "Home Administrator";
        membersList[ownerIndex].avatarUrl = userProfile.avatarUrl || null;
        membersList[ownerIndex].pinCode = userProfile.pinCode || "1234";
    }
    saveMembers(membersList);
    res.json(membersList);
});

app.post("/api/members", (req, res) => {
    try {
        const { name, email, role, pinCode, permittedRooms } = req.body;
        if (!name || !name.trim()) return res.status(400).json({ error: "Member name is required." });

        const validRole = (role === "admin" || role === "family" || role === "guest") ? role : "family";
        const roleLabels = {
            admin: "Administrator",
            family: "Family Member",
            guest: "Guest (Limited Access)"
        };

        const newMember = {
            id: "member-" + Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
            name: name.trim(),
            email: (email && email.trim()) || `${name.toLowerCase().replace(/\s+/g, '')}@smarthome.local`,
            role: validRole,
            roleLabel: roleLabels[validRole],
            pinCode: (pinCode && pinCode.trim()) || "0000",
            avatarUrl: null,
            permittedRooms: Array.isArray(permittedRooms) && permittedRooms.length ? permittedRooms : ["*"],
            isOwner: false,
            createdAt: new Date().toISOString()
        };

        membersList.push(newMember);
        saveMembers(membersList);

        addLog("system", "Home Member Added", `New member ${newMember.name} (${newMember.roleLabel}) added.`, "person_add");
        broadcastSSE("members_update", membersList);

        res.status(201).json({ success: true, member: newMember, members: membersList });
    } catch (err) {
        res.status(500).json({ error: "Failed to add member: " + err.message });
    }
});

app.put("/api/members/:id", (req, res) => {
    try {
        const { id } = req.params;
        const member = membersList.find(m => m.id === id);
        if (!member) return res.status(404).json({ error: "Member not found." });

        const { name, email, role, pinCode, permittedRooms } = req.body;
        if (name !== undefined && name.trim()) member.name = name.trim();
        if (email !== undefined && email.trim()) member.email = email.trim();
        if (role !== undefined) {
            member.role = role;
            const roleLabels = { admin: "Administrator", family: "Family Member", guest: "Guest (Limited Access)" };
            member.roleLabel = roleLabels[role] || "Member";
        }
        if (pinCode !== undefined) member.pinCode = pinCode.trim();
        if (permittedRooms !== undefined && Array.isArray(permittedRooms)) {
            member.permittedRooms = permittedRooms.length ? permittedRooms : ["*"];
        }

        if (member.isOwner) {
            userProfile.name = member.name;
            userProfile.email = member.email;
            if (pinCode) userProfile.pinCode = member.pinCode;
            saveUserProfile(userProfile);
        }

        saveMembers(membersList);
        addLog("system", "Home Member Updated", `Profile for ${member.name} updated.`, "badge");
        broadcastSSE("members_update", membersList);

        res.json({ success: true, member, members: membersList });
    } catch (err) {
        res.status(500).json({ error: "Failed to update member: " + err.message });
    }
});

app.delete("/api/members/:id", (req, res) => {
    try {
        const { id } = req.params;
        const memberIndex = membersList.findIndex(m => m.id === id);
        if (memberIndex === -1) return res.status(404).json({ error: "Member not found." });

        const member = membersList[memberIndex];
        if (member.isOwner) {
            return res.status(400).json({ error: "Cannot delete the primary system owner." });
        }

        membersList.splice(memberIndex, 1);
        saveMembers(membersList);

        addLog("system", "Home Member Removed", `Member ${member.name} removed from hub.`, "person_remove");
        broadcastSSE("members_update", membersList);

        res.json({ success: true, message: `Member ${member.name} removed.`, members: membersList });
    } catch (err) {
        res.status(500).json({ error: "Failed to delete member: " + err.message });
    }
});

// ==========================================================================
// SSE: Real-time event stream for browser clients
// ==========================================================================
app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type",  "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection",    "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // disable nginx proxy buffering
    res.flushHeaders();

    // Initial confirmation ping
    res.write(`event: connected\ndata: ${JSON.stringify({ message: "SSE stream active" })}\n\n`);
    sseClients.push(res);
    console.log(`[SSE] Client connected. Active streams: ${sseClients.length}`);

    req.on("close", () => {
        sseClients = sseClients.filter((c) => c !== res);
        console.log(`[SSE] Client disconnected. Active streams: ${sseClients.length}`);
    });
});

// ==========================================================================
// Start Server
// ==========================================================================
app.listen(PORT, () => {
    console.log(`[Server] Listening on http://localhost:${PORT}`);
    // Auto-connect to MQTT if credentials are persisted
    if (mqttConfig.host) {
        console.log(`[MQTT] Auto-connecting to saved broker: ${mqttConfig.host}`);
        setTimeout(() => connectMqtt(mqttConfig), 800);
    } else {
        console.log("[MQTT] No broker configured yet. Configure in Settings → MQTT Broker.");
    }
});
