import udp from "@SignalRGB/udp";

export function Name() { return "Skydimo LED Strip (Bridged)"; }
export function VendorId() { return 0x1A86; }
export function ProductId() { return [0x7523]; }
export function Publisher() { return "I'm Not MentaL (UDP-bridge fork)"; }
export function Documentation() { return "troubleshooting/skydimo"; }
// Type stays "serial" so SignalRGB instantiates the plugin when the CH340
// USB device is detected (it matches by VID/PID). We never actually call the
// serial module — all I/O goes through UDP to the companion bridge script,
// which is what fixes the CH340 serial-number-matching bug at the platform
// level.
export function Type() { return "serial"; }
export function DeviceType() { return "lightingcontroller"; }
// 68/69 bundled subdevice plugins declare these. Asrock_Monitor_Controller
// (the closest analog — 4-zone Left/Top/Right/Bottom monitor ambient strip)
// also declares LedNames/LedPositions as empty arrays alongside subdevices.
export function Size() { return [1, 1]; }
export function DefaultPosition() { return [0, 0]; }
export function DefaultScale() { return 1.0; }
export function LedNames() { return []; }
export function LedPositions() { return []; }
export function SubdeviceController() { return true; }

/* global
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
deviceModel:readonly
bridgeHost:readonly
bridgePort:readonly
*/
export function ControllableParameters() {
    return [
        { property: "shutdownColor", group: "lighting", label: "Shutdown Color", description: "Color shown when SignalRGB or the system is shutting down", min: "0", max: "360", type: "color", default: "#000000" },
        { property: "LightingMode", group: "lighting", label: "Lighting Mode", description: "Canvas pulls from the active SignalRGB effect; Forced overrides with a fixed color", type: "combobox", values: ["Canvas", "Forced"], default: "Canvas" },
        { property: "forcedColor", group: "lighting", label: "Forced Color", description: "Color used when 'Forced' lighting mode is active", min: "0", max: "360", type: "color", default: "#009bde" },
        { property: "deviceModel", group: "device", label: "Skydimo Model", description: "Pick the model that matches your strip. The default is SK0L27 (96 LEDs, 4 zones).", type: "combobox", values: [
            "SK0L27", "SK0L21", "SK0L24", "SK0L32", "SK0L34",
            "SK0201", "SK0202", "SK0204", "SK0F01", "SK0F02",
            "SK0121", "SK0124", "SK0127", "SK0132", "SK0134", "SK0149",
            "SKA124", "SKA127", "SKA132", "SKA134",
            "SK0402", "SK0403", "SK0404",
            "SK0901", "SK0801", "SK0803",
            "SK0E01", "SK0H01", "SK0H02",
            "SK0S01", "SK0J01", "SK0K01", "SK0K02",
            "SK0M01", "SK0N01", "SK0N02", "SK0N03"
        ], default: "SK0L27" },
        { property: "bridgeHost", group: "device", label: "Bridge Host", description: "IP of the bridge script. Almost always localhost.", type: "textfield", default: "127.0.0.1" },
        { property: "bridgePort", group: "device", label: "Bridge UDP Port", description: "Must match the -UdpPort the bridge script is listening on.", type: "number", min: "1024", max: "65535", default: "19624" },
    ];
}

let socket = null;
let currentModel = null;

// Diagnostic counters emitted in a single device.log line every ~10s
// (matching the bridge script's stats cadence so the two terminals line up).
let renderCount = 0;
let udpSendFailCount = 0;
let zoneChangeCount = [];
let zoneLastChecksum = [];
let zoneSampleColor = [];
let lastTickMs = 0;

