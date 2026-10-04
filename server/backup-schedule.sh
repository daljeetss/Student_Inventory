#!/usr/bin/env bash
# Turns daily automatic backups on or off, using macOS's own scheduler
# (launchd) -- nothing to install. Runs backup.sh --scheduled every day at
# 9:00 PM; if the Mac is asleep then, it runs as soon as it wakes. Results
# go to ~/Library/Logs/tutoring-backup.log, and a notification pops up if
# a backup fails.
#
# Usage: npm run backup:schedule      (turn on, or update)
#        npm run backup:unschedule    (turn off)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.marsarsolutions.tutoring-tracker.backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/tutoring-backup.log"
KEYCHAIN_SERVICE="${TUTORING_BACKUP_KEYCHAIN_SERVICE:-tutoring-tracker-backup}"
DOMAIN="gui/$(id -u)"

if [ "${1:-}" = "remove" ]; then
  launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  echo "Daily automatic backups turned off."
  exit 0
fi

if ! security find-generic-password -s "$KEYCHAIN_SERVICE" -a backup >/dev/null 2>&1; then
  echo "Save a backup passphrase first: npm run backup:passphrase" >&2
  exit 1
fi

# launchd starts with a bare PATH and none of your shell setup (nvm), so
# give it the exact node this was set up with.
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "node not found -- run this from a terminal where node works." >&2
  exit 1
fi

mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPT_DIR/backup.sh</string>
    <string>--scheduled</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$(dirname "$NODE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>21</integer>
    <key>Minute</key><integer>0</integer>
  </dict>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
launchctl bootstrap "$DOMAIN" "$PLIST"

echo "Daily automatic backups are on: every day at 9:00 PM (or when the Mac next wakes)."
echo "Log: $LOG"
echo "Run one right now to check: launchctl kickstart $DOMAIN/$LABEL  (then: tail $LOG)"
