'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

const root = path.resolve(__dirname, '..');

function testProfiles() {
  const profiles = require(path.join(root, 'profiles'));

  const xbox = profiles.translate('xbox', {
    x: true, y: true, a: true, b: true,
    lb: true, rb: true, lt: 1, rt: 0.5,
    start: true, back: true, guide: true,
    dpadUp: true, dpadDown: false, dpadLeft: true, dpadRight: false,
    lx: -1, ly: 1, rx: 0.25, ry: -0.25, ls: true, rs: true,
  });
  assert.equal(xbox.x, true);
  assert.equal(xbox.y, true);
  assert.equal(xbox.thumbL, true);
  assert.equal(xbox.thumbR, true);
  assert.equal(xbox.lt, 1);
  assert.equal(xbox.rt, 0.5);
  assert.equal(xbox.lx, -1);
  assert.equal(xbox.ry, -0.25);

  const dualSense = profiles.translate('dualSense', {
    cross: true, circle: true, square: true, triangle: true,
    l1: true, r1: true, l2: 1, r2: 0.75,
    options: true, create: true, ps: true, touchpad: true,
    dpadUp: true, dpadDown: false, dpadLeft: false, dpadRight: true,
    lx: -1, ly: 0.5, rx: 1, ry: -0.5, l3: true, r3: true,
  });
  assert.deepEqual(
    { a: dualSense.a, b: dualSense.b, x: dualSense.x, y: dualSense.y },
    { a: true, b: true, x: true, y: true }
  );
  assert.equal(dualSense.back, true);

  const wiimote = profiles.translate('wiimote', {
    a: true, b: true, one: true, two: true,
    minus: true, plus: true, home: true,
    dpadUp: true, dpadDown: false, dpadLeft: true, dpadRight: false,
    irX: 0.5, irY: -0.5, shakeDetected: true,
    nunchuk: { jx: 0.25, jy: -0.5, c: true, z: true },
  });
  assert.equal(wiimote.x, true);
  assert.equal(wiimote.y, true);
  assert.equal(wiimote.lb, true);
  assert.equal(wiimote.rb, true);
  assert.equal(wiimote.lt, 1);

  for (const [action, field] of Object.entries({ lb: 'lb', rb: 'rb', a: 'a', b: 'b', x: 'x', y: 'y', l3: 'thumbL', r3: 'thumbR' })) {
    const mapped = profiles.translate('wiimote', { shakeDetected: true, shakeAction: action });
    assert.equal(mapped[field], true, `shake must map to ${action}`);
  }
  const noShake = profiles.translate('wiimote', { shakeDetected: true, shakeAction: 'none' });
  assert.equal(noShake.lb, false);
  assert.equal(noShake.rb, false);

  const right = profiles.translate('joycon', {
    mode: 'right', a: true, b: true, x: true, y: true,
    r: true, zr: true, sr: true, sl: true, plus: true, home: true, rStick: true,
    rx: 1, ry: -1,
  });
  assert.equal(right.a, true);
  assert.equal(right.lb, true);
  assert.equal(right.lt, 1);
  assert.equal(right.rt, 1);
  assert.equal(right.thumbR, true);

  const left = profiles.translate('joycon', {
    mode: 'left', up: true, down: true, left: true, right: true,
    l: true, zl: true, sr: true, sl: true, minus: true, capture: true, lStick: true,
    lx: -1, ly: 1,
  });
  assert.equal(left.a, true);
  assert.equal(left.lb, true);
  assert.equal(left.rb, true);
  assert.equal(left.rt, 1);
  assert.equal(left.lt, 1);
  assert.equal(left.back, true);
  assert.equal(left.thumbL, true);

  const pair = profiles.translate('joycon', {
    mode: 'pair', a: true, b: true, x: true, y: true,
    l: true, zl: true, r: true, zr: true, plus: true, minus: true, home: true,
    up: true, down: true, left: true, right: true, lStick: true, rStick: true,
    lx: 0.5, ly: -0.5, rx: -0.25, ry: 0.25,
  });
  assert.equal(pair.a, true);
  assert.equal(pair.lb, true);
  assert.equal(pair.rb, true);
  assert.equal(pair.lt, 1);
  assert.equal(pair.rt, 1);
  assert.equal(pair.back, true);
  assert.equal(pair.thumbL, true);
  assert.equal(pair.thumbR, true);
}