const deviceConfig = {
    // 2-zone models
    "SK0201": { layout: 2, zones: [20, 20], total: 40, image: "SK02" },
    "SK0202": { layout: 2, zones: [30, 30], total: 60, image: "SK02" },
    "SK0204": { layout: 2, zones: [25, 25], total: 50, image: "SK02" },
    "SK0F01": { layout: 2, zones: [29, 29], total: 58, image: "SK0F" },
    "SK0F02": { layout: 2, zones: [25, 25], total: 50, image: "SK0F" },

    // 3-zone models
    "SK0121": { layout: 3, zones: [13, 25, 13], total: 51, image: "SK01" },
    "SK0124": { layout: 3, zones: [14, 26, 14], total: 54, image: "SK01" },
    "SK0127": { layout: 3, zones: [17, 31, 17], total: 65, image: "SK01" },
    "SK0132": { layout: 3, zones: [20, 37, 20], total: 77, image: "SK01" },
    "SK0134": { layout: 3, zones: [15, 41, 15], total: 71, image: "SK01" },
    "SK0149": { layout: 3, zones: [19, 69, 19], total: 107, image: "SK01" },

    // 4-zone models
    "SK0L21": { layout: 4, zones: [13, 25, 13, 25], total: 76,  image: "SK0L" },
    "SK0L24": { layout: 4, zones: [14, 26, 14, 26], total: 80,  image: "SK0L" },
    "SK0L27": { layout: 4, zones: [17, 31, 17, 31], total: 96,  image: "SK0L" },
    "SK0L32": { layout: 4, zones: [20, 37, 20, 37], total: 114, image: "SK0L" },
    "SK0L34": { layout: 4, zones: [15, 41, 15, 41], total: 112, image: "SK0L" },

    // SKA series
    "SKA124": { layout: 3, zones: [18, 34, 18], total: 70, image: "SKA1" },
    "SKA127": { layout: 3, zones: [20, 41, 20], total: 81, image: "SKA1" },
    "SKA132": { layout: 3, zones: [25, 45, 25], total: 95, image: "SKA1" },
    "SKA134": { layout: 3, zones: [21, 51, 21], total: 93, image: "SKA1" },

    // Single-zone models
    "SK0402": { layout: 1, zones: [72],   total: 72,   image: "SK04" },
    "SK0403": { layout: 1, zones: [96],   total: 96,   image: "SK04" },
    "SK0404": { layout: 1, zones: [144],  total: 144,  image: "SK04" },
    "SK0901": { layout: 1, zones: [14],   total: 14,   image: "SK09" },
    "SK0801": { layout: 1, zones: [2],    total: 2,    image: "SK08" },
    "SK0803": { layout: 1, zones: [10],   total: 10,   image: "SK08" },
    "SK0E01": { layout: 1, zones: [16],   total: 16,   image: "SK0E" },
    "SK0H01": { layout: 1, zones: [2],    total: 2,    image: "SK0H" },
    "SK0H02": { layout: 1, zones: [4],    total: 4,    image: "SK0H" },
    "SK0S01": { layout: 1, zones: [32],   total: 32,   image: "SK0J" },
    "SK0J01": { layout: 1, zones: [120],  total: 120,  image: "SK0J01" },
    "SK0K01": { layout: 1, zones: [120],  total: 120,  image: "SK0J" },
    "SK0K02": { layout: 1, zones: [15],   total: 15,   image: "SK0J" },
    "SK0M01": { layout: 1, zones: [24],   total: 24,   image: "SK0M" },
    "SK0N01": { layout: 1, zones: [256],  total: 256,  image: "SK0J" },
    "SK0N02": { layout: 1, zones: [1024], total: 1024, image: "SK0J" },
    "SK0N03": { layout: 1, zones: [253],  total: 253,  image: "SK0N03" }
};

function getDeviceImage(image) {
    return `https://dev-dl.skydimo.com/assets/device/${image}.jpg`;
}

export function ImageUrl() {
    if (currentModel && deviceConfig[currentModel]) {
        return getDeviceImage(deviceConfig[currentModel].image);
    }
    return "https://dev-dl.skydimo.com/assets/device/SK0L.jpg";
}

export function Initialize() {
    openSocket();
    rebuildSubdevices();
}

export function Render() {
    if (!socket) openSocket();
    sendColors();
    renderCount++;
    if (Date.now() - lastTickMs >= 10000) emitTick();
}

export function Shutdown(SystemSuspending) {
    const color = SystemSuspending ? "#000000" : shutdownColor;
    sendColors(color);
    if (socket) {
        try { socket.close(); } catch (e) { /* ignore */ }
        socket = null;
    }
}

// SignalRGB calls these when the user changes a setting in the device's
// config page. Property name -> "on<exact-name>Changed" (case-sensitive).
export function ondeviceModelChanged() { rebuildSubdevices(); }
export function onbridgeHostChanged()  { openSocket(); }
export function onbridgePortChanged()  { openSocket(); }

function openSocket() {
    if (socket) {
        try { socket.close(); } catch (e) { /* ignore */ }
        socket = null;
    }

    const host = (typeof bridgeHost !== "undefined" && bridgeHost) ? bridgeHost : "127.0.0.1";
    const port = parseInt(bridgePort, 10) || 19624;

    // If the import didn't give us a usable udp object, try registering it
    // as a runtime feature. SignalRGB's module loader is undocumented enough
    // that we cover both paths.
    let udpRef = udp;
    if (!udpRef || typeof udpRef.createSocket !== "function") {
        device.log("Default udp import unusable (typeof=" + (typeof udpRef) + "). Trying device.addFeature('udp')...");
        try {
            device.addFeature("udp");
            if (typeof globalThis !== "undefined" && globalThis.udp) udpRef = globalThis.udp;
        } catch (e) {
            device.log("device.addFeature('udp') threw: " + e);
        }
    }

    if (!udpRef || typeof udpRef.createSocket !== "function") {
        device.log("UDP module is not available in this plugin context. " +
                   "udp keys: " + (udpRef ? Object.keys(udpRef).join(",") : "n/a"));
        socket = null;
        return;
    }

    try {
        socket = udpRef.createSocket();
        socket.on("error", (err) => {
            device.log("UDP error: " + err);
        });
        socket.connect(host, port);
        device.log("UDP socket pointing at " + host + ":" + port);
    } catch (e) {
        device.log("Failed to create UDP socket: " + e);
        socket = null;
    }
}

