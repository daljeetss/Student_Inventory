#!/usr/bin/env node
// Uploads one file into the configured Google Drive folder, using the
// refresh token gdrive-auth.js saved. Called automatically by backup.sh
// after each backup. Exits non-zero (without a stack trace) if Google
// Drive hasn't been connected yet, or if the upload fails for any other
// reason, so backup.sh can fall back to the manual drag-and-drop flow --
// this should never be able to block a backup from being made.

const fs = require('fs');
const path = require('path');

const CREDENTIALS_FILE = path.join(__dirname, 'gdrive-credentials.json');
// The folder at https://drive.google.com/drive/u/3/folders/1-x-sK3Xrk0gWPAurU8i6ipEm1xJ-VGJJ
const FOLDER_ID = '1-x-sK3Xrk0gWPAurU8i6ipEm1xJ-VGJJ';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node gdrive-upload.js <file>');
  process.exit(1);
}

if (!fs.existsSync(CREDENTIALS_FILE)) {
  console.log('Google Drive not connected yet (run: npm run gdrive-auth) -- skipping automatic upload.');
  process.exit(2);
}

async function main() {
  const { client_id, client_secret, refresh_token } = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id, client_secret, refresh_token, grant_type: 'refresh_token' }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenRes.ok) throw new Error('Could not refresh Google access token: ' + JSON.stringify(tokenData));
  const accessToken = tokenData.access_token;

  const fileName = path.basename(filePath);
  const fileData = fs.readFileSync(filePath);
  const metadata = { name: fileName, parents: [FOLDER_ID] };

  const boundary = 'tutoring_backup_boundary';
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const multipartBody = Buffer.concat([Buffer.from(head, 'utf8'), fileData, Buffer.from(tail, 'utf8')]);

  const uploadRes = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: multipartBody,
  });
  const uploadData = await uploadRes.json();
  if (!uploadRes.ok) throw new Error('Upload failed: ' + JSON.stringify(uploadData));

  console.log(`Uploaded to Google Drive: ${fileName}`);
}

main().catch((err) => {
  console.error('Automatic Google Drive upload failed:', err.message);
  process.exit(3);
});
