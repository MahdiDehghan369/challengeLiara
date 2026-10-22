#!/usr/bin/env bash
# Sends N requests to grow memory: ./load.sh [base-url] [count]
set -euo pipefail
BASE="${1:-http://127.0.0.1:3000}"
COUNT="${2:-2000}"
for i in $(seq 1 "$COUNT"); do
  curl -fsS "$BASE/api/data?i=$i" >/dev/null
done
curl -fsS "$BASE/stats"; echo