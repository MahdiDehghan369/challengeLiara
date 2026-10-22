# node-bad-release

Scenario S9: a broken redeploy that needs an immediate rollback.

- **`main`** (this folder's `index.js` + `lib/`) is healthy.
- **`feature/checkout`** (`branches/feature-checkout/` applied on top) adds `lib/checkout-utils.js` but
  requires `./lib/checkout-utlis` (typo). The process crashes at startup with
  `Error: Cannot find module './lib/checkout-utlis'`.

A nested git repo can't live inside this repository, so `make-repo.sh` builds one:

```bash
./make-repo.sh /tmp/bad-release      # branches: main, feature/checkout
cd /tmp/bad-release
node index.js                        # main → healthy
git checkout feature/checkout
node index.js                        # → Error: Cannot find module './lib/checkout-utlis'
```

**Expected agent result:** deploy `main` (healthy) and then `feature/checkout`. The new release
crash-loops: health fails and the logs match `node-module-not-found` right after the release. The agent
proposes `rollback_app` to the previous release (R2), confirms health is back with `waitForState` and
`/health`, and suggests fixing the require path in the branch.