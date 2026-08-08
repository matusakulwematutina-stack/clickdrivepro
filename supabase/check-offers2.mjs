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
const fk = await client.query(`
  select conname, pg_get_constraintdef(oid) as def
  from pg_constraint
  where conrelid = 'public.ride_offers'::regclass
`);
console.log('FK', fk.rows);

const rr = await client.query(`
  select column_name, udt_name from information_schema.columns
  where table_schema='public' and table_name='ride_requests'
  order by ordinal_position
`);
console.log('ride_requests', rr.rows);

const enums = await client.query(`
  select enumlabel from pg_enum e
  join pg_type t on t.oid=e.enumtypid
  where t.typname='ride_offer_status' order by enumsortorder
`);
console.log('offer_status', enums.rows);
await client.end();
