/**
 * NULLPAD — Cemuhook / DSU Motion Server
 *
 * Exposes the active mobile controller's motion data to Cemu over the
 * standard DSU UDP protocol. Default: 127.0.0.1:26760.
 *
 * The XInput/ViGEm path remains responsible for ordinary buttons + rumble.
 * DSU adds the motion channel that XInput cannot carry.
 */
'use strict';

const dgram = require('dgram');
const crypto = require('crypto');
const cfg = require('../config');

const PROTOCOL_VERSION = 1001;
const PORT = cfg.DSU.PORT;
const HOST = cfg.DSU.HOST;
const DATA_TYPE = 0x100002;
const INFO_TYPE = 0x100001;
const VERSION_TYPE = 0x100000;
const MOTOR_INFO_TYPE = 0x110001;
const MOTOR_RUMBLE_TYPE = 0x110002;
const MAGIC_SERVER = Buffer.from('DSUS', 'ascii');
const MAGIC_CLIENT = Buffer.from('DSUC', 'ascii');
const MAC = Buffer.from([0x4e, 0x55, 0x4c, 0x4c, 0x50, 0x01]);
const G = 9.80665;
const SUBSCRIBER_TIMEOUT_MS = 5000;
const RUMBLE_TIMEOUT_MS = 5000;
const SEND_INTERVAL_MS = 16;
let lastRumblePacket = 0;

let socket = null;
let sendTimer = null;
let sourceGetter = () => null;
let hapticSink = () => {};
let running = false;
let packetCounter = 0;
const serverId = crypto.randomBytes(4).readUInt32LE(0);
const subscribers = new Map();
const rumble = { large: 0, small: 0 };

// CRC32 table for DSU packet validation.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let bit = 0; bit < 8; bit++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function setHeader(buffer, lengthWithoutHeader, type) {
  MAGIC_SERVER.copy(buffer, 0);
  buffer.writeUInt16LE(PROTOCOL_VERSION, 4);
  buffer.writeUInt16LE(lengthWithoutHeader, 6);
  buffer.writeUInt32LE(0, 8);
  buffer.writeUInt32LE(serverId >>> 0, 12);
  buffer.writeUInt32LE(type >>> 0, 16);
}

function finalizePacket(buffer) {
  buffer.writeUInt32LE(0, 8);
  buffer.writeUInt32LE(crc32(buffer), 8);
  return buffer;
}

function send(buffer, port, address) {
  if (!socket || !running) return;
  socket.send(buffer, 0, buffer.length, port, address, (error) => {
    if (error) console.warn('[DSU] UDP send failed:', error.message || error);
  });
}

function buildVersionPacket() {
  const buffer = Buffer.alloc(22);
  setHeader(buffer, 6, VERSION_TYPE);
  buffer.writeUInt16LE(PROTOCOL_VERSION, 20);
  return finalizePacket(buffer);
}

function controllerConnected() {
  return !!sourceGetter();
}

function buildControllerInfoPacket(slot = 0) {
  const buffer = Buffer.alloc(32);
  setHeader(buffer, 16, INFO_TYPE);
  const connected = controllerConnected();
  buffer.writeUInt8(slot, 20);
  buffer.writeUInt8(connected ? 2 : 0, 21); // connected
  const state = sourceGetter();
  const gyro = !!state?.motion?.gyroAvailable;
  const accel = !!state?.motion?.accelAvailable;
  buffer.writeUInt8(gyro ? 2 : (accel ? 1 : 0), 22); // motion capability
  buffer.writeUInt8(0, 23);                 // not applicable (network source)
  MAC.copy(buffer, 24);
  buffer.writeUInt8(0, 30);                    // battery not exposed by browser
  buffer.writeUInt8(0, 31);
  return finalizePacket(buffer);
}

function boolBit(value) { return value ? 1 : 0; }
function axisByte(v) {
  const n = Math.max(-1, Math.min(1, Number(v) || 0));
  return Math.round((n + 1) * 127.5);
}
function analogByte(v) {
  return Math.max(0, Math.min(255, Math.round(Number(v) || 0)));
}