function loadVigemWithFakeDriver() {
  const originalLoad = Module._load;
  const state = {
    created: 0,
    connected: 0,
    disconnected: 0,
    updates: 0,
    values: null,
  };

  class InputValue {
    constructor(name) { this.name = name; this.value = null; }
    setValue(value) { this.value = value; }
  }

  class FakeController {
    constructor() {
      this.updateMode = 'auto';
      this.button = Object.fromEntries([
        'LEFT_THUMB','RIGHT_THUMB','A','B','X','Y',
        'LEFT_SHOULDER','RIGHT_SHOULDER','START','BACK','GUIDE',
      ].map((name) => [name, new InputValue(name)]));
      this.axis = Object.fromEntries([
        'dpadHorz','dpadVert','leftTrigger','rightTrigger',
        'leftX','leftY','rightX','rightY',
      ].map((name) => [name, new InputValue(name)]));
      this.handlers = new Map();
      this.userIndex = 0;
    }
    on(event, fn) { this.handlers.set(event, fn); }
    connect() { state.connected++; return null; }
    disconnect() { state.disconnected++; return null; }
    resetInputs() {
      for (const x of Object.values(this.button)) x.value = false;
      for (const x of Object.values(this.axis)) x.value = 0;
    }
    update() {
      state.updates++;
      state.values = {
        buttons: Object.fromEntries(Object.entries(this.button).map(([k, v]) => [k, v.value])),
        axes: Object.fromEntries(Object.entries(this.axis).map(([k, v]) => [k, v.value])),
      };
      return null;
    }
  }

  class FakeClient {
    connect() { return null; }
    createX360Controller() { state.created++; return new FakeController(); }
    disconnect() {}
  }

  Module._load = function(request, parent, isMain) {
    if (request === 'vigemclient') return FakeClient;
    return originalLoad.call(this, request, parent, isMain);
  };

  delete require.cache[require.resolve(path.join(root, 'server/vigem.js'))];
  const vigem = require(path.join(root, 'server/vigem.js'));
  return {
    vigem,
    state,
    restore: () => { Module._load = originalLoad; },
  };
}

function testVigemMappingAndLifecycle() {
  const { vigem, state, restore } = loadVigemWithFakeDriver();
  try {
    assert.equal(vigem.init(), true);

  const slot = vigem.allocate('test-session');
  assert.ok(slot);
  assert.equal(slot.index, 1);

  vigem.update('test-session', {
    a: true, b: true, x: true, y: true,
    thumbL: true, thumbR: true,
    lb: true, rb: true, start: true, back: true, guide: true,
    dpadUp: true, dpadDown: false, dpadLeft: true, dpadRight: false,
    lt: 1, rt: 0.75,
    lx: -1, ly: 1, rx: 0.5, ry: -0.5,
  });

  assert.equal(state.values.buttons.X, true, 'X must reach ViGEm X');
  assert.equal(state.values.buttons.Y, true, 'Y must reach ViGEm Y');
  assert.equal(state.values.buttons.A, true);
  assert.equal(state.values.buttons.B, true);
  assert.equal(state.values.axes.leftTrigger, 1);
  assert.equal(state.values.axes.rightTrigger, 0.75);
  assert.equal(state.values.axes.leftX, -1);
  assert.equal(state.values.axes.leftY, 1);
  assert.equal(state.values.axes.rightX, 0.5);
  assert.equal(state.values.axes.rightY, -0.5);
  assert.equal(state.values.axes.dpadHorz, -1);
  assert.equal(state.values.axes.dpadVert, -1);

  vigem.release('test-session');
  assert.equal(vigem.getActiveCount(), 0);
  assert.equal(state.disconnected, 1);
  assert.equal(state.updates >= 2, true, 'release must reset and submit neutral state');
  } finally {
    restore();
  }
}

