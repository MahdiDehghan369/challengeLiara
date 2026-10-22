const http = require('node:http');
const { Client } = require('pg');

const PORT = Number(process.env.PORT) || 3000;
// BUG (intentional): silently falls back to a local database that does not exist on Liara.
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@127.0.0.1:5432/app';

async function main() {
  const db = new Client({ connectionString: DATABASE_URL, connectionTimeoutMillis: 5000 });
  await db.connect();
  await db.query('CREATE TABLE IF NOT EXISTS visits (id serial PRIMARY KEY, at timestamptz DEFAULT now())');

  http
    .createServer(async (req, res) => {
      res.setHeader('content-type', 'application/json');
      try {
        if (req.url === '/health') {
          await db.query('SELECT 1');
          return res.end(JSON.stringify({ status: 'ok' }));
        }
        await db.query('INSERT INTO visits DEFAULT VALUES');
        const { rows } = await db.query('SELECT count(*)::int AS n FROM visits');
        res.end(JSON.stringify({ visits: rows[0].n }));
      } catch (err) {
        console.error(err.stack);
        res.statusCode = 500;
        res.end(JSON.stringify({ error: 'database error' }));
      }
    })
    .listen(PORT, () => console.log(`node-db listening on port ${PORT}`));
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});