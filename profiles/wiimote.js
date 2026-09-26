/**
 * NULLPAD — Wiimote Profile
 * Maps Wiimote/Nunchuk controls to the single ViGEm X360 target.
 *
 * Motion is deliberately NOT forced into XInput. It remains available in the
 * normalized state so the DSU/Cemuhook server can expose real 3-axis motion to
 * Cemu. IR remains an XInput right-stick proxy for ordinary pointer-like use.
 */
'use strict';

function translate(raw) {
  const n = raw.nunchuk || {};

  const shakeAction = typeof raw.shakeAction === 'string' ? raw.shakeAction : 'lb';
  const shake = !!raw.shakeDetected;

  return {
    a: !!raw.a || (shake && shakeAction === 'a'),
    b: !!raw.b || (shake && shakeAction === 'b'),
    x: !!raw.one || (shake && shakeAction === 'x'),
    y: !!raw.two || (shake && shakeAction === 'y'),
    start: !!raw.plus,
    back: !!raw.minus,
    guide: !!raw.home,
    dpadUp: !!raw.dpadUp,
    dpadDown: !!raw.dpadDown,
    dpadLeft: !!raw.dpadLeft,
    dpadRight: !!raw.dpadRight,
    lb: !!raw.lb || (shake && shakeAction === 'lb'),
    rb: !!n.c || (shake && shakeAction === 'rb'),
    lt: n.z ? 1 : 0,
    rt: 0,
    lx: clamp(n.jx || 0),
    ly: clamp(-(n.jy || 0)),
    rx: clamp(raw.irX || 0),
    ry: clamp(-(raw.irY || 0)),
    thumbL: shake && shakeAction === 'l3',
    thumbR: shake && shakeAction === 'r3',
  };
}

function clamp(v) {
  return Math.max(-1, Math.min(1, Number(v) || 0));
}

module.exports = { translate };
