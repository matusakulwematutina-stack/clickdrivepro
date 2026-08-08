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
  where table_schema='public' and table_name ilike '%offer%'
`);
console.log('TABLES', tables.rows);

for (const t of tables.rows.map((r) => r.table_name)) {
  const cols = await client.query(
    `select column_name, udt_name from information_schema.columns
     where table_schema='public' and table_name=$1 order by ordinal_position`,
    [t],
  );
  console.log(t, cols.rows);
}
await client.end();
