#!/usr/bin/env bash
# Restores a backup made by backup.sh. This OVERWRITES the current
# production/ folder, so it makes its own safety copy first (see below)
# before touching anything real.
#
# Usage:  npm run restore -- /path/to/tutoring-backup-<timestamp>.tar.gz.enc

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")"
PRODUCTION_DIR="$APP_DIR/production"

BACKUP_FILE="${1:-}"
if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "Usage: npm run restore -- /path/to/tutoring-backup-<timestamp>.tar.gz.enc" >&2
  exit 1
fi

TMP_TAR="$(mktemp -t tutoring-restore).tar.gz"
TMP_EXTRACT="$(mktemp -d -t tutoring-restore-extract)"
cleanup() { rm -f "$TMP_TAR"; rm -rf "$TMP_EXTRACT"; }
trap cleanup EXIT

echo "Enter the passphrase this backup was encrypted with:"
openssl enc -d -aes-256-cbc -pbkdf2 -salt -in "$BACKUP_FILE" -out "$TMP_TAR"

tar -xzf "$TMP_TAR" -C "$TMP_EXTRACT"
if [ ! -d "$TMP_EXTRACT/production" ]; then
  echo "That backup didn't contain a production/ folder -- stopping without changing anything." >&2
  exit 1
fi

# Never overwrite real data without a safety copy of what was there first.
if [ -d "$PRODUCTION_DIR" ]; then
  SAFETY_DIR="$APP_DIR/production-before-restore-$(date +%Y%m%d-%H%M%S)"
  echo "Moving current production/ to $SAFETY_DIR first, just in case."
  mv "$PRODUCTION_DIR" "$SAFETY_DIR"
fi

mv "$TMP_EXTRACT/production" "$PRODUCTION_DIR"

echo ""
echo "Restored into: $PRODUCTION_DIR"
echo "Restart \"npm run serve\" to pick it up."