function buildControllerDataPacket(state, packetNo = ++packetCounter) {
  const buffer = Buffer.alloc(100);
  setHeader(buffer, 84, DATA_TYPE);
  const active = state ? state : null;

  // Shared DSU controller info (11 bytes).
  buffer.writeUInt8(0, 20); // slot
  buffer.writeUInt8(active ? 2 : 0, 21); // connected
  buffer.writeUInt8(active?.motion?.gyroAvailable ? 2 : 1, 22); // model
  buffer.writeUInt8(0, 23); // connection type not applicable
  MAC.copy(buffer, 24);
  buffer.writeUInt8(0, 30); // phone battery is not exposed here

  // 11.. onward payload fields.
  buffer.writeUInt8(state ? 1 : 0, 31);
  buffer.writeUInt32LE(packetNo >>> 0, 32);

  const s = active || {};
  const n = s.nunchuk || {};

  let b16 = 0;
  if (s.dpadLeft) b16 |= 0x80;
  if (s.dpadDown) b16 |= 0x40;
  if (s.dpadRight) b16 |= 0x20;
  if (s.dpadUp) b16 |= 0x10;
  if (s.plus) b16 |= 0x08;
  if (s.r3) b16 |= 0x04;
  if (s.l3) b16 |= 0x02;
  if (s.minus) b16 |= 0x01;
  buffer.writeUInt8(b16, 36);

  let b17 = 0;
  if (s.two) b17 |= 0x80;       // Y
  if (s.b) b17 |= 0x40;         // B
  if (s.a) b17 |= 0x20;         // A
  if (s.one) b17 |= 0x10;       // X
  if (n.c) b17 |= 0x08;          // R1
  if (n.z) b17 |= 0x01;          // L2 digital fallback
  buffer.writeUInt8(b17, 37);

  buffer.writeUInt8(boolBit(s.home), 38); // Home
  buffer.writeUInt8(0, 39);               // Touch button

  const leftX = Number.isFinite(n.jx) ? n.jx : 0;
  const leftY = Number.isFinite(n.jy) ? -n.jy : 0;
  const rightX = Number.isFinite(s.irX) ? s.irX : 0;
  const rightY = Number.isFinite(s.irY) ? -s.irY : 0;
  buffer.writeUInt8(axisByte(leftX), 40);
  buffer.writeUInt8(axisByte(leftY), 41);
  buffer.writeUInt8(axisByte(rightX), 42);
  buffer.writeUInt8(axisByte(rightY), 43);

  buffer.writeUInt8(s.dpadLeft ? 255 : 0, 44);
  buffer.writeUInt8(s.dpadDown ? 255 : 0, 45);
  buffer.writeUInt8(s.dpadRight ? 255 : 0, 46);
  buffer.writeUInt8(s.dpadUp ? 255 : 0, 47);
  buffer.writeUInt8(s.two ? 255 : 0, 48);
  buffer.writeUInt8(s.b ? 255 : 0, 49);
  buffer.writeUInt8(s.a ? 255 : 0, 50);
  buffer.writeUInt8(s.one ? 255 : 0, 51);
  buffer.writeUInt8(n.c ? 255 : 0, 52);
  buffer.writeUInt8(n.c ? 255 : 0, 53);
  buffer.writeUInt8(s.b ? 255 : 0, 54);
  buffer.writeUInt8(n.z ? 255 : 0, 55);

  // Touch slots 1 and 2 (unused by the Wiimote profile).
  buffer.fill(0, 56, 68);

  const m = s.motion || {};
  const timestamp = Math.max(0, Math.floor(Number(m.timestampUs) || Date.now() * 1000));
  buffer.writeBigUInt64LE(BigInt(timestamp), 68);
  buffer.writeFloatLE((Number(m.accelX) || 0) / G, 76);
  buffer.writeFloatLE((Number(m.accelY) || 0) / G, 80);
  buffer.writeFloatLE((Number(m.accelZ) || 0) / G, 84);
  buffer.writeFloatLE(Number(m.gyroPitch) || 0, 88);
  buffer.writeFloatLE(Number(m.gyroYaw) || 0, 92);
  buffer.writeFloatLE(Number(m.gyroRoll) || 0, 96);

  return finalizePacket(buffer);
}

function validIncomingPacket(message) {
  if (message.length < 20) return false;
  const declaredLength = message.readUInt16LE(6);
  const expectedTotal = 16 + declaredLength;
  if (message.length < expectedTotal) return false;
  const expectedCrc = message.readUInt32LE(8);
  const copy = Buffer.from(message.subarray(0, expectedTotal));
  copy.writeUInt32LE(0, 8);
  return crc32(copy) === expectedCrc;
}

