/**
 * NULLPAD — Xbox Controller Profile
 * Maps Xbox client state → normalized XInput state (near 1:1).
 *
 * Client raw state shape:
 * {
 *   a: bool, b: bool, x: bool, y: bool,
 *   lb: bool, rb: bool,
 *   lt: float [0..1], rt: float [0..1],
 *   ls: bool, rs: bool,           // stick clicks
 *   start: bool, back: bool, guide: bool,
 *   dpadUp: bool, dpadDown: bool, dpadLeft: bool, dpadRight: bool,
 *   lx: float, ly: float,
 *   rx: float, ry: float,
 * }
 */

'use strict';

function translate(raw) {
  return {
    a: !!raw.a,
    b: !!raw.b,
    x: !!raw.x,
    y: !!raw.y,

    start: !!raw.start,
    back:  !!raw.back,
    guide: !!raw.guide,

    dpadUp:    !!raw.dpadUp,
    dpadDown:  !!raw.dpadDown,
    dpadLeft:  !!raw.dpadLeft,
    dpadRight: !!raw.dpadRight,

    lb: !!raw.lb,
    rb: !!raw.rb,

    lt: clamp01(raw.lt || 0),
    rt: clamp01(raw.rt || 0),

    lx: clamp(raw.lx || 0),
    ly: clamp(raw.ly || 0),
    rx: clamp(raw.rx || 0),
    ry: clamp(raw.ry || 0),

    thumbL: !!raw.ls,
    thumbR: !!raw.rs,
  };
}

function clamp(v)   { return Math.max(-1,  Math.min(1,  v)); }
function clamp01(v) { return Math.max(0,   Math.min(1,  v)); }

module.exports = { translate };
