/**
 * NULLPAD Client — WebSocket Manager
 * Owns one socket for one page. Leaving the page closes the socket and stops
 * reconnecting, while returning through the browser bfcache reconnects cleanly.
 */
'use strict';

const NullWS = (() => {
  const RECONNECT_MS = 1500;

  let ws = null;
  let retryTimer = null;
  let url = null;
  let profile = 'wiimote';

  function profileFromPath(pathname) {
    const name = String(pathname || '').toLowerCase();
    if (name.endsWith('/xbox.html')) return 'xbox';
    if (name.endsWith('/dualsense.html')) return 'dualSense';
    if (name.endsWith('/joycon.html')) return 'joycon';
    if (name.endsWith('/wiimote.html')) return 'wiimote';
    return 'wiimote';
  }
  let closing = false;
  let connectionSerial = 0;

  let _onReady = () => {};
  let _onHaptic = () => {};
  let _onStatus = () => {};

  function init(onReady, onHaptic, onStatus, initialProfile) {
    _onReady = onReady || _onReady;
    _onHaptic = onHaptic || _onHaptic;
    _onStatus = onStatus || _onStatus;
    profile = initialProfile || profileFromPath(location.pathname);
    closing = false;

    url = `wss://${location.hostname}:${location.port || 8443}`;
    connect();
  }

  function connect() {
    if (closing) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    clearTimeout(retryTimer);
    _onStatus('connecting');

    const serial = ++connectionSerial;
    const socket = new WebSocket(url);
    ws = socket;

    socket.onopen = () => {
      if (serial !== connectionSerial || closing) {
        try { socket.close(1000, 'stale socket'); } catch (_) {}
        return;
      }

      _onStatus('connected');
      socket.send(JSON.stringify({ type: 'init', profile }));
    };

    socket.onmessage = (event) => {
      if (serial !== connectionSerial || closing) return;

      let msg;
      try { msg = JSON.parse(event.data); } catch (_) { return; }

      switch (msg.type) {
        case 'ready':
          _onReady(msg);
          break;
        case 'haptic':
          _onHaptic(msg.pattern);
          break;
        case 'pong':
          break;
        case 'error':
          console.error('[NullWS] Server error:', msg.msg);
          _onStatus('error:' + msg.msg);
          break;
        default:
          break;
      }
    };

    socket.onclose = (event) => {
      if (ws === socket) ws = null;
      if (serial !== connectionSerial) return;

      // 4001 means another controller page took ownership. Do not let this
      // stale page reconnect and steal the controller back.
      if (event.code === 4001 || event.code === 1001) closing = true;

      _onStatus('disconnected');
      if (!closing) retryTimer = setTimeout(connect, RECONNECT_MS);
    };

    socket.onerror = (error) => {
      console.error('[NullWS] WS error', error);
      // close() guarantees onclose performs the normal reconnect/cleanup path.
      try { socket.close(); } catch (_) {}
    };
  }

  function send(obj) {
    if (!closing && ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(obj)); } catch (_) {}
    }
  }

  function setProfile(p) {
    profile = p;
    send({ type: 'init', profile: p });
  }

  function disconnect(reason = 'page left') {
    closing = true;
    clearTimeout(retryTimer);
    retryTimer = null;
    connectionSerial++;

    const socket = ws;
    ws = null;
    if (!socket) return;

    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'disconnect' }));
        socket.close(1000, reason);
      } else if (socket.readyState === WebSocket.CONNECTING) {
        socket.close(1000, reason);
      }
    } catch (_) {}
  }

  // MDN recommends pagehide for WebSocket cleanup; pages restored from bfcache
  // reconnect on pageshow.
  window.addEventListener('pagehide', () => disconnect('page left'));
  window.addEventListener('beforeunload', () => disconnect('page unload'));
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      closing = false;
      connect();
    }
  });

  return { init, send, setProfile, disconnect };
})();
