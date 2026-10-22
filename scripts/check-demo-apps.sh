#!/usr/bin/env bash
# T0.6 — boots each healthy demo app locally and checks it responds.
# T11.1 — reproduces the bug of each buggy demo app locally.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-3999}"
BASE="http://127.0.0.1:$PORT"
PID=""
TMP="$(mktemp -d)"
cleanup() {
  [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

# start <entry> [env...]: starts a server in the background and waits for /health
start() {
  local entry="$1"; shift
  env PORT="$PORT" "$@" node "$entry" >"$TMP/out.log" 2>"$TMP/err.log" &
  PID=$!
  for _ in $(seq 1 30); do
    if curl -fsS "$BASE/health" >/dev/null 2>&1; then return 0; fi
    sleep 0.3
  done
  fail "$entry did not become healthy"
}
stop() { kill "$PID" 2>/dev/null || true; wait "$PID" 2>/dev/null || true; PID=""; }

# expect_crash <log-pattern> <cmd...>: command must exit non-zero and print the pattern
expect_crash() {
  local pattern="$1"; shift
  if "$@" >"$TMP/crash.log" 2>&1; then fail "expected a crash: $*"; fi
  grep -q -- "$pattern" "$TMP/crash.log" || { cat "$TMP/crash.log" >&2; fail "missing '$pattern' in output of: $*"; }
}

# ---------------------------------------------------------------- healthy apps
echo "== node-express-ok"
cd "$ROOT/demo-apps/node-express-ok"
npm ci --silent --no-audit --no-fund
start index.js
code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE/health")"
[ "$code" = "200" ] || fail "health returned $code"
curl -fsS "$BASE/api/items" >/dev/null
stop
echo "node-express-ok: /health 200, /api/items ok"

echo "== static-ok"
test -s "$ROOT/demo-apps/static-ok/index.html"
echo "static-ok: index.html present"

# ---------------------------------------------------------------- buggy apps
echo "== node-missing-env"
cd "$ROOT/demo-apps/node-missing-env"
expect_crash "Invalid URL" env -u DATABASE_URL node index.js
start index.js DATABASE_URL=postgres://u:p@localhost:5432/db
stop
echo "node-missing-env: crashes without DATABASE_URL, healthy with it"

echo "== node-http500"
cd "$ROOT/demo-apps/node-http500"
start src/server.js
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/orders/1")" = "200" ] || fail "order 1 should be 200"
[ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/orders/2")" = "500" ] || fail "order 2 should be 500"
sleep 0.2
grep -q "reading 'length'" "$TMP/err.log" || fail "TypeError not logged"
stop
expect_crash "fail 1" npm test --silent
echo "node-http500: /api/orders/2 → 500 with TypeError; unit test fails until fixed"

echo "== node-memleak"
cd "$ROOT/demo-apps/node-memleak"
start index.js
before="$(curl -fsS "$BASE/stats" | sed -E 's/.*"heapUsedMb":([0-9]+).*/\1/')"
for i in $(seq 1 200); do curl -fsS "$BASE/api/data?i=$i" >/dev/null; done
after="$(curl -fsS "$BASE/stats" | sed -E 's/.*"heapUsedMb":([0-9]+).*/\1/')"
stop
[ "$((after - before))" -ge 30 ] || fail "heap grew only ${before}→${after} MB"
echo "node-memleak: heap ${before} → ${after} MB after 200 requests"

echo "== node-slow"
cd "$ROOT/demo-apps/node-slow"
start index.js
t="$(curl -s -o /dev/null -w '%{time_total}' "$BASE/api/report")"
stop
awk -v t="$t" 'BEGIN { exit !(t >= 0.3) }' || fail "report took only ${t}s"
echo "node-slow: /api/report took ${t}s (blocking loop)"

echo "== node-db"
cd "$ROOT/demo-apps/node-db"
npm ci --silent --no-audit --no-fund
# ECONNREFUSED without a local Postgres; another connection error if one is running — either way it exits 1
if env -u DATABASE_URL node index.js >"$TMP/crash.log" 2>&1; then fail "node-db should crash without a database"; fi
grep -Eq "ECONNREFUSED|does not exist|authentication failed" "$TMP/crash.log" || { cat "$TMP/crash.log" >&2; fail "unexpected node-db error"; }
echo "node-db: crashes without a reachable database"

echo "== node-build-fail"
cd "$ROOT/demo-apps/node-build-fail"
rm -rf dist
expect_crash "Cannot find module" node dist/index.js
expect_crash "Missing script" npm run build
echo "node-build-fail: no build script, dist/index.js missing"

echo "== node-bad-release"
"$ROOT/demo-apps/node-bad-release/make-repo.sh" "$TMP/bad-release" >/dev/null
cd "$TMP/bad-release"
start index.js
stop
git checkout -q feature/checkout
expect_crash "Cannot find module './lib/checkout-utlis'" node index.js
git checkout -q main
echo "node-bad-release: main healthy, feature/checkout crashes at startup"

echo "all demo apps OK"
