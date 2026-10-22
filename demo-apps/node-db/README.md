# node-db

**Bug:** the app needs PostgreSQL but defaults to `127.0.0.1:5432` when `DATABASE_URL` is unset. On
Liara there is no database inside the app container, so startup fails with
`Error: connect ECONNREFUSED 127.0.0.1:5432` and the app crash-loops.

**Reproduce locally (with no Postgres running):**

```bash
npm install
node index.js      # → Error: connect ECONNREFUSED 127.0.0.1:5432, exit code 1
```

If a local Postgres happens to be running, it fails instead with `database "app" does not exist` or an
auth error. Either way the process exits with code 1.

With a reachable database (`DATABASE_URL=postgres://...`) it serves `/` (visit counter) and `/health`.

**Expected agent result:** matches the `db-econnrefused-localhost-postgres` knowledge pattern and
explains that the database is a separate service. It proposes creating or using a Liara Postgres
(R2, cost shown) and then `set_env DATABASE_URL` (R2, secret). After a restart it confirms `/health` is 200.