const http = require('node:http');

const PORT = Number(process.env.PORT) || 3000;
const WORK_MS = Number(process.env.WORK_MS) || 400;

// BUG (intentional): a synchronous busy loop on the request path blocks the event loop,
// so every concurrent request (including /health) waits behind it.
function buildReport() {
  const until = Date.now() + WORK_MS;
  let x = 0;
  while (Date.now() < until) x += Math.sqrt(x + 1);
  return { rows: 1000, checksum: Math.round(x) % 1000 };
}

http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok' }));
    if (req.url === '/api/report') return res.end(JSON.stringify(buildReport()));
    res.end(JSON.stringify({ app: 'node-slow' }));
  })
  .listen(PORT, () => console.log(`node-slow listening on port ${PORT}`));