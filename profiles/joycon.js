/**
 * NULLPAD — Joy-Con Profile (horizontal single, Right hand default)
 * Maps Joy-Con client state → normalized XInput state.
 *
 * Supports two orientations:
 *   - 'right' : Right Joy-Con held horizontally (default)
 *   - 'left'  : Left Joy-Con held horizontally
 *   - 'pair'  : Both Joy-Cons as one controller
 *
 * Client raw state shape (pair mode):
 * {
 *   mode: 'right'|'left'|'pair',
 *   // Right Joy-Con buttons
 *   a: bool, b: bool, x: bool, y: bool,
 *   r: bool, zr: bool, sr: bool, sl: bool,
 *   plus: bool, rStick: bool,
 *   rx: float, ry: float,
 *   // Left Joy-Con buttons
 *   up: bool, down: bool, left: bool, right: bool,
 *   l: bool, zl: bool,
 *   minus: bool, lStick: bool,
 *   lx: float, ly: float,
 *   // Shared
 *   home: bool, capture: bool,
 *   // Gyro
 *   gyroX: float, gyroY: float, gyroZ: float,
 * }
 *
 * Horizontal single Right Joy-Con:
 *   A(right)→ A  B(bottom)→ B  X(top)→ X  Y(left)→ Y
 *   R → RB   ZR → RT   SR → LB   SL → LT
 *   + → Start   Home → Guide   Stick → RS
 *
 * Horizontal single Left Joy-Con:
 *   Down→ A  Right→ B  Up→ X  Left→ Y
 *   L → LB   ZL → LT   SL → RB   SR → RT
 *   − → Back   Capture → Back   Stick → LS
 */

'use strict';

function translate(raw) {
  const mode = raw.mode || 'pair';

  if (mode === 'right') return translateRight(raw);
  if (mode === 'left')  return translateLeft(raw);
  return translatePair(raw);
}

function translateRight(r) {
  return {
    a: !!r.a, b: !!r.b, x: !!r.x, y: !!r.y,
    lb: !!r.sr, rb: !!r.r,
    lt: clamp01(r.sl ? 1 : 0), rt: clamp01(r.zr ? 1 : 0),
    start: !!r.plus,  back: false, guide: !!r.home,
    dpadUp: false, dpadDown: false, dpadLeft: false, dpadRight: false,
    lx: 0, ly: 0,
    rx: clamp(r.rx || 0), ry: clamp(r.ry || 0),
    thumbL: false, thumbR: !!r.rStick,
  };
}

function translateLeft(r) {
  return {
    a: !!r.down, b: !!r.right, x: !!r.up, y: !!r.left,
    lb: !!r.l,  rb: !!r.sl,
    lt: clamp01(r.zl ? 1 : 0), rt: clamp01(r.sr ? 1 : 0),
    start: false, back: !!(r.minus || r.capture), guide: false,
    dpadUp: false, dpadDown: false, dpadLeft: false, dpadRight: false,
    lx: clamp(r.lx || 0), ly: clamp(r.ly || 0),
    rx: 0, ry: 0,
    thumbL: !!r.lStick, thumbR: false,
  };
}

function translatePair(r) {
  return {
    a: !!r.a, b: !!r.b, x: !!r.x, y: !!r.y,
    lb: !!r.l,   rb: !!r.r,
    lt: clamp01(r.zl ? 1 : 0),
    rt: clamp01(r.zr ? 1 : 0),
    start: !!r.plus, back: !!(r.minus || r.capture), guide: !!r.home,
    dpadUp:    !!r.up,
    dpadDown:  !!r.down,
    dpadLeft:  !!r.left,
    dpadRight: !!r.right,
    lx: clamp(r.lx || 0), ly: clamp(r.ly || 0),
    rx: clamp(r.rx || 0), ry: clamp(r.ry || 0),
    thumbL: !!r.lStick, thumbR: !!r.rStick,
  };
}

function clamp(v)   { return Math.max(-1,  Math.min(1,  v)); }
function clamp01(v) { return Math.max(0,   Math.min(1,  v)); }

module.exports = { translate };