function testWebSocketLifecycle() {
  const EventEmitter = require('events');
  const originalLoad = Module._load;
  const originalSetInterval = global.setInterval;
  const originalClearInterval = global.clearInterval;
  const calls = { allocated: [], released: [], reset: [], hapticStart: 0, hapticStop: 0 };
  let heartbeat = null;
  let fakeServer = null;

  class FakeSocket extends EventEmitter {
    constructor(name) {
      super();
      this.name = name;
      this.readyState = 1;
      this.isAlive = true;
      this.sent = [];
    }
    send(value) { this.sent.push(value); }
    close(code, reason) { this.closeCode = code; this.closeReason = reason; this.readyState = 3; }
    terminate() { this.terminated = true; this.readyState = 3; }
    ping() { this.pinged = (this.pinged || 0) + 1; }
  }

  class FakeServer extends EventEmitter {
    constructor() {
      super();
      fakeServer = this;
      this.clients = new Set();
    }
    close() { this.closed = true; }
    emitConnection(socket, req) {
      this.clients.add(socket);
      this.emit('connection', socket, req);
    }
  }

  const fakeVigem = {
    allocate(id) {
      calls.allocated.push(id);
      return { index: 1 };
    },
    release(id) { calls.released.push(id); },
    reset(id) { calls.reset.push(id); },
    update() { return true; },
    getSlot() { return { index: 1 }; },
    getActiveCount() { return 1; },
  };
  const fakeHaptics = {
    start() { calls.hapticStart++; },
    stop() { calls.hapticStop++; },
  };

  global.setInterval = (fn) => { heartbeat = fn; return { fake: true }; };
  global.clearInterval = () => {};
  Module._load = function(request, parent, isMain) {
    if (request === 'ws') return { Server: FakeServer, OPEN: 1, CONNECTING: 0, CLOSED: 3 };
    if (request === './vigem') return fakeVigem;
    if (request === './haptics') return fakeHaptics;
    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    delete require.cache[require.resolve(path.join(root, 'server/websocket.js'))];
    const websocket = require(path.join(root, 'server/websocket.js'));
    websocket.init({});

    const first = new FakeSocket('first');
    fakeServer.emitConnection(first, { socket: { remoteAddress: '1.2.3.4', remotePort: 1000 } });
    assert.equal(first.closeCode, undefined, 'new socket must not close itself');
    assert.equal(calls.allocated.length, 0, 'controller allocation waits for valid init/profile');
    first.emit('message', JSON.stringify({ type: 'init', profile: 'xbox' }));
    assert.equal(calls.allocated.length, 1);
    assert.equal(calls.hapticStart, 1);
    assert.match(first.sent.at(-1), /"profile":"xbox"/);

    const second = new FakeSocket('second');
    fakeServer.emitConnection(second, { socket: { remoteAddress: '1.2.3.5', remotePort: 1001 } });
    assert.equal(second.closeCode, undefined, 'replacement connection must not close itself');
    assert.equal(calls.released.length, 1, 'new session must release old controller');
    assert.equal(calls.hapticStop, 1, 'new session must stop old haptics');
    assert.equal(first.closeCode, 4001, 'old session must be explicitly closed');
    assert.equal(calls.allocated.length, 1, 'replacement allocates only after its init');

    second.emit('message', JSON.stringify({ type: 'init', profile: 'dualSense' }));
    assert.equal(calls.allocated.length, 2);
    assert.equal(calls.hapticStart, 2);
    assert.match(second.sent.at(-1), /"profile":"dualSense"/);

    first.emit('close');
    assert.equal(calls.released.length, 1, 'old close must be idempotent after replacement');

    // Dead connection gets reaped. Healthy connection survives the first ping.
    second.isAlive = false;
    heartbeat();
    assert.equal(second.terminated, true, 'dead session must be terminated');
    assert.equal(calls.released.length, 2, 'heartbeat timeout must release controller');

    websocket.shutdown();
  } finally {
    Module._load = originalLoad;
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  }
}

