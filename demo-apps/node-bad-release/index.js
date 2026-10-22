const http = require('node:http');
const { price } = require('./lib/pricing');

const PORT = Number(process.env.PORT) || 3000;

http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok', release: 'main' }));
    res.end(JSON.stringify({ total: price([{ qty: 2, unit: 50000 }]) }));
  })
  .listen(PORT, () => console.log(`node-bad-release listening on port ${PORT}`));