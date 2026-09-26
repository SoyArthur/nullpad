'use strict';
const assert = require('assert');
const dgram = require('dgram');

process.env.NULLPAD_DSU_PORT = '26761';
process.env.NULLPAD_DSU_HOST = '127.0.0.1';

const dsu = require('../server/dsu');

function requestPacket(type, payload = Buffer.alloc(0)) {
  const buf = Buffer.alloc(20 + payload.length);
  Buffer.from('DSUC', 'ascii').copy(buf, 0);
  buf.writeUInt16LE(1001, 4);
  buf.writeUInt16LE(4 + payload.length, 6);
  buf.writeUInt32LE(0, 8);
  buf.writeUInt32LE(0x12345678, 12);
  buf.writeUInt32LE(type >>> 0, 16);
  payload.copy(buf, 20);
  buf.writeUInt32LE(dsu.crc32(buf), 8);
  return buf;
}

function waitForMessage(socket, timeout = 1500) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('UDP response timeout')), timeout);
    socket.once('message', (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
  });
}

(async () => {
  let haptic = null;
  const state = {
    a: true, b: false, one: true, two: false,
    plus: true, minus: false, home: true,
    dpadUp: true, dpadDown: false, dpadLeft: false, dpadRight: true,
    irX: 0.25, irY: -0.5,
    nunchuk: { jx: 0.4, jy: -0.2, c: true, z: true },
    motion: {
      accelX: 0,
      accelY: 9.80665,
      accelZ: 0,
      gyroPitch: 1.25,
      gyroYaw: -2.5,
      gyroRoll: 3.75,
      gyroAvailable: true,
      timestampUs: 123456789,
    },
  };

  assert.strictEqual(dsu.buildVersionPacket().length, 22);
  assert.strictEqual(dsu.buildControllerInfoPacket(0).length, 32);
  const data = dsu.buildControllerDataPacket(state, 42);
  assert.strictEqual(data.length, 100);
  const neutral = dsu.buildControllerDataPacket({ a:false, motion:null }, 43);
  assert.strictEqual(neutral.readUInt8(40), 128);
  assert.strictEqual(neutral.readUInt8(41), 128);
  assert.strictEqual(neutral.readUInt8(42), 128);
  assert.strictEqual(neutral.readUInt8(43), 128);
  const dataCrc = data.readUInt32LE(8);
  const dataCopy = Buffer.from(data);
  dataCopy.writeUInt32LE(0, 8);
  assert.strictEqual(dsu.crc32(dataCopy), dataCrc);
  assert.strictEqual(data.readUInt32LE(32), 42);
  assert(Math.abs(data.readFloatLE(80) - 1) < 1e-6); // accel Y = 1g
  assert(Math.abs(data.readFloatLE(88) - 1.25) < 1e-6);
  assert(Math.abs(data.readFloatLE(92) + 2.5) < 1e-6);
  assert(Math.abs(data.readFloatLE(96) - 3.75) < 1e-6);

  const serverReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DSU bind timeout')), 1500);
    const original = console.log;
    const handler = (...args) => {
      original(...args);
      if (String(args[0]).includes('[DSU] Motion server listening')) {
        clearTimeout(timer);
        console.log = original;
        resolve();
      }
    };
    console.log = handler;
    dsu.start(() => state, (v) => { haptic = v; });
  });
  await serverReady;

  const client = dgram.createSocket('udp4');
  await new Promise((resolve) => client.bind(0, '127.0.0.1', resolve));
  const port = client.address().port;

  const send = (packet) => new Promise((resolve, reject) => {
    client.send(packet, 0, packet.length, 26761, '127.0.0.1', (err) => err ? reject(err) : resolve());
  });

  await send(requestPacket(0x100000));
  const versionResponse = await waitForMessage(client);
  assert.strictEqual(versionResponse.readUInt32LE(16), 0x100000);
  assert.strictEqual(versionResponse.readUInt16LE(20), 1001);

  const infoPayload = Buffer.from([1, 0]); // request one slot: 0
  await send(requestPacket(0x100001, Buffer.concat([Buffer.from([1,0,0,0]), infoPayload])));
  const infoResponse = await waitForMessage(client);
  assert.strictEqual(infoResponse.length, 32);
  assert.strictEqual(infoResponse.readUInt8(21), 2); // sourceGetter currently exposes an active motion state

  // Data subscription, no need to wait for a second response because the server sends immediately.
  await send(requestPacket(0x100002, Buffer.from([1, 0, 0, 0, 0, 0, 0, 0])));
  const dataResponse = await waitForMessage(client);
  assert.strictEqual(dataResponse.length, 100);

  // Motor packet exercises DSU rumble fallback.
  const motorPayload = Buffer.alloc(10);
  motorPayload.writeUInt8(0, 8);
  motorPayload.writeUInt8(200, 9);
  await send(requestPacket(0x110002, motorPayload));
  await new Promise((r) => setTimeout(r, 30));
  assert.deepStrictEqual(haptic, { large: 200, small: 0 });

  client.close();
  dsu.stop();
  console.log('DSU SMOKE TEST: PASS');
})().catch((error) => {
  try { dsu.stop(); } catch (_) {}
  console.error('DSU SMOKE TEST: FAIL');
  console.error(error.stack || error);
  process.exit(1);
});
