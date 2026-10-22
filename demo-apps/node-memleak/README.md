# node-memleak

**Bug:** `index.js` keeps every request (about 256 KB each) in the global `requestLog` array and never
evicts it. Memory grows steadily until the container is OOM-killed (`exit code 137` /
`JavaScript heap out of memory`), then the app restarts and the cycle repeats.

**Reproduce locally:**

```bash
node index.js &
./load.sh http://127.0.0.1:3000 400   # /stats shows entries=400 and heapUsedMb ≈ 100+
```

**Expected agent result:** sees steadily rising memory in metrics plus OOM/restart signals, classifies
it as a resource issue with a leak suspicion, and proposes a `restart_app` (R1) as a short-term fix.
It also points to the unbounded global array as the cause (`code_patch`: cap or evict). Resizing is
offered only with its cost shown (R2).