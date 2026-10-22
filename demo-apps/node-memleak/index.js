const http = require('node:http');

const PORT = Number(process.env.PORT) || 3000;
// BUG (intentional): every request appends ~256 KB to a global array that is never trimmed.
const requestLog = [];

http
  .createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/health') return res.end(JSON.stringify({ status: 'ok' }));
    if (req.url === '/stats') {
      const { heapUsed, rss } = process.memoryUsage();
      return res.end(JSON.stringify({ entries: requestLog.length, heapUsedMb: Math.round(heapUsed / 1048576), rssMb: Math.round(rss / 1048576) }));
    }
    requestLog.push({ at: Date.now(), url: req.url, payload: new Array(32 * 1024).fill(requestLog.length) });
    res.end(JSON.stringify({ ok: true, entries: requestLog.length }));
  })
  .listen(PORT, () => console.log(`node-memleak listening on port ${PORT}`));