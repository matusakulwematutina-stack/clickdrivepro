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

const sql = fs.readFileSync(path.join(__dirname, 'migrate-admin.sql'), 'utf8');

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
  const provinces = await client.query(
    `select count(*)::int as n from public.service_provinces`,
  );
  const settings = await client.query(
    `select active_province_code, zone_radius_km, commission_percent from public.app_settings where id=1`,
  );
  console.log('migrate-admin OK');
  console.log('provinces:', provinces.rows[0].n);
  console.log('settings:', settings.rows[0]);
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
