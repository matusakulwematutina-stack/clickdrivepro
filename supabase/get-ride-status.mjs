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
const e = await client.query(`
  select t.typname, e.enumlabel
  from pg_type t
  join pg_enum e on e.enumtypid = t.oid
  where t.typname ilike '%ride%status%' or t.typname ilike '%status%'
  order by t.typname, e.enumsortorder
`);
console.log(e.rows);

const cols = await client.query(`
  select column_name, udt_name, data_type
  from information_schema.columns
  where table_schema='public' and table_name='rides'
  order by ordinal_position
`);
console.log('RIDES', cols.rows);
await client.end();
