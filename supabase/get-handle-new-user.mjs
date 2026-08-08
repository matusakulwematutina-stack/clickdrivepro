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
const r = await client.query(
  `select pg_get_functiondef('public.handle_new_user'::regproc) as def`,
);
console.log(r.rows[0].def);
const e = await client.query(`
  select enumlabel from pg_enum e
  join pg_type t on t.oid = e.enumtypid
  where t.typname = 'user_role'
  order by enumsortorder
`);
console.log('ENUM', e.rows);
await client.end();
