'use strict';

const assert = require('assert');
const Module = require('module');

const originalLoad = Module._load;
const originalSetInterval = global.setInterval;
const originalClearInterval = global.clearInterval;
let tick = null;
let cleared = false;
const rumble = { large: 180, small: 60 };
let sent = [];

const fakeCfg = { HAPTICS: { POLL_MS: 16 } };
const fakeVigem = { getRumble: () => ({ ...rumble }) };
Module._load = function(request, parent, isMain) {
  if (request === '../config' || request.endsWith('/config')) return fakeCfg;
  if (request === './vigem' || request.endsWith('/server/vigem')) return fakeVigem;
  return originalLoad.call(this, request, parent, isMain);
};
global.setInterval = (fn) => { tick = fn; return { id: 1 }; };
global.clearInterval = () => { cleared = true; };

delete require.cache[require.resolve('../server/haptics')];
const haptics = require('../server/haptics');

try {
  haptics.start('s1', (message) => sent.push(message));
  assert(tick, 'haptics poll interval must be created');
  tick();
  assert.deepStrictEqual(sent[0], { type: 'haptic', pattern: [146] });
  tick();
  assert.strictEqual(sent.length, 1, 'unchanged rumble must not be resent every tick');
  rumble.large = 0;
  rumble.small = 0;
  tick();
  assert.deepStrictEqual(sent.at(-1), { type: 'haptic', pattern: [0] });
  haptics.stop('s1');
  assert.strictEqual(cleared, true, 'haptics interval must be cleared');
  assert.deepStrictEqual(sent.at(-1), { type: 'haptic', pattern: [0] });
  console.log('HAPTICS SMOKE TEST: PASS');
} finally {
  Module._load = originalLoad;
  global.setInterval = originalSetInterval;
  global.clearInterval = originalClearInterval;
  haptics.stop('s1');
}
