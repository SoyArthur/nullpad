/**
 * NULLPAD — Profile Router
 * Single delegation point: translate(profileName, rawState) → normalizedState
 */

'use strict';

const loaders = {
  wiimote:   () => require('./wiimote'),
  dualSense: () => require('./dualSense'),
  xbox:      () => require('./xbox'),
  joycon:    () => require('./joycon'),
};

// Cache loaded modules
const cache = {};

function getProfile(name) {
  if (!loaders[name]) throw new Error(`Unknown profile: ${name}`);
  if (!cache[name]) cache[name] = loaders[name]();
  return cache[name];
}

function translate(profileName, rawState) {
  return getProfile(profileName).translate(rawState);
}

module.exports = { translate, getProfile };
