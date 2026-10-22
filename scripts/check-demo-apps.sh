#!/usr/bin/env bash
# T0.6 — boots each healthy demo app locally and checks it responds.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3999}"

echo "== node-express-ok"
cd "$ROOT/demo-apps/node-express-ok"
npm ci --silent --no-audit --no-fund
PORT="$PORT" node index.js &
PID=$!
trap 'kill $PID 2>/dev/null || true' EXIT

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then break; fi
  sleep 0.3
done
code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/health")"
[ "$code" = "200" ] || { echo "health returned $code"; exit 1; }
curl -fsS "http://127.0.0.1:$PORT/api/items" >/dev/null
echo "node-express-ok: /health 200, /api/items ok"

echo "== static-ok"
test -s "$ROOT/demo-apps/static-ok/index.html"
echo "static-ok: index.html present"

echo "all demo apps OK"
