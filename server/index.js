/**
 * NULLPAD — HTTPS + WSS Entry Point
 * Serves static client files and attaches the WebSocket handler.
 */

'use strict';

const https  = require('https');
const fs     = require('fs');
const path   = require('path');
const cfg    = require('../config');
const ws     = require('./websocket');
const vigem  = require('./vigem');
const dsu    = require('./dsu');
const mouse  = require('./mouse');

// ── MIME map ──────────────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.json': 'application/json',
};

// ── Static file handler ───────────────────────────────────────────────────────
function serveStatic(req, res) {
  let urlPath = req.url.split('?')[0];
  if (urlPath === '/') urlPath = '/index.html';

  const filePath = path.join(__dirname, '..', 'client', urlPath);
  const ext      = path.extname(filePath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

// ── Boot ──────────────────────────────────────────────────────────────────────
function installShutdownHandlers(server) {
  let shuttingDown = false;
  const shutdown = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[Server] ${signal} received — releasing virtual controller...`);
    dsu.stop();
    ws.shutdown();
    vigem.shutdown();
    try { server.close(() => process.exit(0)); } catch (_) { process.exit(0); }
    setTimeout(() => process.exit(0), 1500).unref();
  };

  process.once('SIGINT',  () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

function start() {
  // Validate SSL
  if (!fs.existsSync(cfg.SSL.CERT) || !fs.existsSync(cfg.SSL.KEY)) {
    console.error('[Server] SSL certificates not found. Run install.bat first.');
    process.exit(1);
  }

  const sslOptions = {
    cert: fs.readFileSync(cfg.SSL.CERT),
    key:  fs.readFileSync(cfg.SSL.KEY),
  };

  // Init ViGEm — native backend is mandatory.
  if (!vigem.init()) {
    console.error('[Server] ViGEm initialization failed. Run install.bat first.');
    process.exit(1);
  }

  // Init mouse bridge — optional, fails gracefully if robotjs unavailable.
  mouse.init();

  // Create HTTPS server
  const server = https.createServer(sslOptions, serveStatic);

  // Attach WebSocket
  ws.init(server);

  // DSU/Cemuhook motion source for Cemu. Uses the active WebSocket session.
  dsu.start(() => ws.getActiveState(), (motors) => {
    const strength = Math.max(Number(motors.large) || 0, Number(motors.small) || 0);
    const duration = Math.round(20 + (strength / 255) * 180);
    ws.triggerHaptic(strength > 0 ? [duration] : [0]);
  });

  // Listen
  server.listen(cfg.PORT, '0.0.0.0', () => {
    const url = `https://${cfg.HOST}:${cfg.PORT}`;
    console.log('\n╔══════════════════════════════════════════╗');
    console.log('║           NULLPAD  🎮  RUNNING           ║');
    console.log('╠══════════════════════════════════════════╣');
    const header = `║  PC:     ${url}`.padEnd(43) + '║';
    const vigemStatus = vigem.isAvailable() ? 'Active ✅' : 'Unavailable ❌';
    const mouseStatus = mouse.isAvailable() ? 'Active ✅' : 'Unavailable ⚠️';
    console.log(header);
    console.log(`║  ViGEm:  ${vigemStatus}`.padEnd(43) + '║');
    console.log(`║  Mouse:  ${mouseStatus}`.padEnd(43) + '║');
    console.log('╚══════════════════════════════════════════╝');
    if (cfg.HOST === '127.0.0.1') {
      console.warn('\n⚠️  No private LAN IPv4 was detected. Phone access will not work until the PC is connected to a LAN/Wi-Fi.');
    }
    console.log(`\n📱 PHONE / LAN URL: ${url}`);
    console.log(`🌀 Cemu motion: udp://${dsu.getHost()}:${dsu.getPort()} (DSU1)`);
    if (Array.isArray(cfg.LAN_IPS) && cfg.LAN_IPS.length) {
      console.log('   Detected LAN addresses:');
      for (const ip of cfg.LAN_IPS) {
        console.log(`   • https://${ip}:${cfg.PORT}`);
      }
    }
    console.log('\n   Scan the QR below or open the PHONE / LAN URL on your phone.');
    console.log('   Accept the HTTPS certificate warning on first use.\n');
    printQR(url);
  });

  installShutdownHandlers(server);

  server.on('error', (e) => {
    console.error('[Server] Fatal:', e.message);
    process.exit(1);
  });
}

// ── Inline QR (ASCII) ─────────────────────────────────────────────────────────
function printQR(url) {
  try {
    const qr = require('qrcode-terminal');
    qr.generate(url, { small: true });
  } catch {
    console.log(`  ${url}\n`);
    console.log('  (install qrcode-terminal for QR display)\n');
  }
}

start();
