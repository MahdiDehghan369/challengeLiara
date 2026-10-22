const express = require('express');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const APP_NAME = process.env.APP_NAME || 'node-express-ok';
const startedAt = new Date();

const items = [
  { id: 1, name: 'alpha' },
  { id: 2, name: 'beta' },
  { id: 3, name: 'gamma' },
];

app.get('/', (_req, res) => {
  res.json({ app: APP_NAME, message: 'Hello from Liara!', startedAt: startedAt.toISOString() });
});

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', uptimeSec: Math.round(process.uptime()) });
});

app.get('/api/items', (_req, res) => {
  res.json({ items });
});

app.listen(PORT, () => {
  console.log(`${APP_NAME} listening on port ${PORT}`);
});