function testClientCoverage() {
  const clientDir = path.join(root, 'client');
  const pages = [
    ['xbox.html', 'xbox'],
    ['dualsense.html', 'dualSense'],
    ['joycon.html', 'joycon'],
    ['wiimote.html', 'wiimote'],
  ];
  for (const [page, profile] of pages) {
    const text = fs.readFileSync(path.join(clientDir, page), 'utf8');
    assert.ok(text.includes('<script src="/ws.js"></script>'), `${page}: missing ws.js`);
    assert.ok(text.includes('<script src="/input.js"></script>'), `${page}: missing input.js`);
    assert.ok(text.includes(`'${profile}'`), `${page}: profile must be explicit`);
  }

  const xbox = fs.readFileSync(path.join(clientDir, 'xbox.html'), 'utf8');
  for (const key of ['x','y','a','b','lb','rb','lt','rt','start','back','guide']) {
    assert.ok(xbox.includes(`data-btn="${key}"`), `Xbox UI missing ${key}`);
  }
  assert.ok(xbox.includes('data-stick-click="ls"'));
  assert.ok(xbox.includes('data-stick-click="rs"'));
  assert.ok(!xbox.includes('data-btn="ls"'), 'Xbox L3 must be integrated into the stick');
  assert.ok(!xbox.includes('data-btn="rs"'), 'Xbox R3 must be integrated into the stick');
  assert.ok(xbox.includes("setupStick('sl','kl','lx','ly','ls')"));
  assert.ok(xbox.includes("setupStick('sr','kr','rx','ry','rs')"));

  const dualSense = fs.readFileSync(path.join(clientDir, 'dualsense.html'), 'utf8');
  for (const key of ['cross','circle','square','triangle','l1','r1','l2','r2','options','create','ps','touchpad']) {
    assert.ok(dualSense.includes(`data-btn="${key}"`), `DualSense UI missing ${key}`);
  }
  assert.ok(dualSense.includes('l3: false, r3: false'));
  assert.ok(dualSense.includes('data-stick-click="l3"'));
  assert.ok(dualSense.includes('data-stick-click="r3"'));
  assert.ok(!dualSense.includes('data-btn="l3"'), 'DualSense L3 must be integrated into the stick');
  assert.ok(!dualSense.includes('data-btn="r3"'), 'DualSense R3 must be integrated into the stick');
}

function testClientProfileRouting() {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(root, 'client', 'ws.js'), 'utf8');

  for (const [pathname, expected] of [
    ['/xbox.html', 'xbox'],
    ['/dualsense.html', 'dualSense'],
    ['/joycon.html', 'joycon'],
    ['/wiimote.html', 'wiimote'],
  ]) {
    const sent = [];
    const handlers = {};
    class FakeWebSocket {
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 3;
      constructor(url) {
        this.url = url;
        this.readyState = FakeWebSocket.OPEN;
        FakeWebSocket.last = this;
      }
      send(value) { sent.push(JSON.parse(value)); }
      close() { this.readyState = FakeWebSocket.CLOSED; }
    }

    const context = {
      WebSocket: FakeWebSocket,
      location: { hostname: '192.168.1.20', port: '8443', pathname },
      window: { addEventListener: (name, fn) => { handlers[name] = fn; } },
      setTimeout,
      clearTimeout,
      console,
    };
    vm.createContext(context);
    vm.runInContext(`${src}\nthis.__NullWS = NullWS;`, context, { filename: 'ws.js' });
    context.__NullWS.init(() => {}, () => {}, () => {});
    FakeWebSocket.last.onopen();
    assert.equal(sent[0].profile, expected, `${pathname}: wrong profile in websocket init`);
  }
}


function testJoyconButtonAliases() {
  const text = fs.readFileSync(path.join(root, 'client', 'joycon.html'), 'utf8');
  const aliases = {
    'sl-l': 'sl', 'sr-l': 'sr',
    'zl-p': 'zl', 'l-p': 'l',
    'up-p': 'up', 'down-p': 'down', 'left-p': 'left', 'right-p': 'right',
    'minus-p': 'minus', 'r-p': 'r', 'zr-p': 'zr',
    'x-p': 'x', 'y-p': 'y', 'a-p': 'a', 'b-p': 'b',
    'plus-p': 'plus', 'home-p': 'home',
  };
  assert.ok(text.includes('const BUTTON_KEY_MAP = Object.freeze({'));
  for (const [raw, canonical] of Object.entries(aliases)) {
    assert.ok(text.includes(`'${raw}': '${canonical}'`), `Joy-Con alias ${raw} missing`);
  }
}

