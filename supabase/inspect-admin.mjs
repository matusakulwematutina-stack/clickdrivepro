import pg from 'pg';

const client = new pg.Client({
  host: 'aws-0-eu-west-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.ngcjwhmjontbytzlzzlh',
  password: process.env.DATABASE_PASSWORD || process.argv[2],
  ssl: { rejectUnauthorized: false },
});

await client.connect();
const tables = await client.query(`
  select table_name from information_schema.tables
  where table_schema='public'
    and table_name in ('sos_alerts','app_settings','service_provinces','withdrawals')
`);
console.log('tables', tables.rows);
for (const t of [
  'sos_alerts',
  'app_settings',
  'service_provinces',
  'withdrawals',
  'profiles',
  'drivers',
]) {
  const cols = await client.query(
    `
    select column_name from information_schema.columns
    where table_schema='public' and table_name=$1
    order by ordinal_position
  `,
    [t],
  );
  if (cols.rows.length) {
    console.log(t + ':', cols.rows.map((r) => r.column_name).join(', '));
  }
}
const roles = await client.query(`select distinct role from public.profiles`);
console.log('roles', roles.rows);
await client.end();
