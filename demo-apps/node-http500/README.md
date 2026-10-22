# node-http500

**Bug:** `GET /api/orders/2` returns HTTP 500. Order `2` has no `items`, and `summarize()` in
`src/orders.js` reads `order.items.length`, giving
`TypeError: Cannot read properties of undefined (reading 'length')`. Orders `1` and `3` work.

`npm test` contains a unit test that shows the bug. It **fails until the bug is fixed**.

**Reproduce locally:**

```bash
npm start &
curl -i localhost:3000/api/orders/1   # 200
curl -i localhost:3000/api/orders/2   # 500, stack trace in stderr
npm test                              # 1 failing test
```

**Expected agent result (S5/S10):** clusters the 500s into one error signature, maps the top user frame
to `src/orders.js` (`summarize`), gathers context and proposes a `code_patch` (default `items` to `[]`).
After the fix `npm test` passes. A rollback is offered only if the error started with the latest release.