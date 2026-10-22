const http = require('node:http');

// BUG (intentional): no check for a missing variable — `new URL(undefined)` throws at startup.
const dbUrl = new URL(process.env.DATABASE_URL);
const PORT = Number(process.env.PORT) || 3000;

http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok', db: dbUrl.hostname }));
    res.end(JSON.stringify({ app: 'node-missing-env' }));
  })
  .listen(PORT, () => console.log(`node-missing-env listening on port ${PORT}`));