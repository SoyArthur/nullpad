'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const layout = fs.readFileSync(path.join(root, 'client/layout.js'), 'utf8');

for (const page of ['xbox.html', 'dualsense.html', 'joycon.html', 'wiimote.html']) {
  const html = fs.readFileSync(path.join(root, 'client', page), 'utf8');
  assert(html.includes('/layout.js'), `${page} must load layout.js`);
  assert(/data-btn=|data-stick-click=/.test(html), `${page} must expose editable HUD controls`);
}

assert(layout.includes('nullpad-layout-button'), 'HUD editor button missing');
assert(layout.includes('nullpad-layout-minus'), 'HUD minus control missing');
assert(layout.includes('nullpad-layout-plus'), 'HUD plus control missing');
assert(layout.includes('nullpad-layout-reset'), 'HUD reset control missing');
assert(layout.includes('nullpad-layout-classic'), 'HUD classic reset missing');
assert(layout.includes('pointerdown'), 'HUD pointerdown handler missing');
assert(layout.includes('pointermove'), 'HUD pointermove handler missing');
assert(layout.includes('pointerup'), 'HUD pointerup handler missing');
assert(layout.includes('pointercancel'), 'HUD pointercancel handler missing');
assert(layout.includes('setPointerCapture'), 'HUD pointer capture missing');
assert(layout.includes("mode: 'pinch'"), 'HUD pinch mode missing');
assert(layout.includes('startDistance'), 'HUD pinch start distance missing');
assert(layout.includes('gesture.startScale'), 'HUD pinch scale state missing');
assert(layout.includes('localStorage'), 'HUD persistence missing');
assert(layout.includes('touch-action: none !important'), 'HUD must disable browser touch gestures while editing');
assert(layout.includes('MIN_SCALE = 0.40'), 'HUD min scale guard missing');
assert(layout.includes('MAX_SCALE = 3.50'), 'HUD max scale guard missing');
assert(layout.includes('clamp01'), 'HUD viewport normalization guard missing');

console.log('HUD STATIC SMOKE TEST: PASS');
