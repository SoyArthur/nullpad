/**
 * NULLPAD — Central Configuration
 * All tuneable values live here. Nothing is hardcoded elsewhere.
 */

'use strict';

const { detectNetwork } = require('./server/network');

const NETWORK = detectNetwork();
const LOCAL_IP = NETWORK.primary;

module.exports = {
  // ── Network ──────────────────────────────────────────────────────────────
  HOST: LOCAL_IP,
  LAN_IPS: NETWORK.ips,
  NETWORK_SOURCE: NETWORK.source,
  PORT: parseInt(process.env.NULLPAD_PORT || '8443', 10),
  get WSS_URL() { return `wss://${this.HOST}:${this.PORT}`; },

  // ── SSL paths ─────────────────────────────────────────────────────────────
  SSL: {
    CERT: './ssl/cert.pem',
    KEY:  './ssl/key.pem',
  },

  // ── Gamepad / ViGEm ──────────────────────────────────────────────────────
  MAX_CONTROLLERS: 1,

  // ── Wiimote IR → Analog mapping ──────────────────────────────────────────
  // DeviceOrientation beta/gamma → right stick axes for Dolphin IR pointer
  IR: {
    BETA_RANGE:  [-45, 45],   // degrees, maps to Y axis [-1, 1]
    GAMMA_RANGE: [-45, 45],   // degrees, maps to X axis [-1, 1]
    DEADZONE:    0.04,        // normalized, applied after mapping
    SMOOTHING:   0.15,        // exponential smoothing factor (0=none, 1=frozen)
  },

  // ── Cemuhook / DSU motion bridge ─────────────────────────────────────────
  DSU: {
    HOST: process.env.NULLPAD_DSU_HOST || '127.0.0.1',
    PORT: parseInt(process.env.NULLPAD_DSU_PORT || '26760', 10),
  },

  // ── Haptics ───────────────────────────────────────────────────────────────
  HAPTICS: {
    POLL_MS:     16,    // how often server polls ViGEm for rumble state
    STRENGTH_HI: 255,
    STRENGTH_LO: 0,
  },

  // ── Profiles available ────────────────────────────────────────────────────
  PROFILES: ['wiimote', 'dualSense', 'xbox', 'joycon'],
  DEFAULT_PROFILE: 'wiimote',

  // ── Client UX ─────────────────────────────────────────────────────────────
  HEARTBEAT_MS:   5000,   // WS ping interval
  RECONNECT_MS:   2000,   // client reconnect delay
};
