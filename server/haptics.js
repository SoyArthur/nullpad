/**
 * NULLPAD — Haptics Manager
 * Polls ViGEm for rumble feedback and forwards it to the mobile client
 * via WebSocket so the phone can vibrate via navigator.vibrate().
 */

'use strict';

const cfg   = require('../config');
const vigem = require('./vigem');

const timers = new Map(); // socketId → intervalId
const last   = new Map(); // socketId → { large, small } — last sent state
const senders = new Map();

function start(socketId, sendFn) {
  if (timers.has(socketId)) return;
  senders.set(socketId, sendFn);

  const id = setInterval(() => {
    const rumble = vigem.getRumble(socketId);

    // Only send when state changes to avoid flooding
    const prev = last.get(socketId) || { large: -1, small: -1 };
    if (rumble.large === prev.large && rumble.small === prev.small) return;

    last.set(socketId, { ...rumble });

    // Compute vibration pattern: [durationMs] or [onMs, offMs, onMs...]
    const pattern = buildPattern(rumble);
    sendFn({ type: 'haptic', pattern });
  }, cfg.HAPTICS.POLL_MS);

  timers.set(socketId, id);
}

function stop(socketId) {
  try { sendFnForStop(socketId); } catch (_) {}
  const id = timers.get(socketId);
  if (id !== undefined) {
    clearInterval(id);
    timers.delete(socketId);
    last.delete(socketId);
    senders.delete(socketId);
  }
}

/**
 * Convert ViGEm motor values [0..255] to a navigator.vibrate() pattern.
 * Large motor = low-freq body rumble, small = high-freq.
 */
function buildPattern(rumble) {
  const { large, small } = rumble;

  if (large === 0 && small === 0) return [0]; // stop vibration

  // Duration proportional to strongest motor (16–200 ms)
  const strength = Math.max(large, small) / 255;
  const duration = Math.round(16 + strength * 184);

  if (large > 0 && small > 0) {
    // Both: continuous
    return [duration];
  }
  if (large > 0) {
    // Low rumble: slow pulse
    return [duration, 20, duration];
  }
  // Small only: rapid stutter
  return [duration * 0.4, 10, duration * 0.4, 10, duration * 0.4].map(Math.round);
}

function sendFnForStop(socketId) {
  const sendFn = senders.get(socketId);
  if (typeof sendFn === 'function') sendFn({ type: 'haptic', pattern: [0] });
}

module.exports = { start, stop };
