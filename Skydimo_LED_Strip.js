import serial from "@SignalRGB/serial";
export function Name() { return "Skydimo LED Strip"; }
export function VendorId() { return 0x1A86; }
export function ProductId() { return [0x7523]; }
export function Publisher() { return "I'm Not MentaL"; }
export function Documentation() { return "troubleshooting/skydimo"; }
export function Type() { return "serial"; }
export function DeviceType() { return "lightingcontroller"; }
export function SubdeviceController() { return true; }
/* global
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
*/
export function ControllableParameters() {
    return [
        { property: "shutdownColor", group: "lighting", label: "Shutdown Color", description: "This color is applied to the device when the System, or SignalRGB is shutting down", min: "0", max: "360", type: "color", default: "#000000" },
        { property: "LightingMode", group: "lighting", label: "Lighting Mode", description: "Determines where the device's RGB comes from. Canvas will pull from the active Effect, while Forced will override it to a specific color", type: "combobox", values: ["Canvas", "Forced"], default: "Canvas" },
        { property: "forcedColor", group: "lighting", label: "Forced Color", description: "The color used when 'Forced' Lighting Mode is enabled", min: "0", max: "360", type: "color", default: "#009bde" },
    ];
}

let skydimoPortName = null;
let skydimoModel = null;
let skydimoInfoRead = false;

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
    "SK0L21": { layout: 4, zones: [13, 25, 13, 25], total: 76, image: "SK0L" },
    "SK0L24": { layout: 4, zones: [14, 26, 14, 26], total: 80, image: "SK0L" },
    "SK0L27": { layout: 4, zones: [17, 31, 17, 31], total: 96, image: "SK0L" },
    "SK0L32": { layout: 4, zones: [20, 37, 20, 37], total: 114, image: "SK0L" },
    "SK0L34": { layout: 4, zones: [15, 41, 15, 41], total: 112, image: "SK0L" },

    // SKA series
    "SKA124": { layout: 3, zones: [18, 34, 18], total: 70, image: "SKA1" },
    "SKA127": { layout: 3, zones: [20, 41, 20], total: 81, image: "SKA1" },
    "SKA132": { layout: 3, zones: [25, 45, 25], total: 95, image: "SKA1" },
    "SKA134": { layout: 3, zones: [21, 51, 21], total: 93, image: "SKA1" },

    // Single-zone LED strip models
    "SK0402": { layout: 1, zones: [72], total: 72, image: "SK04" },
    "SK0403": { layout: 1, zones: [96], total: 96, image: "SK04" },
    "SK0404": { layout: 1, zones: [144], total: 144, image: "SK04" },
    "SK0901": { layout: 1, zones: [14], total: 14, image: "SK09" },
    "SK0801": { layout: 1, zones: [2], total: 2, image: "SK08" },
    "SK0803": { layout: 1, zones: [10], total: 10, image: "SK08" },
    "SK0E01": { layout: 1, zones: [16], total: 16, image: "SK0E" },
    "SK0H01": { layout: 1, zones: [2], total: 2, image: "SK0H" },
    "SK0H02": { layout: 1, zones: [4], total: 4, image: "SK0H" },
    "SK0S01": { layout: 1, zones: [32], total: 32, image: "SK0J" }, // Image is placeholder
    "SK0J01": { layout: 1, zones: [120], total: 120, image: "SK0J01" },
    "SK0K01": { layout: 1, zones: [120], total: 120, image: "SK0J" }, // Image is placeholder
    "SK0K02": { layout: 1, zones: [15], total: 15, image: "SK0J" }, // Image is placeholder
    "SK0M01": { layout: 1, zones: [24], total: 24, image: "SK0M" },
    "SK0N01": { layout: 1, zones: [256], total: 256, image: "SK0J" }, // Image is placeholder
    "SK0N02": { layout: 1, zones: [1024], total: 1024, image: "SK0J" }, // Image is placeholder
    "SK0N03": { layout: 1, zones: [253], total: 253, image: "SK0N03" }
}

export function ImageUrl() {
    if (skydimoModel && deviceConfig[skydimoModel]) {
        return getDeviceImage(deviceConfig[skydimoModel].image);
    } else {
        return "https://dev-dl.skydimo.com/assets/device/SK0J.jpg";
    }
}

// init serial connection
export function Initialize() {
    const ports = serial.availablePorts();
    if (!ports.length) {
        console.log("No serial ports detected.");
        return;
    }

    skydimoPortName = ports.find(p =>
        p.vendorId === 0x1A86 && p.productId === 0x7523
    )?.portName;

    if (!skydimoPortName) {
        console.log("Skydimo device not found.");
        return;
    }

    // attempt to connect to Skydimo
    connectToSkydimo();
}

// renders colors
export function Render() {
    // automatic reconnect if disconnected
    if (!serial.isConnected()) {
        console.log("Serial port not connected, attempting reconnect...");
        connectToSkydimo();
    }

    sendColors();
}

// shut down colors
export function Shutdown(SystemSuspending) {
    if (!skydimoPortName) return;

    const color = SystemSuspending ? "#000000" : shutdownColor;
    sendColors(color);

    disconnect();
}

