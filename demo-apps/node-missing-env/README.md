# node-missing-env

**Bug:** `index.js` runs `new URL(process.env.DATABASE_URL)` at startup. Without the variable the
process crashes immediately with `TypeError: Invalid URL` (`ERR_INVALID_URL`) and the app restarts in a loop.

**Reproduce locally:**

```bash
node index.js          # → TypeError [ERR_INVALID_URL]: Invalid URL, exit code 1
DATABASE_URL=postgres://u:p@localhost:5432/db node index.js   # → listening
```

**Expected agent result:** reads the crash logs, recognises the startup crash on `DATABASE_URL`
(knowledge pattern + stack in `index.js:4`), proposes `set_env DATABASE_URL` (R2, secret-like name)
and, once approved, restarts and confirms `/health` is 200.