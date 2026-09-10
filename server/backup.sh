#!/usr/bin/env bash
# Makes one encrypted, off-machine-ready backup of production/ (the real
# student/class/attendance/makeup/payment data -- see DESIGN.md).
#
# Usage:  npm run backup
#
# Produces a single AES-256-encrypted file in ~/Documents/TutoringTrackerBackups/.
# You'll be prompted for a passphrase (openssl's own prompt -- hidden input,
# typed twice to confirm). Nothing is stored anywhere; you'll need that same
# passphrase to restore later, so keep it somewhere safe and SEPARATE from
# the backup file itself (a password manager, not a note next to the file).
#
# If Google Drive has been connected (npm run gdrive-auth, once), the file
# uploads automatically afterward via the real Drive API. Until then, it
# falls back to opening the file's Finder location and the Drive folder in
# the browser so you can drag it over yourself. See restore.sh to reverse
# a backup.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
PRODUCTION_DIR="$APP_DIR/production"
OUTPUT_DIR="${TUTORING_BACKUP_DIR:-$HOME/Documents/TutoringTrackerBackups}"
# Your Google Drive folder for these backups (drive.google.com link, not an
# API upload -- there's no Google Drive desktop sync app on this Mac, so
# the last step is a manual drag from the Finder window this script opens
# into the browser tab it also opens).
DRIVE_FOLDER_URL="https://drive.google.com/drive/u/3/folders/1-x-sK3Xrk0gWPAurU8i6ipEm1xJ-VGJJ"

if [ ! -d "$PRODUCTION_DIR" ]; then
  echo "No production/ folder found at $PRODUCTION_DIR -- nothing to back up yet." >&2
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

STAMP="$(date +%Y%m%d-%H%M%S)"
TMP_TAR="$(mktemp -t tutoring-backup).tar.gz"
OUTPUT_FILE="$OUTPUT_DIR/tutoring-backup-$STAMP.tar.gz.enc"

cleanup() { rm -f "$TMP_TAR"; }
trap cleanup EXIT

# Only the current, real data -- not the on-disk backups/ history (that's a
# separate, same-machine safety net; this is the off-machine one).
tar -czf "$TMP_TAR" -C "$APP_DIR" --exclude 'production/backups' production

echo "Encrypting backup -- enter a passphrase (you'll type it twice)."
echo "Write this passphrase down somewhere safe and separate from the backup file. Without it, the backup can never be restored."
openssl enc -aes-256-cbc -pbkdf2 -salt -in "$TMP_TAR" -out "$OUTPUT_FILE"

echo ""
echo "Backup saved: $OUTPUT_FILE"

if command -v node >/dev/null 2>&1 && [ -f "$SCRIPT_DIR/gdrive-credentials.json" ] && node "$SCRIPT_DIR/gdrive-upload.js" "$OUTPUT_FILE"; then
  exit 0
fi

echo "Opening its Finder location and your Google Drive folder -- drag the"
echo "file from one window into the other to finish uploading it."
if command -v open >/dev/null 2>&1; then
  open -R "$OUTPUT_FILE"
  open "$DRIVE_FOLDER_URL"
fi
