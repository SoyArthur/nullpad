/**
 * NULLPAD — Ensure the HTTPS certificate covers the current LAN IP.
 * Re-generates the self-signed certificate only when the current detected LAN
 * IPs are not already present in the certificate SAN.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { buildSANs, certificateMatchesIP, generateCertificate } = require('./generate-cert');

const ROOT = path.resolve(__dirname, '..');
const CERT = path.join(ROOT, 'ssl', 'cert.pem');
const KEY = path.join(ROOT, 'ssl', 'key.pem');

try {
  const { ips, network } = buildSANs();
  const healthy = fs.existsSync(CERT) && fs.existsSync(KEY) && ips.every(certificateMatchesIP);

  if (healthy) {
    console.log(`[SSL] Existing certificate covers current LAN IP ${network.primary}.`);
    process.exit(0);
  }

  console.log('[SSL] Current LAN IP is not covered by the certificate; regenerating it...');
  generateCertificate();
  console.log('[SSL] Certificate updated successfully.');
} catch (err) {
  console.error(`[SSL] ERROR: ${err.message}`);
  process.exit(1);
}
