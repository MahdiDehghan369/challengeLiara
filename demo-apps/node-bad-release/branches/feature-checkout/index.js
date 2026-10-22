const http = require('node:http');
const { price } = require('./lib/pricing');
// BUG (intentional): the file is lib/checkout-utils.js; `checkout-utlis` (typo) does not exist.
const { applyDiscount } = require('./lib/checkout-utlis');

const PORT = Number(process.env.PORT) || 3000;

http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok', release: 'feature/checkout' }));
    res.end(JSON.stringify({ total: applyDiscount(price([{ qty: 2, unit: 50000 }]), 0.1) }));
  })
  .listen(PORT, () => console.log(`node-bad-release listening on port ${PORT}`));