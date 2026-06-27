#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-10.66.66.1}"
PORT="${PORT:-3067}"

exec python3 server.py --host "$HOST" --port "$PORT"
