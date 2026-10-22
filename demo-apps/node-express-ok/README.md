# node-express-ok

A healthy Express app used in the deploy demo scenarios (S1, S6) and the T0.8 spike.

- Routes: `GET /` (app info), `GET /health` (200 `{status:"ok"}`), `GET /api/items`
- Port: `PORT` env (default 3000)
- Env: `APP_NAME` (optional, see `.env.example`)

```bash
npm install
npm start
curl http://localhost:3000/health
```
