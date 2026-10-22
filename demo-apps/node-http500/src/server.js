const http = require('node:http');
const { findOrder, summarize } = require('./orders');

const PORT = Number(process.env.PORT) || 3000;

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') return send(res, 200, { status: 'ok' });
  const m = /^\/api\/orders\/([^/]+)$/.exec(url.pathname);
  if (m) {
    try {
      const order = findOrder(m[1]);
      if (!order) return send(res, 404, { error: 'not found' });
      return send(res, 200, summarize(order));
    } catch (err) {
      console.error(err.stack);
      return send(res, 500, { error: 'internal error' });
    }
  }
  send(res, 404, { error: 'not found' });
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`node-http500 listening on port ${PORT}`));
}

module.exports = { server };