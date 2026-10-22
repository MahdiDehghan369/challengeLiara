import http from 'node:http';

const PORT: number = Number(process.env.PORT) || 3000;

http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok' }));
    res.end(JSON.stringify({ app: 'node-build-fail' }));
  })
  .listen(PORT, () => console.log(`node-build-fail listening on port ${PORT}`));