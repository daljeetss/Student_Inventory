/**
 * Builds the URLs someone opens to use the app with their personal link
 * -- shared by serve.js (startup message) and users.js (making links).
 *
 *  - Home Wi-Fi: http://<this Mac's LAN IP>:<port>/?token=...
 *  - Anywhere (once Tailscale is set up -- see README): https://<this
 *    Mac's Tailscale name>/?token=..., served by `tailscale serve`.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');

function localIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

const TAILSCALE_CLIS = ['/Applications/Tailscale.app/Contents/MacOS/Tailscale', 'tailscale'];

/** This Mac's Tailscale HTTPS name (e.g. "macbook.tail1234.ts.net"), or
 * null if Tailscale isn't installed, isn't running, or isn't serving the
 * app over HTTPS yet. */
function tailscaleHostname() {
  for (const cli of TAILSCALE_CLIS) {
    if (cli.startsWith('/') && !fs.existsSync(cli)) continue;
    try {
      const status = JSON.parse(execFileSync(cli, ['status', '--json'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }));
      const name = status?.Self?.DNSName?.replace(/\.$/, '');
      if (!name) return null;
      // Only offer the link if `tailscale serve` is actually set up.
      const serve = execFileSync(cli, ['serve', 'status'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString();
      return serve.includes(name) ? name : null;
    } catch {
      // not installed / not logged in / not serving
    }
  }
  return null;
}

function linkUrls(token, port) {
  const urls = [{ where: 'Home Wi-Fi', url: `http://${localIp()}:${port}/?token=${token}` }];
  const ts = tailscaleHostname();
  if (ts) urls.push({ where: 'Anywhere (Tailscale)', url: `https://${ts}/?token=${token}` });
  return urls;
}

module.exports = { localIp, tailscaleHostname, linkUrls };
