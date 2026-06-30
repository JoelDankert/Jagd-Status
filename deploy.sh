#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ARCHIVE="/tmp/jagdapp_deploy.tar.gz"
ASKPASS="$(mktemp /tmp/ssh-askpass-jagdapp.XXXXXX)"
SERVER="${JAGDAPP_DEPLOY_SERVER:-root@45.129.181.8}"
TARGET="${JAGDAPP_DEPLOY_TARGET:-/opt/jagdapp}"

if [[ -z "${JAGDAPP_SSH_PASSWORD:-}" ]]; then
  echo "Set JAGDAPP_SSH_PASSWORD before running deploy.sh" >&2
  exit 2
fi

cleanup() {
  rm -f "$ARCHIVE" "$ASKPASS"
}
trap cleanup EXIT

npm run build

cat > "$ASKPASS" <<ASKPASS_EOF
#!/bin/sh
echo "\$JAGDAPP_SSH_PASSWORD"
ASKPASS_EOF
chmod 700 "$ASKPASS"

export JAGDAPP_SSH_PASSWORD
export SSH_ASKPASS="$ASKPASS"
export SSH_ASKPASS_REQUIRE=force
export DISPLAY="${DISPLAY:-:0}"

tar czf "$ARCHIVE" -C "$ROOT_DIR" frontend/dist backend
cat "$ARCHIVE" | setsid ssh -o StrictHostKeyChecking=accept-new "$SERVER" "tar xz -C '$TARGET' && systemctl restart jagdapp"
echo "DONE"