function rebuildSubdevices() {
    currentModel = (typeof deviceModel !== "undefined" && deviceModel) ? deviceModel : "SK0L27";
    const config = deviceConfig[currentModel];
    if (!config) {
        device.log("Unknown Skydimo model: " + currentModel);
        return;
    }

    // Purge any prior subdevices in case Initialize and ondeviceModelChanged
    // both fire on startup. Re-creating a channel without removing it first
    // can leave the third subdevice in a state where subdeviceColor() reads
    // back as [0,0,0] (matches the JPU ELITE plugin's pattern for this).
    for (let i = 1; i <= 4; i++) {
        try { device.removeSubdevice(`CH${i}`); } catch (e) { /* not present */ }
    }

    device.setName("Skydimo " + currentModel);
    device.setImageFromUrl(getDeviceImage(config.image));

    const zones  = config.zones || [];
    const layout = config.layout || 1;

    zoneChangeCount  = new Array(layout).fill(0);
    zoneLastChecksum = new Array(layout).fill(0);
    zoneSampleColor  = new Array(layout).fill("");
    renderCount = 0;
    udpSendFailCount = 0;
    lastTickMs = Date.now();

    for (let i = 0; i < layout; i++) {
        const zoneSize = zones[i] || 0;
        const channel  = `CH${i + 1}`;
        const name     = layout === 1 ? "Device" : `Segment ${i + 1}`;

        const names = [];
        const positions = [];
        for (let j = 0; j < zoneSize; j++) {
            names.push(`LED ${j + 1}`);
            positions.push([j, 0]);
        }

        device.createSubdevice(channel);
        device.setSubdeviceName(channel, name);
        device.setSubdeviceSize(channel, zoneSize, 1);
        device.setSubdeviceLeds(channel, names, positions);
        device.setSubdeviceImageUrl(channel, getDeviceImage(config.image));
    }
    device.log(`Configured ${currentModel}: ${layout} zone(s), ${config.total} LEDs total.`);
}

function sendColors(overrideColor) {
    if (!socket) return;
    const config = deviceConfig[currentModel];
    if (!config) return;

    const count = config.total - 1;
    // Adalight header: "Ada" + 0x00 + hi + lo where (hi<<8)|lo == LED_count - 1
    const packet = [0x41, 0x64, 0x61, 0x00, (count >> 8) & 0xFF, count & 0xFF];

    const fixedRgb = overrideColor
        ? hexToRgb(overrideColor)
        : (LightingMode === "Forced" ? hexToRgb(forcedColor) : null);

    for (let z = 0; z < config.layout; z++) {
        const channel = `CH${z + 1}`;
        const zoneSize = config.zones[z];
        let checksum = 0;
        let firstR = 0, firstG = 0, firstB = 0;

        for (let x = 0; x < zoneSize; x++) {
            const c = fixedRgb || device.subdeviceColor(channel, x, 0);
            const r = c[0] | 0, g = c[1] | 0, b = c[2] | 0;
            packet.push(r, g, b);
            checksum = (checksum * 31 + r * 65536 + g * 256 + b) | 0;
            if (x === 0) { firstR = r; firstG = g; firstB = b; }
        }

        if (zoneLastChecksum[z] !== checksum) {
            zoneChangeCount[z]++;
            zoneLastChecksum[z] = checksum;
        }
        zoneSampleColor[z] = "#" + toHex2(firstR) + toHex2(firstG) + toHex2(firstB);
    }

    try {
        socket.send(packet);
    } catch (e) {
        udpSendFailCount++;
        if (udpSendFailCount === 1) device.log("UDP send failed: " + e);
        socket = null;
    }
}

function emitTick() {
    const parts = [];
    for (let z = 0; z < zoneChangeCount.length; z++) {
        parts.push(`CH${z + 1}=chg${zoneChangeCount[z]}/${zoneSampleColor[z] || "n/a"}`);
    }
    device.log(`tick render=${renderCount} udpFail=${udpSendFailCount} ${parts.join(" ")}`);

    renderCount = 0;
    udpSendFailCount = 0;
    for (let z = 0; z < zoneChangeCount.length; z++) zoneChangeCount[z] = 0;
    lastTickMs = Date.now();
}

function toHex2(n) {
    const s = (n & 0xFF).toString(16);
    return s.length === 1 ? "0" + s : s;
}

function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!m) return [0, 0, 0];
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}
