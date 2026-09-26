'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const handlers = {};
const context = {
  console,
  Date,
  Math,
  Number,
  Promise,
  setTimeout,
  clearTimeout,
  performance: { now: () => 1000 },
  document: {
    readyState: 'complete',
    getElementById: () => null,
    addEventListener: () => {},
    createElement: () => ({ style: {}, addEventListener: () => {}, setAttribute: () => {}, appendChild: () => {}, querySelector: () => null }),
    body: { appendChild: () => {} },
  },
  navigator: { vibrate: () => true },
  window: {
    addEventListener: (name, fn) => { handlers[name] = fn; },
  },
};
class DeviceMotionEvent {}
DeviceMotionEvent.requestPermission = async () => 'granted';
class DeviceOrientationEvent {}
DeviceOrientationEvent.requestPermission = async () => 'granted';
context.DeviceMotionEvent = DeviceMotionEvent;
context.DeviceOrientationEvent = DeviceOrientationEvent;
vm.createContext(context);
vm.runInContext(fs.readFileSync(require.resolve('../client/sensors.js')), context, { filename: 'sensors.js' });

(async () => {
  assert.strictEqual(await vm.runInContext('NullSensors.init(() => {})', context), true);
  assert(handlers.deviceorientation);
  assert(handlers.devicemotion);

  const orientation = { beta: 0, gamma: 0 };
  handlers.deviceorientation(orientation);
  handlers.devicemotion({
    accelerationIncludingGravity: { x: 0, y: 9.80665, z: 0 },
    rotationRate: { alpha: 1, beta: 2, gamma: 3 },
    interval: 16,
  });

  const state = vm.runInContext('NullSensors.getState()', context);
  assert(state.motion.accelAvailable);
  assert(state.motion.gyroAvailable);
  assert.strictEqual(state.motion.gyroPitch, 2);
  assert.strictEqual(state.motion.gyroYaw, 1);
  assert.strictEqual(state.motion.gyroRoll, 3);

  const before = vm.runInContext('NullSensors.getConfig()', context);
  assert.strictEqual(before.shakeAction, 'lb');
  vm.runInContext("NullSensors.setConfig({ motionEnabled: true, tiltPointerEnabled: false, tiltSensitivity: 1.5, shakeEnabled: true, shakeAction: 'r3' })", context);
  const after = vm.runInContext('NullSensors.getConfig()', context);
  assert.strictEqual(after.tiltPointerEnabled, false);
  assert.strictEqual(after.tiltSensitivity, 1.5);
  assert.strictEqual(after.shakeAction, 'r3');
  const rumble = vm.runInContext('NullSensors.testRumble()', context);
  assert.strictEqual(rumble, true);
  vm.runInContext("NullSensors.setConfig({ motionEnabled: false, tiltPointerEnabled: false, shakeEnabled: false, shakeAction: 'none', tiltSensitivity: 1 })", context);
  const disabled = vm.runInContext('NullSensors.getState()', context);
  assert.strictEqual(disabled.motion.gyroAvailable, false);
  assert.strictEqual(disabled.motion.accelAvailable, false);
  assert.strictEqual(disabled.irX, 0);
  assert.strictEqual(disabled.irY, 0);

  console.log('SENSOR SMOKE TEST: PASS');
})().catch((error) => {
  console.error('SENSOR SMOKE TEST: FAIL');
  console.error(error.stack || error);
  process.exit(1);
});
