#!/usr/bin/env bash
# Saves the backup passphrase in your macOS login Keychain, so backups
# (by hand and scheduled) can encrypt without asking. Run it again to
# change the passphrase -- older backups still need the passphrase they
# were made with, so keep the old one too.
#
# Usage: npm run backup:passphrase

set -euo pipefail

KEYCHAIN_SERVICE="${TUTORING_BACKUP_KEYCHAIN_SERVICE:-tutoring-tracker-backup}"

cat <<'EOF'
Choose a passphrase for your encrypted backups (12+ characters).

IMPORTANT: also save it somewhere that is NOT this Mac -- a password
manager, or written down and kept somewhere safe. If this Mac is lost or
its disk fails, the Keychain copy goes with it, and without the
passphrase the backups in Google Drive can never be opened.

EOF

read -r -s -p "Passphrase: " first
echo
read -r -s -p "Same passphrase again: " second
echo

if [ "$first" != "$second" ]; then
  echo "The two didn't match -- nothing was saved." >&2
  exit 1
fi
if [ "${#first}" -lt 12 ]; then
  echo "Please use at least 12 characters -- nothing was saved." >&2
  exit 1
fi

# -U updates it if one is already saved. (It's handed to Apple's Keychain
# tool as an argument for this one instant -- visible only to your own
# user account, never written to disk outside the Keychain.)
security add-generic-password -U -s "$KEYCHAIN_SERVICE" -a backup -l "Tutoring Tracker backup passphrase" -w "$first"
unset first second

echo "Saved in your Keychain (as \"Tutoring Tracker backup passphrase\")."
echo "Next: npm run backup  -- then, for daily automatic backups: npm run backup:schedule"
