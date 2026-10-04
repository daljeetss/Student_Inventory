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

const fs = require('fs');
const http = require('http');
const path = require('path');

const { createControlStore } = require('./db/control-store');
const { openStore, ValidationError, RESOURCES } = require('./db/store');
const { linkUrls, localIp } = require('./links');
const { can, permissionsFor } = require('./permissions');

const ROOT = path.join(__dirname, '..');
const DIST_DIR = path.join(ROOT, 'dist');
const ICONS_DIR = path.join(__dirname, 'icons');
// The single shared token from before separate logins. Only read once, on
// the first start after upgrading, to import it as an owner's link (see
// control-store.js's importLegacyToken) so no phone gets locked out.
const LEGACY_TOKEN_FILE = path.join(__dirname, 'access-token.txt');

// All real data lives here (a SQLite database, one row per record -- see
// server/db/). This folder is not to be touched for testing/experiments,
// ever -- set TUTORING_DATA_DIR to point a test run at some other directory
// instead of risking real data (see DESIGN.md).
const PRODUCTION_DIR = process.env.TUTORING_DATA_DIR
  ? path.resolve(process.env.TUTORING_DATA_DIR)
  : path.join(ROOT, 'production');

// /api/<resource> lists a whole resource; /api/<resource>/<id> saves or
// deletes ONE record (see server/db/store.js for the version check that
// stops two devices overwriting each other).
const RESOURCE_PATTERN = new RegExp(`^/api/(${RESOURCES.join('|')})$`);
const RECORD_PATTERN = new RegExp(`^/api/(${RESOURCES.join('|')})/([^/]+)$`);
// Names/behavior from before per-record saves. A still-open copy of the
// old app (loaded before an update) may keep calling these: reads still
// work, but its "replace the whole list" saves are refused (410) -- that
// kind of save is exactly what could overwrite another device's changes.
const LEGACY_RESOURCE_PATTERN = /^\/api\/(students|classes|attendance|makeup|payments)$/;
const OUT_OF_DATE_MESSAGE = 'This copy of the app is out of date. Reload the page to get the latest version.';

const MAX_BODY_BYTES = 5 * 1024 * 1024; // one resource file's worth; generous but not unbounded
const PORT = Number(process.env.PORT) || 8899;

// Same text as src/constants/brand.ts (this file can't import it) -- keep
// the two in sync. See LICENSE.
const COPYRIGHT_NOTICE = '© 2026 Marsar Solutions LLC. All rights reserved.';

const APP_NAME = 'Tutoring Tracker';
const SHORT_NAME = 'Tutoring';
const THEME_COLOR = '#2E7D32';

// Someone guessing at tokens gets slowed down: after this many wrong
// tokens from one address in the window, that address gets 429s until the
// window passes. (Tokens are 256-bit random, so guessing can't work
// anyway -- this just keeps the logs quiet and the Mac unbothered.)
const MAX_FAILED_TOKENS = 20;
const FAILED_TOKEN_WINDOW_MS = 15 * 60 * 1000;

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Every token a request offers: ?token=, the X-Dashboard-Token header
 * (what the app sends), and the dash_token cookie. */
function suppliedTokens(req) {
  const url = new URL(req.url, 'http://internal');
  const tokens = [url.searchParams.get('token'), req.headers['x-dashboard-token']];
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === 'dash_token') tokens.push(rest.join('='));
  }
  return tokens.filter((t) => typeof t === 'string' && t.length > 0);
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
<p>This app requires a personal access link.</p>
<p>Ask the owner for yours. (Owner: make one on the Mac running the app with
<code>npm run users -- link "Name" "Their phone"</code>.) If you had a link
that stopped working, it may have been turned off.</p>
<p style="margin-top:40px;color:#888;font-size:12px">${COPYRIGHT_NOTICE}</p>
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
    // index.html is the entry point that names the current hashed JS/CSS
    // bundle -- it must always be revalidated, or a phone that cached it
    // from before a rebuild would keep launching old code indefinitely.
    // The hashed asset files themselves (entry-<hash>.js etc.) are safe to
    // cache hard, since any code change gives them a new filename anyway.
    const cacheControl = ext === '.html' ? 'no-cache, must-revalidate' : 'public, max-age=31536000, immutable';
    const headers = { 'Cache-Control': cacheControl, ...(cookieToSet ? { 'Set-Cookie': cookieToSet } : {}) };

    if (ext === '.html') {
      const html = data.toString('utf8').replace('</head>', HEAD_INJECTION);
      return send(res, 200, html, contentType, headers);
    }
    res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': data.length, ...headers });
    res.end(data);
  });
}

