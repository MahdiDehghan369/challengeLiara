# node-build-fail

**Bug:** a TypeScript project whose `start` script runs `node dist/index.js`, but `package.json` has no
`build` script (`tsc`), so `dist/` is never produced. On deploy the app crashes with
`Error: Cannot find module '/app/dist/index.js'` (`MODULE_NOT_FOUND`).

**Reproduce locally:**

```bash
npm start          # → Error: Cannot find module '.../dist/index.js'
npm run build      # → npm error Missing script: "build"
```

**Expected agent result:** the analyzer flags the missing build script before deploy (TypeScript sources +
`start` pointing at `dist/`). After a failed deploy the logs match `node-module-not-found` /
`node-missing-npm-script`. It proposes a `config_file` fix (`"build": "tsc"`, `typescript` available at
build time) and then a redeploy.