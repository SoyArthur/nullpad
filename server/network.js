/**
 * NULLPAD — LAN network detection
 * Windows-first detection that prefers connected, non-virtual interfaces with
 * an IPv4 default gateway (Wi-Fi/Ethernet), then falls back to Node's
 * os.networkInterfaces().
 */
'use strict';

const os = require('os');
const { execFileSync } = require('child_process');

const VIRTUAL_HINTS = [
  'virtual', 'vmware', 'virtualbox', 'vbox', 'vethernet', 'hyper-v',
  'hyperv', 'wsl', 'docker', 'tap', 'tun', 'vpn', 'wireguard', 'zerotier',
  'hamachi', 'tailscale', 'loopback'
];
const WIFI_HINTS = ['wi-fi', 'wifi', 'wlan', 'wireless'];
const ETHERNET_HINTS = ['ethernet', 'lan'];

function isIPv4(value) {
  const parts = String(value || '').split('.');
  return parts.length === 4 && parts.every(p => /^\d+$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isPrivateIPv4(ip) {
  if (!isIPv4(ip)) return false;
  const [a, b] = ip.split('.').map(Number);
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  return false;
}

function isVirtualAlias(alias) {
  const name = String(alias || '').toLowerCase();
  return VIRTUAL_HINTS.some(h => name.includes(h));
}

function scoreAlias(alias, hasGateway) {
  const name = String(alias || '').toLowerCase();
  let score = 0;
  if (hasGateway) score += 100;
  if (WIFI_HINTS.some(h => name.includes(h))) score += 60;
  if (ETHERNET_HINTS.some(h => name.includes(h))) score += 50;
  if (isVirtualAlias(alias)) score -= 150;
  return score;
}

function windowsConfigs() {
  if (process.platform !== 'win32') return [];

  const ps = [
    '$ErrorActionPreference = "Stop"',
    'Get-NetIPConfiguration',
    '| Where-Object { $_.NetAdapter.Status -eq "Up" -and $_.IPv4Address }',
    '| ForEach-Object { [PSCustomObject]@{',
    'Alias = $_.InterfaceAlias;',
    'IPv4 = ($_.IPv4Address | Select-Object -First 1 -ExpandProperty IPAddress);',
    'HasGateway = [bool]$_.IPv4DefaultGateway',
    '} }',
    '| ConvertTo-Json -Compress'
  ].join(' ');

  try {
    const out = execFileSync('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', ps
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
    if (!out) return [];
    const data = JSON.parse(out);
    return (Array.isArray(data) ? data : [data])
      .map(x => ({ alias: x.Alias, ip: x.IPv4, hasGateway: !!x.HasGateway }))
      .filter(x => isIPv4(x.ip));
  } catch {
    return [];
  }
}

function nodeConfigs() {
  const ifaces = os.networkInterfaces();
  const result = [];
  for (const [alias, entries] of Object.entries(ifaces)) {
    for (const iface of (entries || [])) {
      const family = iface && (iface.family === 'IPv4' || iface.family === 4);
      if (!family || iface.internal || !isIPv4(iface.address)) continue;
      result.push({ alias, ip: iface.address, hasGateway: false });
    }
  }
  return result;
}

function detectNetwork() {
  const source = windowsConfigs();
  const configs = source.length ? source : nodeConfigs();
  const unique = new Map();

  for (const item of configs) {
    if (!isPrivateIPv4(item.ip)) continue;
    const key = item.ip;
    const scored = { ...item, score: scoreAlias(item.alias, item.hasGateway) };
    const existing = unique.get(key);
    if (!existing || scored.score > existing.score) unique.set(key, scored);
  }

  const candidates = [...unique.values()].sort((a, b) => b.score - a.score || a.ip.localeCompare(b.ip));
  const envIP = process.env.NULLPAD_IP && isIPv4(process.env.NULLPAD_IP) &&
    (process.env.NULLPAD_IP === '127.0.0.1' || isPrivateIPv4(process.env.NULLPAD_IP))
    ? process.env.NULLPAD_IP
    : null;

  const primary = envIP || (candidates[0] && candidates[0].ip) || '127.0.0.1';
  const ips = [...new Set([primary, ...candidates.map(x => x.ip)])];

  return {
    primary,
    ips,
    interfaces: candidates,
    source: source.length ? 'Get-NetIPConfiguration' : 'os.networkInterfaces'
  };
}

module.exports = {
  isIPv4,
  isPrivateIPv4,
  detectNetwork,
};
