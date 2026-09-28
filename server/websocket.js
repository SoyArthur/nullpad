/**
 * NULLPAD — WebSocket Handler
 *
 * There is intentionally only one active mobile controller session. A new
 * connection replaces the previous session and releases its ViGEm target.
 * Broken/idle sockets are reaped by protocol-level ping/pong heartbeats.
 */
'use strict';

const WebSocket = require('ws');
const cfg       = require('../config');
const vigem     = require('./vigem');
const haptics   = require('./haptics');
const profiles  = require('../profiles');
const mouse     = require('./mouse');

let wss = null;
let heartbeatTimer = null;
let activeSocket = null;
const HEARTBEAT_MS = 10000;

function init(httpsServer) {
  wss = new WebSocket.Server({ server: httpsServer });
  console.log('[WS] WebSocket server attached to HTTPS');

  wss.on('connection', (ws, req) => {
    const id = `${req.socket.remoteAddress}:${req.socket.remotePort}`;
    ws._nullpadId = id;
    ws._profile = null;
    ws._state = null;
    ws._cleaned = false;
    ws.isAlive = true;

    replaceExistingSessions(ws);

    console.log(`[WS] Client connected: ${id}`);

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      if (ws._cleaned) return;

      let msg;
      try { msg = JSON.parse(raw); }
      catch { return; }

      switch (msg.type) {
        case 'init': {
          const p = msg.profile;
          if (!cfg.PROFILES.includes(p)) {
            send(ws, { type: 'error', msg: `Unknown profile: ${p}` });
            return;
          }

          if (!ws._profile) {
            const slot = vigem.allocate(id);
            if (!slot) {
              send(ws, { type: 'error', msg: 'Controller unavailable' });
              safeClose(ws, 1013, 'Controller unavailable');
              return;
            }
            ws._profile = p;
            ws._state = null;
            activeSocket = ws;
            haptics.start(id, (msg) => send(ws, msg));
            console.log(`[WS] ${id} → profile: ${p}`);
            send(ws, { type: 'ready', slot: slot.index, profile: p });
            break;
          }

          if (p !== ws._profile) {
            vigem.reset(id);
            ws._profile = p;
          }
          console.log(`[WS] ${id} → profile: ${p}`);
          send(ws, { type: 'ready', slot: vigem.getSlot(id)?.index || 1, profile: p });
          break;
        }

        case 'input': {
          if (!ws._profile || !msg.state) return;
          try {
            ws._state = msg.state && typeof msg.state === 'object' ? structuredCloneSafe(msg.state) : null;
            const normalized = profiles.translate(ws._profile, msg.state);
            vigem.update(id, normalized);
          } catch (e) {
            console.error(`[WS] Input error for ${id}:`, e.message || e);
          }
          break;
        }

        // ── Gyro mouse: phone gyro → PC cursor movement ───────────────────
        case 'gyro-mouse': {
          if (typeof msg.dx === 'number' && typeof msg.dy === 'number') {
            mouse.gyroMouse(msg.dx, msg.dy);
          }
          break;
        }

        // ── Trackpad: touchpad swipe → PC cursor movement ─────────────────
        case 'trackpad-delta': {
          if (typeof msg.dx === 'number' && typeof msg.dy === 'number') {
            mouse.trackpadDelta(msg.dx, msg.dy);
          }
          break;
        }

        case 'trackpad-click': {
          mouse.trackpadClick(msg.button || 'left');
          break;
        }

        case 'ping':
          send(ws, { type: 'pong' });
          ws.isAlive = true;
          break;

        case 'disconnect':
          cleanup(ws, 'client requested disconnect');
          safeClose(ws, 1000, 'Client disconnected');
          break;

        default:
          break;
      }
    });

    ws.on('close', () => cleanup(ws, 'socket closed'));
    ws.on('error', (e) => console.error(`[WS] Error on ${id}:`, e.message));
  });

  heartbeatTimer = setInterval(() => {
    if (!wss) return;

    wss.clients.forEach((ws) => {
      if (ws._cleaned) return;
      if (ws.isAlive === false) {
        cleanup(ws, 'heartbeat timeout');
        ws.terminate();
        return;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch (_) {
        cleanup(ws, 'heartbeat ping failed');
        try { ws.terminate(); } catch (_) {}
      }
    });
  }, HEARTBEAT_MS);

  wss.on('close', () => {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  });
}

function replaceExistingSessions(except = null) {
  if (!wss) return;
  for (const existing of [...wss.clients]) {
    if (existing === except) continue;
    if (existing._cleaned) continue;
    cleanup(existing, 'replaced by new controller session');
    safeClose(existing, 4001, 'Replaced by new controller session');
  }
}

function cleanup(ws, reason) {
  if (!ws || ws._cleaned) return;
  ws._cleaned = true;

  const id = ws._nullpadId;
  if (id) {
    if (activeSocket === ws) activeSocket = null;
    haptics.stop(id);
    vigem.release(id);
    console.log(`[WS] Session cleaned: ${id} (${reason})`);
  }
}

function safeClose(ws, code, reason) {
  if (!ws) return;
  try {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(code, reason);
    }
  } catch (_) {}
}

function shutdown() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
  if (!wss) return;

  for (const client of [...wss.clients]) {
    cleanup(client, 'server shutdown');
    try { client.close(1001, 'Server shutting down'); } catch (_) {}
    try { if (client.readyState !== WebSocket.CLOSED) client.terminate(); } catch (_) {}
  }
  try { wss.close(); } catch (_) {}
}

function structuredCloneSafe(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (_) { return null; }
}

function getActiveState() {
  return activeSocket && !activeSocket._cleaned ? activeSocket._state : null;
}

function triggerHaptic(pattern) {
  if (!activeSocket || activeSocket._cleaned) return;
  send(activeSocket, { type: 'haptic', pattern });
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function broadcast(obj) {
  if (!wss) return;
  const msg = JSON.stringify(obj);
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(msg);
  });
}

module.exports = { init, shutdown, broadcast, getActiveState, triggerHaptic };
