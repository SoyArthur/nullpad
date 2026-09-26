/**
 * NULLPAD — Self-signed LAN certificate generator
 * Generates a certificate whose IP Subject Alternative Names match the
 * currently usable LAN addresses, plus loopback and local DNS names.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { X509Certificate } = require('crypto');
const { detectNetwork, isIPv4, isPrivateIPv4 } = require('../server/network');

const ROOT = path.resolve(__dirname, '..');
const SSL_DIR = path.join(ROOT, 'ssl');
const CERT = path.join(SSL_DIR, 'cert.pem');
const KEY = path.join(SSL_DIR, 'key.pem');

function findOpenSSL() {
  if (process.env.OPENSSL_EXE && fs.existsSync(process.env.OPENSSL_EXE)) return process.env.OPENSSL_EXE;
  if (process.platform === 'win32') {
    const where = spawnSync('where.exe', ['openssl'], { encoding: 'utf8', windowsHide: true });
    if (where.status === 0) {
      const hit = where.stdout.split(/\r?\n/).map(s => s.trim()).find(Boolean);
      if (hit && fs.existsSync(hit)) return hit;
    }
    const roots = [
      process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Git', 'usr', 'bin', 'openssl.exe'),
      process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Git', 'usr', 'bin', 'openssl.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'usr', 'bin', 'openssl.exe'),
    ].filter(Boolean);
    const hit = roots.find(fs.existsSync);
    if (hit) return hit;
  }
  return 'openssl';
}

function certificateMatchesIP(ip) {
  if (!fs.existsSync(CERT)) return false;
  try {
    const cert = new X509Certificate(fs.readFileSync(CERT));
    return !!cert.checkIP(ip);
  } catch {
    return false;
  }
}

function buildSANs() {
  const network = detectNetwork();
  const ips = [...new Set([
    '127.0.0.1',
    ...network.ips,
    ...(process.env.NULLPAD_IP ? [process.env.NULLPAD_IP] : [])
  ])].filter(ip => isIPv4(ip) && (ip === '127.0.0.1' || isPrivateIPv4(ip)));

  return {
    network,
    ips: ips.slice(0, 20),
    san: [
      'DNS:localhost',
      'DNS:nullpad.local',
      ...ips.map(ip => `IP:${ip}`),
    ].join(',')
  };
}

function generateCertificate() {
  fs.mkdirSync(SSL_DIR, { recursive: true });
  const { network, ips, san } = buildSANs();
  const openssl = findOpenSSL();

  console.log(`[SSL] Primary LAN IP: ${network.primary}`);
  console.log(`[SSL] SAN IPs: ${ips.join(', ')}`);
  console.log(`[SSL] Using OpenSSL: ${openssl}`);

  const result = spawnSync(openssl, [
    'req', '-x509', '-newkey', 'rsa:2048',
    '-keyout', KEY, '-out', CERT,
    '-days', '365', '-nodes', '-sha256',
    '-subj', '/CN=nullpad.local',
    '-addext', `subjectAltName=${san}`
  ], { stdio: 'inherit', windowsHide: true });

  if (result.error) throw new Error(`Could not start OpenSSL: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`OpenSSL exited with code ${result.status}`);

  const missing = ips.filter(ip => !certificateMatchesIP(ip));
  if (missing.length) {
    throw new Error(`Generated certificate is missing SAN IP(s): ${missing.join(', ')}`);
  }

  return { network, ips };
}

if (require.main === module) {
  try {
    const result = generateCertificate();
    console.log(`[SSL] Certificate ready: ${CERT}`);
    console.log(`[SSL] key ready: ${KEY}`);
    console.log(`[SSL] Verified SAN coverage for ${result.ips.length} IP address(es).`);
  } catch (err) {
    console.error(`[SSL] ERROR: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { findOpenSSL, certificateMatchesIP, buildSANs, generateCertificate };
