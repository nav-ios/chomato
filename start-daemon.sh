#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="$SCRIPT_DIR/runtime"
PID_FILE="$RUNTIME_DIR/monitor.pid"
LOG_FILE="$RUNTIME_DIR/monitor.log"
SETTINGS_FILE="$SCRIPT_DIR/state/settings.json"

mkdir -p "$RUNTIME_DIR"

if [[ -f "$PID_FILE" ]]; then
  EXISTING_PID="$(cat "$PID_FILE")"
  if [[ -n "${EXISTING_PID}" ]] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "Monitor already running with PID $EXISTING_PID"
    echo "Log: $LOG_FILE"
    exit 0
  fi
fi

cd "$SCRIPT_DIR"

if ! node -e '
const fs = require("fs");
const path = process.argv[1];
if (!fs.existsSync(path)) process.exit(1);
const s = JSON.parse(fs.readFileSync(path, "utf8"));
const f = s.foodRescue;
if (!f || !f.channelName || !f.client || !f.client.username || !s.selectedAddressName) process.exit(1);
process.exit(0);
' "$SETTINGS_FILE"; then
  echo "Cannot start daemon yet."
  echo "Run 'npm start' once in terminal, complete OTP login, and let it reach 'Starting monitor...'."
  echo "That caches monitor config in state/settings.json. Then run ./start-daemon.sh."
  exit 1
fi

nohup node index.js > "$LOG_FILE" 2>&1 < /dev/null &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"

echo "Monitor started in background"
echo "PID: $NEW_PID"
echo "Log: $LOG_FILE"
