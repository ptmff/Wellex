#!/usr/bin/env bash
# Build locally and roll out to the prod host (wellex.fun).
# Usage: deploy/deploy.sh [backend|frontend|all]   (default: all)
# "frontend" ships the SPA together with landing/.
set -euo pipefail

HOST="${WELLEX_HOST:-root@157.22.192.92}"
TARGET="${1:-all}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export COPYFILE_DISABLE=1

if [[ "$TARGET" == all || "$TARGET" == backend ]]; then
  (cd "$ROOT/backend" && rm -rf dist && npm run build)
  tar --no-xattrs --exclude='*.map' --exclude='*.d.ts' --exclude=tsconfig.tsbuildinfo \
    -czf "$TMP/backend.tgz" -C "$ROOT/backend" dist package.json package-lock.json
  ssh "$HOST" 'cat > /tmp/wx-backend.tgz' < "$TMP/backend.tgz"
  ssh "$HOST" 'set -e
    cd /opt/wellex/backend
    rm -rf dist && tar -xzf /tmp/wx-backend.tgz && rm /tmp/wx-backend.tgz
    chown -R wellex:wellex /opt/wellex/backend
    sudo -u wellex env PATH=/opt/wellex/node/bin:/usr/bin:/bin HOME=/tmp \
      npm ci --omit=dev --no-audit --no-fund --cache /tmp/wx-npm-cache >/dev/null
    rm -rf /tmp/wx-npm-cache
    systemctl restart wellex-api
    for i in $(seq 1 30); do curl -fs 127.0.0.1:3100/health >/dev/null && break; sleep 1; done
    curl -fs 127.0.0.1:3100/health && echo'
fi

if [[ "$TARGET" == all || "$TARGET" == frontend ]]; then
  (cd "$ROOT/frontend" && npm run build)
  # One web root: SPA build + landing (served at "/" as landing.html, see nginx-wellex.conf)
  mkdir -p "$TMP/web"
  cp -R "$ROOT/frontend/dist/." "$TMP/web/"
  cp "$ROOT/landing/index.html" "$TMP/web/landing.html"
  for f in "$ROOT"/landing/assets/*; do
    [[ -e "$TMP/web/assets/$(basename "$f")" ]] && { echo "asset name clash: $f" >&2; exit 1; }
    cp "$f" "$TMP/web/assets/"
  done
  mkdir -p "$TMP/web/legal" && cp "$ROOT"/landing/legal/*.html "$TMP/web/legal/"
  tar --no-xattrs -czf "$TMP/frontend.tgz" -C "$TMP/web" .
  ssh "$HOST" 'cat > /tmp/wx-frontend.tgz' < "$TMP/frontend.tgz"
  ssh "$HOST" 'set -e
    rm -rf /opt/wellex/frontend.new && mkdir /opt/wellex/frontend.new
    tar -xzf /tmp/wx-frontend.tgz -C /opt/wellex/frontend.new && rm /tmp/wx-frontend.tgz
    rm -rf /opt/wellex/frontend.old
    mv /opt/wellex/frontend /opt/wellex/frontend.old && mv /opt/wellex/frontend.new /opt/wellex/frontend
    echo frontend deployed'
fi