function handleMessage(message, rinfo) {
  if (!Buffer.isBuffer(message) || message.length < 20) return;
  if (message.subarray(0, 4).compare(MAGIC_CLIENT) !== 0) return;
  if (!validIncomingPacket(message)) return;

  const version = message.readUInt16LE(4);
  if (version > PROTOCOL_VERSION) return;
  const type = message.readUInt32LE(16);
  const payload = message.subarray(20);
  const key = `${rinfo.address}:${rinfo.port}`;

  if (type === VERSION_TYPE) {
    send(buildVersionPacket(), rinfo.port, rinfo.address);
    return;
  }

  if (type === INFO_TYPE) {
    const requested = payload.readInt32LE(0);
    const count = Number.isFinite(requested) ? Math.max(0, Math.min(4, requested)) : 0;
    for (let i = 0; i < count && 4 + i < payload.length; i++) {
      send(buildControllerInfoPacket(payload.readUInt8(4 + i)), rinfo.port, rinfo.address);
    }
    return;
  }

  if (type === DATA_TYPE) {
    const flags = payload.readUInt8(0);
    const slot = payload.length >= 2 ? payload.readUInt8(1) : 0;
    subscribers.set(key, { address: rinfo.address, port: rinfo.port, slot: (flags & 1) ? slot : 0, lastSeen: Date.now() });
    send(buildControllerDataPacket(sourceGetter()), rinfo.port, rinfo.address);
    return;
  }

  if (type === MOTOR_INFO_TYPE) {
    const buffer = Buffer.alloc(33);
    setHeader(buffer, 17, MOTOR_INFO_TYPE);
    // Controller identification header (8 bytes) echoed from request.
    payload.subarray(0, 8).copy(buffer, 20, 0, 8);
    buffer.writeUInt8(2, 28); // report two host-side motors; phone combines them
    send(finalizePacket(buffer), rinfo.port, rinfo.address);
    return;
  }

  if (type === MOTOR_RUMBLE_TYPE) {
    const motorId = payload.length > 8 ? payload.readUInt8(8) : 0;
    const intensity = payload.length > 9 ? payload.readUInt8(9) : 0;
    if (motorId === 0) rumble.large = intensity;
    else rumble.small = intensity;
    lastRumblePacket = Date.now();
    hapticSink({ large: rumble.large, small: rumble.small });
  }
}

function start(getState, onHaptic) {
  if (running) return true;
  sourceGetter = typeof getState === 'function' ? getState : () => null;
  hapticSink = typeof onHaptic === 'function' ? onHaptic : () => {};

  socket = dgram.createSocket('udp4');
  socket.on('message', handleMessage);
  socket.on('error', (error) => {
    running = false;
    console.error(`[DSU] UDP error on ${HOST}:${PORT}:`, error.message || error);
  });

  try {
    socket.bind(PORT, HOST, () => {
      running = true;
      console.log(`[DSU] Motion server listening on udp://${HOST}:${PORT}`);
    });
  } catch (error) {
    socket.close();
    socket = null;
    console.error('[DSU] Failed to bind:', error.message || error);
    return false;
  }

  sendTimer = setInterval(() => {
    if (!running) return;
    const now = Date.now();
    if (lastRumblePacket && now - lastRumblePacket > RUMBLE_TIMEOUT_MS) {
      if (rumble.large || rumble.small) hapticSink({ large: 0, small: 0 });
      rumble.large = 0;
      rumble.small = 0;
      lastRumblePacket = 0;
    }
    for (const [key, sub] of subscribers) {
      if (now - sub.lastSeen > SUBSCRIBER_TIMEOUT_MS) {
        subscribers.delete(key);
        continue;
      }
      send(buildControllerDataPacket(sourceGetter()), sub.port, sub.address);
    }
  }, SEND_INTERVAL_MS);

  return true;
}

function stop() {
  if (sendTimer) clearInterval(sendTimer);
  sendTimer = null;
  subscribers.clear();
  running = false;
  if (socket) {
    try { socket.close(); } catch (_) {}
  }
  socket = null;
}

function isRunning() { return running; }
function getPort() { return PORT; }
function getHost() { return HOST; }

module.exports = {
  start,
  stop,
  isRunning,
  getPort,
  getHost,
  crc32,
  buildVersionPacket,
  buildControllerInfoPacket,
  buildControllerDataPacket,
};
