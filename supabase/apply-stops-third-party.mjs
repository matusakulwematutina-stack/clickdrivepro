import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const password = process.env.DATABASE_PASSWORD || process.argv[2];
if (!password) {
  console.error('DATABASE_PASSWORD required');
  process.exit(1);
}

const sql = fs.readFileSync(
  path.join(__dirname, 'migrate-stops-third-party.sql'),
  'utf8',
);

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
  const cols = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'rides'
      and column_name in (
        'stops', 'stops_done', 'for_third_party',
        'passenger_name', 'passenger_phone'
      )
    order by column_name
  `);
  console.log('migrate-stops-third-party OK');
  console.log(
    'columns:',
    cols.rows.map((r) => r.column_name).join(', '),
  );
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
