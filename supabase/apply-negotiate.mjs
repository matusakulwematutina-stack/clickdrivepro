import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const password = process.env.DATABASE_PASSWORD || process.argv[2];
const sql = fs.readFileSync(path.join(__dirname, 'negotiate-offers.sql'), 'utf8');

const client = new pg.Client({
  host: 'aws-0-eu-west-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.ngcjwhmjontbytzlzzlh',
  password,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  await client.query(sql);
  console.log('negotiate-offers OK');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