function connectToSkydimo() {
    if (!skydimoPortName) return false;

    if (serial.isConnected()) return true;

    const connected = serial.connect({
        portName: skydimoPortName,
        baudRate: 115200,
        parity: "None",
        dataBits: 8,
        stopBits: "One"
    });

    if (!connected) {
        console.log("Failed to connect to Skydimo.");
        return false;
    }

    console.log("Connected to Skydimo on port", skydimoPortName);
    const info = serial.getDeviceInfo(skydimoPortName);
    console.log("Device Info:", info);

    skydimoInfoRead = getDeviceInfo();

    return true;
}

function disconnect() {
    if (serial.isConnected()) {
        serial.disconnect();
        console.log("Disconnected from serial port");
    }
}

// grabs colors and sends
function sendColors(overrideColor) {
    if (!skydimoPortName) return;
    if (!serial.isConnected()) {
        console.warn("Serial port not connected, skipping color write");
        return;
    }
    if (!skydimoInfoRead) return;

    const RGBData = [];
    const config = deviceConfig[skydimoModel];
    const count = config.total - 1;

    // Get colors from each segments.
    for (let i = 0; i < config.layout; i++) {
        RGBData.push(getZoneColors(i + 1, config.zones[i], overrideColor));
    }
    // Convert RGB array of arrays to one single flat array.
    const MergedRGBData = [].concat.apply([], RGBData);

    // Build Adalight header: "Ada" + 0x00 + count (2 bytes)
    const header = [0x41, 0x64, 0x61, 0x00, (count >> 8) & 0xFF, count & 0xFF];
    const packet = [...header, ...MergedRGBData];
    const success = serial.write(packet);

    if (!success) console.error("Failed to write LED colors");
}

// Convert hex string to RGB array.
function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    return [
        parseInt(result[1], 16),
        parseInt(result[2], 16),
        parseInt(result[3], 16)
    ];
}

// Skydimo's unconventional method of getting device model and serial no.
function getDeviceInfo() {
    if (!skydimoPortName || !serial.isConnected()) {
        return false;
    }

    // Send query command "Moni-A"
    const cmd = "Moni-A";
    const bytes = Array.from(cmd).map(c => c.charCodeAt(0));
    serial.write(bytes);

    // Wait briefly for response (1000ms)
    device.pause(1000);

    // Read response (up to 64 bytes)
    const buf = serial.read(64, 1000);
    if (!buf || buf.length === 0) {
        console.log("No response from Skydimo device.");
        return false;
    }

    // Convert byte array to string
    const response = String.fromCharCode(...buf);
    device.log("Raw response:", response);

    // Parse "Model,Serial"
    const commaPos = response.indexOf(",");
    if (commaPos !== -1) {
        const model = response.substring(0, commaPos).trim();
        const serialRaw = response.substring(commaPos + 1).trim();
        let device_name = 'Skydimo';
        let device_serial = '000000';

        if (model) {
            device_name = "Skydimo " + model;
            skydimoModel = model;

            const devConfig = deviceConfig[model];
            if (!devConfig) {
                device.log(`No configuration found for model: ${model}, please contact SignalRGB support.`);
            } else {
                device.setName(device_name);
                buildSubdeviceFromConfig(devConfig);
                device.setImageFromUrl(getDeviceImage(devConfig.image));
                device.setFrameRateTarget(60);
                device.log("Device Name:", device_name);
            }
        }

        if (serialRaw) {
            // Convert serial to hex string
            device_serial = Array.from(serialRaw)
                .map(ch => ch.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase())
                .join("");
            device.log("Device Serial:", device_serial);
        }

        return true;
    }

    return false;
}

// Get Zone (Segment) colors.
function getZoneColors(zone, count, overrideColor) {
    const RGBData = [];
    const positions = generateLedPositions(count);

    for (let i = 0; i < positions.length; i++) {
        const [x, y] = positions[i];
        let color;

        if (overrideColor) {
            color = hexToRgb(shutdownColor);
        } else if (LightingMode === "Forced") {
            color = hexToRgb(forcedColor)
        } else {
            color = device.subdeviceColor(`CH${zone}`, x, y);
        }

        RGBData.push(color[0]); // R
        RGBData.push(color[1]); // G
        RGBData.push(color[2]); // B
    }

    return RGBData;
}

function getDeviceImage(image) {
    return `https://dev-dl.skydimo.com/assets/device/${image}.jpg`;
}

function buildSubdeviceFromConfig(config) {
    const zones = config.zones || [];
    const layout = config.layout || 1;

    let offset = 0;
    for (let i = 0; i < layout; i++) {
        const zoneSize = zones[i] || 0;
        const channel = `CH${i + 1}`;
        const name = layout === 1 ? "Device" : `Segment ${i + 1}`;

        device.createSubdevice(channel);
        device.setSubdeviceName(channel, name);
        device.setSubdeviceSize(channel, zoneSize, 1);
        device.setSubdeviceLeds(channel, generateLedNames(zoneSize, offset), generateLedPositions(zoneSize));
        device.setSubdeviceImageUrl(channel, getDeviceImage(config.image));

        offset += zoneSize;
    }
}

function generateLedNames(count, start = 1) {
    const names = [];

    for (let i = start; i <= count; i++) {
        names.push(`LED ${i}`);
    }
    return names;
}

function generateLedPositions(count) {
    const positions = [];
    for (let i = 0; i < count; i++) {
        positions.push([i, 0]);
    }
    return positions;
}