/**
 * NULLPAD — Mouse bridge
 *
 * Exposes two input channels that move the Windows mouse cursor:
 *   - gyroMouse(dx, dy)   — gyro-derived relative movement
 *   - trackpadDelta(dx, dy) — touchpad swipe relative movement
 *
 * Uses @jitsi/robotjs for native cursor control (no admin required).
 * Fails silently if robotjs is unavailable so the rest of NULLPAD still works.
 */
'use strict';

let robot = null;
let available = false;

function init() {
  if (available) return true;
  try {
    robot = require('@jitsi/robotjs');
    available = true;
    console.log('[Mouse] robotjs ready ✅');
    return true;
  } catch (e) {
    console.warn('[Mouse] robotjs unavailable — gyro-mouse and trackpad disabled:', e.message || e);
    return false;
  }
}

// ── Gyro mouse ───────────────────────────────────────────────────────────────
// Sensitivity: higher = faster. Tuned for ~±10 deg/s being comfortable.
const GYRO_SENSITIVITY = 5.5;

function gyroMouse(dx, dy) {
  if (!available) return;
  try {
    const pos = robot.getMousePos();
    robot.moveMouse(
      Math.round(pos.x + dx * GYRO_SENSITIVITY),
      Math.round(pos.y + dy * GYRO_SENSITIVITY)
    );
  } catch (_) {}
}

// ── Trackpad delta ───────────────────────────────────────────────────────────
// The phone sends normalized delta [-1, 1] per axis; we scale to pixels.
const TRACKPAD_SENSITIVITY = 18;

function trackpadDelta(dx, dy) {
  if (!available) return;
  try {
    const pos = robot.getMousePos();
    robot.moveMouse(
      Math.round(pos.x + dx * TRACKPAD_SENSITIVITY),
      Math.round(pos.y + dy * TRACKPAD_SENSITIVITY)
    );
  } catch (_) {}
}

// ── Trackpad click ───────────────────────────────────────────────────────────
function trackpadClick(button = 'left') {
  if (!available) return;
  try { robot.mouseClick(button); } catch (_) {}
}

module.exports = {
  init,
  gyroMouse,
  trackpadDelta,
  trackpadClick,
  isAvailable: () => available,
};
