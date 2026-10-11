/**
 * Builds the URLs someone opens to use the app with their personal link
 * -- shared by serve.js (startup message) and users.js (making links).
 *
 *  - Home Wi-Fi: http://<this Mac's LAN IP>:<port>/?token=...
 *  - Anywhere (once Tailscale is set up -- see README): https://<this
 *    Mac's Tailscale name>[:<https port>]/?token=..., served by
 *    `tailscale serve`.
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

/** The https address Tailscale serves THIS app on -- e.g.
 * "macbook.tail1234.ts.net" or "macbook.tail1234.ts.net:8443" -- found by
 * looking for the `tailscale serve` entry that forwards to the app's own
 * port. null if Tailscale isn't installed/running, or isn't serving this
 * app. (Matching on the port matters: the same Mac can serve other things
 * through Tailscale -- e.g. another dashboard on the main address -- and a
 * link must never point at those.) */
function tailscaleAddress(port) {
  for (const cli of TAILSCALE_CLIS) {
    if (cli.startsWith('/') && !fs.existsSync(cli)) continue;
    try {
      const config = JSON.parse(
        execFileSync(cli, ['serve', 'status', '--json'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }),
      );
      for (const [hostPort, site] of Object.entries(config?.Web ?? {})) {
        const proxy = site?.Handlers?.['/']?.Proxy ?? '';
        if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/.test(proxy)) continue;
        const proxyPort = Number(proxy.match(/:(\d+)\/?$/)?.[1] ?? 80);
        if (proxyPort !== Number(port)) continue;
        return hostPort.endsWith(':443') ? hostPort.slice(0, -4) : hostPort;
      }
      return null;
    } catch {
      // not installed / not logged in / not serving
    }
  }
  return null;
}

function linkUrls(token, port) {
  const urls = [{ where: 'Home Wi-Fi', url: `http://${localIp()}:${port}/?token=${token}` }];
  const ts = tailscaleAddress(port);
  if (ts) urls.push({ where: 'Anywhere (Tailscale)', url: `https://${ts}/?token=${token}` });
  return urls;
}

module.exports = { localIp, tailscaleAddress, linkUrls };
