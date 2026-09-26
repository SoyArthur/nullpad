/**
 * NULLPAD — DualSense (PS5) Profile
 * Maps DualSense client state → normalized XInput state.
 *
 * Client raw state shape:
 * {
 *   cross: bool, circle: bool, square: bool, triangle: bool,
 *   l1: bool, r1: bool,
 *   l2: float [0..1], r2: float [0..1],
 *   l3: bool, r3: bool,
 *   options: bool, create: bool, ps: bool,
 *   touchpad: bool,   // touchpad click
 *   dpadUp: bool, dpadDown: bool, dpadLeft: bool, dpadRight: bool,
 *   lx: float, ly: float,   // left stick [-1..1]
 *   rx: float, ry: float,   // right stick [-1..1]
 *   // Gyro (DeviceOrientation) — optional, if game uses it
 *   gyroX: float, gyroY: float,
 *   // Touchpad swipe — mapped to right stick delta when no physical stick used
 *   touchDx: float, touchDy: float,
 * }
 *
 * XInput mapping:
 *   Cross    → A      Square   → X
 *   Circle   → B      Triangle → Y
 *   L1 → LB  R1 → RB
 *   L2 → LT  R2 → RT
 *   L3 → ThumbL  R3 → ThumbR
 *   Options → Start   Create → Back   PS → Guide
 *   Touchpad click → Back (alternate)
 */

'use strict';

function translate(raw) {
  return {
    // Face
    a: !!raw.cross,
    b: !!raw.circle,
    x: !!raw.square,
    y: !!raw.triangle,

    // System
    start:  !!raw.options,
    back:   !!(raw.create || raw.touchpad),
    guide:  !!raw.ps,

    // D-Pad
    dpadUp:    !!raw.dpadUp,
    dpadDown:  !!raw.dpadDown,
    dpadLeft:  !!raw.dpadLeft,
    dpadRight: !!raw.dpadRight,

    // Shoulders
    lb: !!raw.l1,
    rb: !!raw.r1,

    // Triggers [0..1]
    lt: clamp01(raw.l2 || 0),
    rt: clamp01(raw.r2 || 0),

    // Sticks
    lx: clamp(raw.lx || 0),
    ly: clamp(raw.ly || 0),
    rx: clamp(raw.rx || 0),
    ry: clamp(raw.ry || 0),

    // Thumb clicks
    thumbL: !!raw.l3,
    thumbR: !!raw.r3,
  };
}

function clamp(v)   { return Math.max(-1,  Math.min(1,  v)); }
function clamp01(v) { return Math.max(0,   Math.min(1,  v)); }

module.exports = { translate };