function main() {
  if (!fs.existsSync(DIST_DIR)) {
    console.error('No dist/ folder found. Run "npx expo export -p web" first (or use "npm run serve", which does this for you).');
    process.exit(1);
  }

  const store = openStore(PRODUCTION_DIR);
  const control = createControlStore(PRODUCTION_DIR);

  // First start with separate logins: bring the old shared link along as
  // an owner's link, or -- on a brand-new install -- make the first owner.
  let firstOwnerLink = null;
  if (!control.hasUsers()) {
    const legacy = fs.existsSync(LEGACY_TOKEN_FILE) ? fs.readFileSync(LEGACY_TOKEN_FILE, 'utf8').trim() : '';
    if (legacy) {
      control.importLegacyToken(legacy);
      console.log('[tutoring-tracker] Your existing shared link still works (now as an owner link). Give each person their own -- see "npm run users".');
    } else {
      const owner = control.addUser('Owner', 'owner');
      firstOwnerLink = control.createLink(owner.id, 'First owner link').token;
    }
  }

  // Wrong-token attempts per client address (see MAX_FAILED_TOKENS).
  const failures = new Map();
  const tooManyFailures = (ip) => {
    const f = failures.get(ip);
    if (!f) return false;
    if (Date.now() - f.since > FAILED_TOKEN_WINDOW_MS) {
      failures.delete(ip);
      return false;
    }
    return f.count >= MAX_FAILED_TOKENS;
  };
  const recordFailure = (ip) => {
    const f = failures.get(ip);
    if (!f || Date.now() - f.since > FAILED_TOKEN_WINDOW_MS) failures.set(ip, { count: 1, since: Date.now() });
    else f.count += 1;
  };

  /** Who's making this request: { user, token } for a valid, active link;
   * otherwise null (and wrong tokens are counted against the address). */
  function authenticateRequest(req) {
    const tokens = suppliedTokens(req);
    for (const token of tokens) {
      const auth = control.authenticate(token);
      if (auth) return { ...auth, token };
    }
    if (tokens.length > 0) recordFailure(req.socket.remoteAddress);
    return null;
  }

  const server = http.createServer(async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (err) {
      send(res, 500, JSON.stringify({ ok: false, error: String(err && err.message) }), 'application/json');
    }
  });

  async function handleRequest(req, res) {
    const url = new URL(req.url, 'http://internal');
    const pathname = decodeURIComponent(url.pathname);
    const json = (code, obj) => send(res, code, JSON.stringify(obj), 'application/json', { 'Cache-Control': 'no-store' });

    if (pathname.startsWith('/icons/')) {
      return serveStaticFile(req, res, path.join(ICONS_DIR, path.basename(pathname)));
    }
    if (tooManyFailures(req.socket.remoteAddress)) {
      return send(res, 429, 'Too many wrong access links. Try again later.', 'text/plain', { 'Retry-After': '900' });
    }

    const auth = authenticateRequest(req);

    // Public: manifest + icons, so the OS can fetch them while installing,
    // before the browser has ever been authorized. The manifest embeds the
    // requester's OWN link in start_url (only if they're signed in), so
    // each person's home-screen icon opens as them.
    if (pathname === '/manifest.json') {
      return send(res, 200, JSON.stringify(buildManifest(auth ? auth.token : null)), 'application/manifest+json', {
        'Cache-Control': 'no-store',
      });
    }

    if (!auth) {
      return send(res, 401, UNAUTHORIZED_HTML, 'text/html');
    }
    const { user } = auth;
    const forbidden = () => json(403, { ok: false, error: "Your login doesn't allow this." });

    // Who's signed in, and what they may do -- the app uses this to hide
    // what someone can't use. The server still checks every request.
    if (pathname === '/api/me') {
      return json(200, { name: user.name, role: user.role, permissions: permissionsFor(user.role) });
    }

    // The app's data, stored on this computer (in production/tutoring.db)
    // instead of in each device's browser storage -- every device using
    // this server sees the same data. serve.js only ever talks to the
    // store's contract -- see server/db/store.js for why.
    const recordMatch = pathname.match(RECORD_PATTERN);
    if (recordMatch) {
      const [, resource, id] = recordMatch;
      if (req.method !== 'PUT' && req.method !== 'DELETE') return json(405, { ok: false, error: 'Method not allowed' });
      if (!can(user.role, `${resource}:write`)) return forbidden();
      try {
        const raw = await readRequestBody(req);
        const body = raw ? JSON.parse(raw) : {};
        const baseVersion = body.baseVersion ?? null;
        const meta = { actor: user.id };
        const result =
          req.method === 'PUT'
            ? await store.putRecord(resource, id, body.record, baseVersion, meta)
            : await store.deleteRecord(resource, id, baseVersion, meta);
        if (!result.ok && result.updatedBy) {
          // Say who, not just "another device".
          result.updatedBy = control.getUser(result.updatedBy)?.name ?? null;
        }
        return json(result.ok ? 200 : 409, result);
      } catch (err) {
        const clientError = err instanceof ValidationError || err instanceof SyntaxError;
        return json(clientError ? 400 : 500, { ok: false, error: String(err.message || err) });
      }
    }

    const resourceMatch = pathname.match(RESOURCE_PATTERN);
    if (resourceMatch && req.method === 'GET') {
      if (!can(user.role, `${resourceMatch[1]}:read`)) return forbidden();
      return json(200, store.getResource(resourceMatch[1]));
    }

    const legacyMatch = pathname.match(LEGACY_RESOURCE_PATTERN);
    if (legacyMatch || resourceMatch) {
      const legacy = legacyMatch ? legacyMatch[1] : resourceMatch[1];
      if (req.method === 'GET' && (legacy === 'attendance' || legacy === 'makeup')) {
        if (!can(user.role, 'sessions:read')) return forbidden();
        const wantMakeup = legacy === 'makeup';
        return json(200, store.getResource('sessions').filter((s) => s.isMakeup === wantMakeup));
      }
      if (req.method === 'POST') return json(410, { ok: false, error: OUT_OF_DATE_MESSAGE });
      return json(405, { ok: false, error: 'Method not allowed' });
    }

    // First authorized visit via ?token=... : remember it in a cookie so the
    // token doesn't need to stay in the URL (or be re-typed) after this.
    const cookieToSet =
      url.searchParams.get('token') === auth.token
        ? `dash_token=${auth.token}; Path=/; Max-Age=31536000; SameSite=Lax`
        : undefined;

    let relative = pathname === '/' ? '/index.html' : pathname;
    let filePath = path.join(DIST_DIR, relative);
    if (!filePath.startsWith(DIST_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // expo-router web export is a single-page app for unknown paths
      filePath = path.join(DIST_DIR, 'index.html');
    }
    serveStaticFile(req, res, filePath, cookieToSet);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log('='.repeat(62));
    console.log(`  ${APP_NAME} running`);
    console.log('='.repeat(62));
    if (firstOwnerLink) {
      console.log('  Your owner link (shown only this once -- save it):');
      for (const { where, url } of linkUrls(firstOwnerLink, PORT)) console.log(`    ${where}: ${url}`);
      console.log('');
    }
    const legacy = fs.existsSync(LEGACY_TOKEN_FILE) ? fs.readFileSync(LEGACY_TOKEN_FILE, 'utf8').trim() : '';
    if (legacy && control.authenticate(legacy)) {
      console.log('  Original shared link (still on -- replace with personal links):');
      for (const { where, url } of linkUrls(legacy, PORT)) console.log(`    ${where}: ${url}`);
      console.log('');
    }
    console.log('  People and their personal links:   npm run users');
    console.log(`  Phones on the same Wi-Fi reach it at http://${localIp()}:${PORT}`);
    console.log('  Open a link once in Safari/Chrome, then "Add to Home Screen".');
    console.log('');
    console.log(`  Data:  ${PRODUCTION_DIR}   (Ctrl+C to stop)`);
    console.log('='.repeat(62));
  });

  const shutdown = () => {
    store.close();
    control.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // Closing the terminal window sends SIGHUP, not SIGINT -- without this,
  // the database was never closed cleanly, so recent saves sat only in
  // tutoring.db-wal instead of being folded into tutoring.db itself.
  process.on('SIGHUP', shutdown);
}

main();
