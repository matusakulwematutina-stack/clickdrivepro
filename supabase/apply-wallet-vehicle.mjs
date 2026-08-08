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
  path.join(__dirname, 'migrate-wallet-vehicle.sql'),
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
  const settings = await client.query(
    `select min_driver_balance_fc, commission_percent, commission_enabled
     from public.app_settings where id=1`,
  );
  const cols = await client.query(`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='drivers'
      and column_name in ('license_number','board_document_ref','wallet_balance')
  `);
  console.log('migrate-wallet-vehicle OK');
  console.log('settings:', settings.rows[0]);
  console.log('driver cols:', cols.rows.map((r) => r.column_name).join(', '));
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