function testIntegratedStickClicks() {
  const vm = require('vm');
  const src = fs.readFileSync(path.join(root, 'client', 'input.js'), 'utf8');

  class FakeElement {
    constructor() {
      this.listeners = new Map();
      this.classList = {
        values: new Set(),
        toggle: (name, on) => on ? this.classList.values.add(name) : this.classList.values.delete(name),
      };
      this.offsetWidth = 40;
    }
    addEventListener(name, fn) {
      const list = this.listeners.get(name) || [];
      list.push(fn);
      this.listeners.set(name, list);
    }
    dispatch(event) {
      for (const fn of this.listeners.get(event.type) || []) fn(event);
    }
    setPointerCapture() {}
    getBoundingClientRect() {
      return { left: 0, top: 0, width: 100, height: 100 };
    }
    style = {};
  }

  const context = { document: { querySelectorAll: () => [] } };
  vm.createContext(context);
  vm.runInContext(`${src}\nthis.__NullInput = NullInput;`, context, { filename: 'input.js' });

  const zone = new FakeElement();
  const knob = new FakeElement();
  const state = { x: 0, y: 0, l3: false };
  const changes = [];
  context.__NullInput.bindStick(zone, knob, state, 'x', 'y', () => changes.push({ ...state }), {
    clickKey: 'l3',
    clickRegion: 0.34,
    clickCancelDistance: 0.16,
  });

  const event = (type, x, y) => zone.dispatch({
    type, pointerId: 1, clientX: x, clientY: y,
  });

  event('pointerdown', 50, 50);
  assert.equal(state.l3, true, 'center stick press must activate L3');
  event('pointermove', 80, 50);
  assert.equal(state.l3, false, 'stick movement must cancel L3 click candidate');
  assert.ok(Math.abs(state.x) > 0.5, 'stick movement must still reach the axis');
  event('pointerup', 80, 50);
  assert.deepEqual(state, { x: 0, y: 0, l3: false });

  event('pointerdown', 50, 50);
  event('pointerup', 50, 50);
  assert.equal(state.l3, false, 'tap must end with L3 released');
  assert.ok(changes.some((x) => x.l3 === true), 'tap must emit an L3 press state');
}

function testLifecycleContracts() {
  const vigemText = fs.readFileSync(path.join(root, 'server', 'vigem.js'), 'utf8');
  const wsText = fs.readFileSync(path.join(root, 'server', 'websocket.js'), 'utf8');
  const clientText = fs.readFileSync(path.join(root, 'client', 'ws.js'), 'utf8');

  assert.ok(vigemText.includes('function releaseAll()'));
  assert.ok(vigemText.includes('function shutdown()'));
  assert.ok(wsText.includes('function replaceExistingSessions(except = null)'));
  assert.ok(wsText.includes('function cleanup(ws, reason)'));
  assert.ok(wsText.includes('ws.ping()'));
  assert.ok(wsText.includes('function shutdown()'));
  assert.ok(clientText.includes("window.addEventListener('pagehide'"));
  assert.ok(clientText.includes("window.addEventListener('pageshow'"));
  assert.ok(clientText.includes("type: 'disconnect'"));
  assert.ok(clientText.includes('if (!closing) retryTimer = setTimeout(connect, RECONNECT_MS);'));
  assert.ok(clientText.includes('profileFromPath'));
  assert.ok(wsText.includes('replaceExistingSessions(ws)'));
  assert.ok(wsText.includes('if (existing === except) continue;'));
  assert.ok(clientText.includes('initialProfile'));
  assert.ok(fs.readFileSync(path.join(root, 'client', 'input.js'), 'utf8').includes('clickCancelDistance'));

}

function main() {
  testProfiles();
  testVigemMappingAndLifecycle();
  testClientCoverage();
  testClientProfileRouting();
  testIntegratedStickClicks();
  testJoyconButtonAliases();
  testLifecycleContracts();
  testWebSocketLifecycle();
  console.log('NULLPAD smoke tests: PASS');
}

try {
  main();
} catch (error) {
  console.error('NULLPAD smoke tests: FAIL');
  console.error(error.stack || error);
  process.exit(1);
}
