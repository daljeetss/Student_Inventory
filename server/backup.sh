#!/usr/bin/env bash
# Makes one encrypted, off-machine-ready backup of production/ (the real
# student/class/attendance/payment data -- see DESIGN.md).
#
# Usage:  npm run backup               (by hand)
#         server/backup.sh --scheduled (from the daily schedule -- see
#                                       backup-schedule.sh; never prompts,
#                                       never opens windows)
#
# Produces a single AES-256-encrypted file in ~/Documents/TutoringTrackerBackups/.
# The passphrase comes from the macOS Keychain if one was saved with
# `npm run backup:passphrase` (needed for scheduled backups); otherwise
# openssl asks for it (hidden, typed twice). Either way it's never written
# to any file. Keep a copy of it somewhere OFF this Mac (a password
# manager): if this Mac is lost, the Keychain goes with it, and the
# backups can't be opened without the passphrase.
#
# If Google Drive has been connected (npm run gdrive-auth, once), the file
# uploads automatically afterward. Until then, a by-hand backup falls back
# to opening the file's Finder location and the Drive folder in the browser
# so you can drag it over yourself. See restore.sh to reverse a backup.

set -euo pipefail

SCHEDULED=0
[ "${1:-}" = "--scheduled" ] && SCHEDULED=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
# TUTORING_DATA_DIR: same override serve.js has -- for testing only.
PRODUCTION_DIR="${TUTORING_DATA_DIR:-$APP_DIR/production}"
OUTPUT_DIR="${TUTORING_BACKUP_DIR:-$HOME/Documents/TutoringTrackerBackups}"
KEYCHAIN_SERVICE="${TUTORING_BACKUP_KEYCHAIN_SERVICE:-tutoring-tracker-backup}"
KEEP_LOCAL=60 # newest encrypted backups kept on this Mac; Google Drive keeps them all
DRIVE_FOLDER_URL="https://drive.google.com/drive/u/3/folders/1-x-sK3Xrk0gWPAurU8i6ipEm1xJ-VGJJ"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
notify() {
  if [ "$SCHEDULED" = 1 ]; then
    osascript -e "display notification \"$1\" with title \"Tutoring Tracker backup\"" >/dev/null 2>&1 || true
  fi
}
fail() {
  log "BACKUP FAILED: $1" >&2
  notify "Backup FAILED: $1"
  exit 1
}

[ -d "$PRODUCTION_DIR" ] || fail "No production/ folder found at $PRODUCTION_DIR -- nothing to back up yet."
command -v node >/dev/null 2>&1 || fail "node not found on PATH."
mkdir -p "$OUTPUT_DIR" || fail "Can't create $OUTPUT_DIR."

PASSPHRASE="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a backup -w 2>/dev/null || true)"
if [ -z "$PASSPHRASE" ] && [ "$SCHEDULED" = 1 ]; then
  fail "No backup passphrase saved. Run: npm run backup:passphrase"
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
STAGE="$(mktemp -d -t tutoring-backup-stage)"
TMP_TAR="$(mktemp -t tutoring-backup).tar.gz"
OUTPUT_FILE="$OUTPUT_DIR/tutoring-backup-$STAMP.tar.gz.enc"

cleanup() { rm -f "$TMP_TAR"; rm -rf "$STAGE"; }
trap cleanup EXIT

# Only the current, real data -- not the on-disk backups/ history (that's a
# separate, same-machine safety net; this is the off-machine one). Each
# database goes in as a proper SQLite snapshot rather than a raw copy of
# <name>.db + <name>.db-wal, so it's consistent even if the server is
# running and saving right now.
mkdir -p "$STAGE/production"
find "$PRODUCTION_DIR" -maxdepth 1 -type f ! -name '*.db' ! -name '*.db-wal' ! -name '*.db-shm' -exec cp -p {} "$STAGE/production/" \;
for db in "$PRODUCTION_DIR"/*.db; do
  [ -f "$db" ] || continue
  node "$SCRIPT_DIR/db/snapshot.js" "$db" "$STAGE/production/$(basename "$db")" || fail "Could not snapshot $(basename "$db")."
done
tar -czf "$TMP_TAR" -C "$STAGE" production

if [ -n "$PASSPHRASE" ]; then
  log "Encrypting with the passphrase saved in your Keychain."
  TT_PASS="$PASSPHRASE" openssl enc -aes-256-cbc -pbkdf2 -salt -pass env:TT_PASS -in "$TMP_TAR" -out "$OUTPUT_FILE" \
    || fail "Encryption failed."
  # Prove the file can actually be restored: decrypt it again and check
  # the archive inside is intact and contains the database.
  # (Listing to a file first, not straight into `grep -q`: with pipefail,
  # grep exiting early would make tar fail and wrongly reject a good backup.)
  LISTING="$STAGE/listing.txt"
  if ! TT_PASS="$PASSPHRASE" openssl enc -d -aes-256-cbc -pbkdf2 -salt -pass env:TT_PASS -in "$OUTPUT_FILE" \
    | tar -tzf - >"$LISTING" || ! grep -qx 'production/tutoring.db' "$LISTING"; then
    rm -f "$OUTPUT_FILE"
    fail "The new backup didn't decrypt cleanly -- it was deleted, nothing else changed."
  fi
  log "Verified: the backup decrypts and contains the database."
else
  echo "Encrypting backup -- enter a passphrase (you'll type it twice)."
  echo "Write this passphrase down somewhere safe and separate from the backup file. Without it, the backup can never be restored."
  echo "(Tip: npm run backup:passphrase saves it in your Keychain, so you won't be asked again and daily backups can run.)"
  openssl enc -aes-256-cbc -pbkdf2 -salt -in "$TMP_TAR" -out "$OUTPUT_FILE"
fi

log "Backup saved: $OUTPUT_FILE"

# Keep this Mac from filling up with years of daily backups.
ls -1t "$OUTPUT_DIR"/tutoring-backup-*.tar.gz.enc 2>/dev/null | tail -n +$((KEEP_LOCAL + 1)) | while read -r old; do
  rm -f "$old"
done

if [ -f "$SCRIPT_DIR/gdrive-credentials.json" ]; then
  if node "$SCRIPT_DIR/gdrive-upload.js" "$OUTPUT_FILE"; then
    exit 0
  fi
  [ "$SCHEDULED" = 1 ] && fail "Saved on this Mac, but the Google Drive upload failed."
elif [ "$SCHEDULED" = 1 ]; then
  log "Google Drive not connected (npm run gdrive-auth) -- backup kept on this Mac only."
  notify "Backup saved on this Mac only -- Google Drive isn't connected yet."
  exit 0
fi

echo "Opening its Finder location and your Google Drive folder -- drag the"
echo "file from one window into the other to finish uploading it."
if command -v open >/dev/null 2>&1; then
  open -R "$OUTPUT_FILE"
  open "$DRIVE_FOLDER_URL"
fi
