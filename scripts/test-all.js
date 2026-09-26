'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const root = path.resolve(__dirname, '..');
const tests = [
  'scripts/smoke-test.js',
  'scripts/hud-smoke-test.js',
  'scripts/hud-runtime-test.js',
  'scripts/sensor-smoke-test.js',
  'scripts/dsu-smoke-test.js',
  'scripts/haptics-smoke-test.js',
];

for (const test of tests) {
  const result = spawnSync(process.execPath, [path.join(root, test)], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status || 1);
}

console.log('NULLPAD ALL TESTS: PASS');
