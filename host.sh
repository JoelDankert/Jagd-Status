#!/usr/bin/env bash
set -euo pipefail

HOST="${HOST:-10.66.66.1}"
PORT="${PORT:-3067}"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js fehlt"
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm fehlt"
  exit 1
fi

if [ ! -d node_modules ]; then
  npm install
fi

npm run build

exec env HOST="$HOST" PORT="$PORT" node backend/server.js
