export function Name() { return "Skydimo SK0902"; }
export function VendorId() { return 0x1A86; }
export function ProductId() { return 0xE316; }
export function Publisher() { return "I'm Not MentaL & 嘤嘤猫"; }
export function Documentation() { return "troubleshooting/skydimo"; }
export function Size() { return [8, 8]; }
export function DefaultPosition() { return [40, 120]; }
export function DefaultScale() { return 1.0; }
export function DeviceType() { return "other"; }
/* global
shutdownColor:readonly
LightingMode:readonly
forcedColor:readonly
*/
export function ControllableParameters() {
	return [
		{ "property": "shutdownColor", "group": "lighting", "label": "Shutdown Color", description: "This color is applied to the device when the System, or SignalRGB is shutting down", "min": "0", "max": "360", "type": "color", "default": "#000000" },
		{ "property": "LightingMode", "group": "lighting", "label": "Lighting Mode", description: "Determines where the device's RGB comes from. Canvas will pull from the active Effect, while Forced will override it to a specific color", "type": "combobox", "values": ["Canvas", "Forced"], "default": "Canvas" },
		{ "property": "forcedColor", "group": "lighting", "label": "Forced Color", description: "The color used when 'Forced' Lighting Mode is enabled", "min": "0", "max": "360", "type": "color", "default": "#009bde" }
	];
}

export function Initialize() {
	device.setFrameRateTarget(60);
}

export function Shutdown(SystemSuspending) {
	const color = SystemSuspending ? "#000000" : shutdownColor;
	grabColors(color);
}

const PACKET_SIZE = 64;
const PACKET_RGB_BYTES = 60;
const END_PACKET = [
    0x01, 0xFF, 0xFF, 0x31,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x1E, // index 60
    0x00, 0x00, 0x00
];
let scrollOffset = 0;

const vKeyNames = [
	"Led 0", "Led 1", "Led 2", "Led 3", "Led 4", "Led 5", "Led 6",
	"Led 7", "Led 8", "Led 9", "Led 10", "Led 11", "Led 12", "Led 13",
	"Led 14", "Led 15", "Led 16", "Led 17", "Led 18", "Led 19", "Led 20",
	"Led 21", "Led 22", "Led 23", "Led 24", "Led 25", "Led 26", "Led 27",
	"Led 28", "Led 29", "Led 30", "Led 31", "Led 32", "Led 33", "Led 34",
	"Led 35", "Led 36", "Led 37", "Led 38", "Led 39", "Led 40", "Led 41",
	"Led 42", "Led 43", "Led 44", "Led 45", "Led 46", "Led 47", "Led 48"
];

const vKeyPositions = [
	[0, 6], [0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0],
	[1, 0], [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
	[2, 6], [2, 5], [2, 4], [2, 3], [2, 2], [2, 1], [2, 0],
	[3, 0], [3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [3, 6],
	[4, 6], [4, 5], [4, 4], [4, 3], [4, 2], [4, 1], [4, 0],
	[5, 0], [5, 1], [5, 2], [5, 3], [5, 4], [5, 5], [5, 6],
	[6, 6], [6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0]
];

export function LedNames() {
	return vKeyNames;
}

export function LedPositions() {
	return vKeyPositions;
}

export function Render() {
    sendColors(grabColors());
}

export function Validate(endpoint) {
	return endpoint.interface === 0 && endpoint.usage === 0x0001 && endpoint.usage_page === 0xFF00;
}

export function ImageUrl() {
	return "https://dev-dl.skydimo.com/assets/device/SK09.jpg";
}

function crc8(data) {
    let crc = 0x00;

    for (let i = 0; i < data.length; i++) {
        crc ^= data[i];
        for (let j = 0; j < 8; j++) {
            if (crc & 0x80) {
                crc = ((crc << 1) ^ 0x07) & 0xFF;
            } else {
                crc = (crc << 1) & 0xFF;
            }
        }
    }
    return crc & 0xFF;
}

function build64BytePacket(packet63) {
    if (packet63.length !== 63) {
        throw new Error("Input must be exactly 63 bytes");
    }
    const packet = packet63.slice(); // copy
    // CRC over first 63 bytes
    const crc = crc8(packet);
    // append CRC as 64th byte
    packet.push(crc);
    return packet;
}

function hexToRgb(hex) {
    let result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    let colors = [];
    colors[0] = parseInt(result[1], 16);
    colors[1] = parseInt(result[2], 16);
    colors[2] = parseInt(result[3], 16);

    return colors;
}

function grabColors(overrideColor) {
    let RGBData = [];

    for (let i = 0; i < vKeyPositions.length; i++) {
        const [x, y] = vKeyPositions[i];
        let color;

		if (overrideColor) {
            color = hexToRgb(shutdownColor);
		} else if (LightingMode === "Forced") {
            color = hexToRgb(forcedColor);
        } else {
            color = device.color(x, y);
        }
        RGBData.push(color[1], color[0], color[2]);
    }
    return RGBData;
}

function sendColors(frameData) {
    let packetsCount = Math.ceil(frameData.length / PACKET_RGB_BYTES);
    for (let packetID = 0; packetID < packetsCount; packetID++) {
        let start = packetID * PACKET_RGB_BYTES;
        let end = start + PACKET_RGB_BYTES;
        let chunk = frameData.slice(start, end);
        let packet63 = [0x01, packetID * 20, 0x00, ...chunk];
        sendPacket(packet63);
    }
    device.write(END_PACKET, PACKET_SIZE);
}

function sendPacket(packet63) {
    packet63 = packet63.concat(new Array(63 - packet63.length).fill(0));
    let packet = build64BytePacket(packet63);
    device.write(packet, PACKET_SIZE);
}