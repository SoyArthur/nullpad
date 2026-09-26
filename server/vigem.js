/**
 * NULLPAD — ViGEm Controller Manager
 * Owns the single virtual Xbox 360 controller exposed by NULLPAD.
 *
 * A mobile connection maps to exactly one ViGEm target. The target is reset
 * before release so no stuck input survives a disconnect or profile switch.
 */
'use strict';

const cfg = require('../config');

let ViGEmClient = null;
let client = null;
let available = false;

// socketId -> { controller, index, userIndex, rumble }
const slots = new Map();

function init() {
  if (available && client) return true;

  try {
    ViGEmClient = require('vigemclient');
    if (typeof ViGEmClient !== 'function') {
      throw new Error('vigemclient loaded, but did not export ViGEmClient');
    }

    client = new ViGEmClient();
    const err = client.connect();
    if (err) throw err;

    available = true;
    console.log('[ViGEm] Connected to ViGEmBus driver ✅');
    return true;
  } catch (e) {
    available = false;
    client = null;
    console.error('[ViGEm] Native initialization failed.');
    console.error(`[ViGEm] ${e && e.message ? e.message : e}`);
    console.error('[ViGEm] Run install.bat and install "Desktop development with C++" when prompted.');
    return false;
  }
}

function allocate(socketId) {
  if (!available || !client) return null;
  if (slots.has(socketId)) return slots.get(socketId);
  if (slots.size >= cfg.MAX_CONTROLLERS) {
    console.warn(`[ViGEm] Max controllers (${cfg.MAX_CONTROLLERS}) reached`);
    return null;
  }

  let controller = null;
  try {
    controller = client.createX360Controller();
    controller.updateMode = 'manual';

    const err = controller.connect();
    if (err) throw err;

    // ViGEm reports the XInput user index through feedback callbacks. It may
    // not be available immediately, so expose both the physical/user index
    // when known and a stable fallback slot of 1.
    let userIndex = null;
    try {
      if (Number.isInteger(controller.userIndex)) userIndex = controller.userIndex;
    } catch (_) {}

    const index = userIndex === null ? 1 : userIndex + 1;
    const slot = {
      controller,
      index,
      userIndex,
      rumble: { large: 0, small: 0 },
    };

    controller.on('vibration', (rumble) => {
      slot.rumble = {
        large: Number(rumble?.large) || 0,
        small: Number(rumble?.small) || 0,
      };
    });

    // Some ViGEm versions only populate userIndex after the first feedback
    // callback. Update the advertised slot whenever that callback arrives.
    controller.on('notification', (notification) => {
      const led = Number(notification?.LedNumber);
      if (Number.isInteger(led) && led >= 0) {
        slot.userIndex = led;
        slot.index = led + 1;
      }
    });

    slots.set(socketId, slot);
    console.log(`[ViGEm] Controller ${slot.index} allocated for ${socketId}`);
    return slot;
  } catch (e) {
    if (controller) {
      try { controller.resetInputs(); } catch (_) {}
      try { controller.disconnect(); } catch (_) {}
    }
    console.error('[ViGEm] Failed to allocate controller:', e.message || e);
    return null;
  }
}

function reset(socketId) {
  const slot = slots.get(socketId);
  if (!slot?.controller) return;
  try {
    slot.controller.resetInputs();
    const err = slot.controller.update();
    if (err) throw err;
  } catch (e) {
    console.warn(`[ViGEm] Reset failed for ${socketId}:`, e.message || e);
  }
}

function release(socketId) {
  const slot = slots.get(socketId);
  if (!slot) return;

  // Remove first so late messages can never update a controller that is being
  // torn down.
  slots.delete(socketId);

  try { slot.controller.resetInputs(); } catch (_) {}
  try {
    const err = slot.controller.update();
    if (err) throw err;
  } catch (_) {}
  try { slot.controller.disconnect(); } catch (e) {
    console.warn(`[ViGEm] Error disconnecting controller ${slot.index}:`, e.message || e);
  }

  console.log(`[ViGEm] Controller ${slot.index} released`);
}

function releaseAll() {
  for (const socketId of [...slots.keys()]) release(socketId);
}

function shutdown() {
  releaseAll();
  if (client) {
    try { client.disconnect(); } catch (_) {}
  }
  client = null;
  available = false;
}

function update(socketId, state) {
  const slot = slots.get(socketId);
  if (!slot || !available) return false;

  const c = slot.controller;

  try {
    // Buttons — names are part of the official node-vigemclient X360 API.
    c.button.LEFT_THUMB.setValue(!!state.thumbL);
    c.button.RIGHT_THUMB.setValue(!!state.thumbR);
    c.button.A.setValue(!!state.a);
    c.button.B.setValue(!!state.b);
    c.button.X.setValue(!!state.x);
    c.button.Y.setValue(!!state.y);
    c.button.LEFT_SHOULDER.setValue(!!state.lb);
    c.button.RIGHT_SHOULDER.setValue(!!state.rb);
    c.button.START.setValue(!!state.start);
    c.button.BACK.setValue(!!state.back);
    c.button.GUIDE.setValue(!!state.guide);

    // D-pad is exposed as two POV axes. Positive/negative values represent
    // the four directions; diagonals are valid because both axes can move.
    const dpadH = state.dpadRight ? 1 : state.dpadLeft ? -1 : 0;
    const dpadV = state.dpadDown ? 1 : state.dpadUp ? -1 : 0;
    c.axis.dpadHorz.setValue(dpadH);
    c.axis.dpadVert.setValue(dpadV);

    c.axis.leftTrigger.setValue(clamp01(state.lt));
    c.axis.rightTrigger.setValue(clamp01(state.rt));
    c.axis.leftX.setValue(clampNorm(state.lx));
    c.axis.leftY.setValue(clampNorm(state.ly));
    c.axis.rightX.setValue(clampNorm(state.rx));
    c.axis.rightY.setValue(clampNorm(state.ry));

    const err = c.update();
    if (err) throw err;
    return true;
  } catch (e) {
    console.error(`[ViGEm] Controller update failed for ${socketId}:`, e.message || e);
    return false;
  }
}

function getRumble(socketId) {
  const slot = slots.get(socketId);
  return slot ? slot.rumble : { large: 0, small: 0 };
}

function getActiveCount() {
  return slots.size;
}

function getSlot(socketId) {
  return slots.get(socketId) || null;
}

function clampNorm(value) {
  const n = Number(value) || 0;
  return Math.max(-1, Math.min(1, n));
}

function clamp01(value) {
  const n = Number(value) || 0;
  return Math.max(0, Math.min(1, n));
}

module.exports = {
  init,
  allocate,
  reset,
  update,
  release,
  releaseAll,
  shutdown,
  getRumble,
  getActiveCount,
  getSlot,
  isAvailable: () => available,
};
