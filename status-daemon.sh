#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PID_FILE="$SCRIPT_DIR/runtime/monitor.pid"
LOG_FILE="$SCRIPT_DIR/runtime/monitor.log"

if [[ -f "$PID_FILE" ]]; then
  PID="$(cat "$PID_FILE")"
  if [[ -n "${PID}" ]] && kill -0 "$PID" 2>/dev/null; then
    echo "Monitor is running. PID: $PID"
    echo "Log: $LOG_FILE"
    exit 0
  fi
fi

echo "Monitor is not running."
exit 1
