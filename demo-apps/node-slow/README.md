# node-slow

**Bug:** `GET /api/report` runs a synchronous busy loop (`WORK_MS`, default 400 ms) on the event loop.
Under load, p95 latency climbs well past the budget and `/health` also slows down, because it waits
behind the blocked loop. CPU sits near 100%.

**Reproduce locally:**

```bash
node index.js &
time curl -s localhost:3000/api/report    # ≈ 0.4 s per request
for i in $(seq 1 5); do curl -s localhost:3000/api/report & done; time curl -s localhost:3000/health   # health waits behind the blocked loop
```

**Expected agent result:** health probing shows high p95 with no errors, and metrics show CPU near
saturation. The agent classifies it as a resource or code issue (CPU-bound handler) and points to
`buildReport` as the cause (`code_patch`: make it async, cache or offload it). It may offer `resize_app`
with its cost shown (R2), but notes that a resize only helps temporarily.