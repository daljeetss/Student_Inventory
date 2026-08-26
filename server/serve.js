#!/usr/bin/env node
/**
 * Serves the built web app (from `dist/`, via `expo export -p web`) behind a
 * one-time access token, and installs as a real home-screen app icon on
 * iPhone/Samsung that reopens already-authenticated.
 *
 * Same pattern as alpaca_momentum_bot-main/dashboard.py:
 *   - a token is generated once and saved to a local file
 *   - it's supplied via ?token=... the first time, then remembered in a cookie
 *   - manifest.json embeds the token into `start_url`, but ONLY for requests
 *     that are already authorized -- so the installed icon's first launch
 *     (which uses start_url, not the URL you originally typed) still works,
 *     without ever exposing the token to an unauthenticated caller.
 *   - manifest.json + icons stay public so iOS/Android can fetch them while
 *     installing, before the user has "logged in".
 *
 * Usage: npm run serve   (builds the web export, then serves it)
 */

const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const ICONS_DIR = path.join(__dirname, 'icons');
const TOKEN_FILE = path.join(__dirname, 'access-token.txt');
const PORT = Number(process.env.PORT) || 8899;

const APP_NAME = 'Tutoring Tracker';
const SHORT_NAME = 'Tutoring';
const THEME_COLOR = '#2E7D32';

function getOrCreateToken() {
  if (fs.existsSync(TOKEN_FILE)) {
    const saved = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
    if (saved) return saved;
  }
  const token = crypto.randomBytes(16).toString('base64url');
  fs.writeFileSync(TOKEN_FILE, token);
  return token;
}

function localIp() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) return net.address;
    }
  }
  return 'localhost';
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function isAuthorized(req, token) {
  const url = new URL(req.url, 'http://internal');
  const supplied = url.searchParams.get('token') || req.headers['x-dashboard-token'];
  if (supplied && timingSafeEqual(supplied, token)) return true;

  const cookieHeader = req.headers.cookie || '';
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'dash_token' && timingSafeEqual(rest.join('='), token)) return true;
  }
  return false;
}

function buildManifest(token) {
  return {
    name: APP_NAME,
    short_name: SHORT_NAME,
    description: 'Students, attendance, and billing for tutoring',
    start_url: token ? `./?token=${token}` : './',
    scope: './',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#ffffff',
    theme_color: THEME_COLOR,
    icons: [
      { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

const HEAD_INJECTION = `
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="${SHORT_NAME}">
<meta name="theme-color" content="${THEME_COLOR}">
</head>`;

const UNAUTHORIZED_HTML = `<!doctype html>
<html><head><meta charset="utf-8"><title>Unauthorized</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;padding:40px;line-height:1.6;color:#222}
code{background:#eee;padding:2px 6px;border-radius:4px}</style></head>
<body><h2>Unauthorized</h2>
<p>This app requires an access link.</p>
<p>Use the full link printed in the terminal when the server started
(it looks like <code>http://&lt;ip&gt;:${PORT}/?token=...</code>), or check
<code>server/access-token.txt</code> for the token.</p>
</body></html>`;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

function send(res, code, body, contentType, extraHeaders) {
  res.writeHead(code, { 'Content-Type': contentType, 'Content-Length': Buffer.byteLength(body), ...extraHeaders });
  res.end(body);
}

function serveStaticFile(req, res, filePath, cookieToSet) {
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const headers = cookieToSet ? { 'Set-Cookie': cookieToSet } : undefined;

    if (ext === '.html') {
      const html = data.toString('utf8').replace('</head>', HEAD_INJECTION);
      return send(res, 200, html, contentType, headers);
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length, ...(headers || {}) });
    res.end(data);
  });
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error('No dist/ folder found. Run "npx expo export -p web" first (or use "npm run serve", which does this for you).');
    process.exit(1);
  }

  const token = getOrCreateToken();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://internal');
    const pathname = decodeURIComponent(url.pathname);

    // Public: manifest + icons, so the OS can fetch them while installing,
    // before the browser has ever been authorized.
    if (pathname === '/manifest.json') {
      const tok = isAuthorized(req, token) ? token : null;
      return send(res, 200, JSON.stringify(buildManifest(tok)), 'application/manifest+json');
    }
    if (pathname.startsWith('/icons/')) {
      return serveStaticFile(req, res, path.join(ICONS_DIR, path.basename(pathname)));
    }

    if (!isAuthorized(req, token)) {
      return send(res, 401, UNAUTHORIZED_HTML, 'text/html');
    }

    const suppliedToken = url.searchParams.get('token');
    // First authorized visit via ?token=... : remember it in a cookie so the
    // token doesn't need to stay in the URL (or be re-typed) after this.
    const cookieToSet =
      suppliedToken && timingSafeEqual(suppliedToken, token)
        ? `dash_token=${token}; Path=/; Max-Age=31536000; SameSite=Lax`
        : undefined;

    let relative = pathname === '/' ? '/index.html' : pathname;
    let filePath = path.join(DIST_DIR, relative);
    if (!filePath.startsWith(DIST_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // expo-router web export is a single-page app for unknown paths
      filePath = path.join(DIST_DIR, 'index.html');
    }
    serveStaticFile(req, res, filePath, cookieToSet);
  });

  server.listen(PORT, '0.0.0.0', () => {
    const ip = localIp();
    console.log('='.repeat(62));
    console.log(`  ${APP_NAME} running`);
    console.log('='.repeat(62));
    console.log(`  On this computer:  http://localhost:${PORT}/?token=${token}`);
    console.log(`  From your phone:   http://${ip}:${PORT}/?token=${token}`);
    console.log('');
    console.log('  Phone must be on the same Wi-Fi network as this computer.');
    console.log('  Open that link once in Safari/Chrome, then use "Add to');
    console.log('  Home Screen" -- the icon will reopen already signed in.');
    console.log('');
    console.log(`  Token saved to server/access-token.txt  (Ctrl+C to stop)`);
    console.log('='.repeat(62));
  });
}

main();
