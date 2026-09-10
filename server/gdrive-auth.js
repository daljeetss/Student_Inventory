#!/usr/bin/env node
// One-time setup: authorizes this app to upload backup files into your
// Google Drive folder, using the narrowest possible OAuth scope
// (drive.file) -- this app can only ever see/manage files IT creates,
// never browse or read the rest of your Drive.
//
// Run once, after creating an OAuth client in Google Cloud Console (see
// README.md "Backing up your data off this computer"):
//
//   GDRIVE_CLIENT_ID=... GDRIVE_CLIENT_SECRET=... npm run gdrive-auth
//
// Saves the resulting refresh token to gdrive-credentials.json next to
// this file (gitignored) -- future `npm run backup` runs use it silently,
// no browser step needed again unless you revoke access.

const crypto = require('crypto');
const { exec } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const CLIENT_ID = process.env.GDRIVE_CLIENT_ID;
const CLIENT_SECRET = process.env.GDRIVE_CLIENT_SECRET;
const CREDENTIALS_FILE = path.join(__dirname, 'gdrive-credentials.json');
const PORT = 53682;
const REDIRECT_URI = `http://127.0.0.1:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/drive.file';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Set GDRIVE_CLIENT_ID and GDRIVE_CLIENT_SECRET (from Google Cloud Console) and run again:');
  console.error('  GDRIVE_CLIENT_ID=... GDRIVE_CLIENT_SECRET=... npm run gdrive-auth');
  process.exit(1);
}

const state = crypto.randomBytes(16).toString('hex');

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');
authUrl.searchParams.set('state', state);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');

  if (!code || returnedState !== state) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h2>Something went wrong (missing code, or this link was already used). Close this tab and run the command again.</h2>');
    return;
  }

  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokenRes.ok || !tokens.refresh_token) {
      throw new Error(tokens.error_description || JSON.stringify(tokens));
    }

    fs.writeFileSync(
      CREDENTIALS_FILE,
      JSON.stringify({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: tokens.refresh_token }, null, 2),
    );

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h2>Connected! You can close this tab and go back to the terminal.</h2>');
    console.log('\nSaved: ' + CREDENTIALS_FILE);
    console.log('"npm run backup" will now upload to Google Drive automatically.');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end('<h2>Something went wrong -- see the terminal for details.</h2>');
    console.error('Authorization failed:', err.message);
  } finally {
    server.close();
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('Opening your browser to connect Google Drive...');
  console.log('(This only ever grants access to files this app creates itself -- not the rest of your Drive.)\n');
  const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${opener} "${authUrl.toString()}"`);
});
