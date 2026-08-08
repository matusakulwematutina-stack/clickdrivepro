import pg from 'pg';

const password = process.env.DATABASE_PASSWORD || process.argv[2];
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
  const triggers = await client.query(`
    select tgname, pg_get_triggerdef(oid) as def
    from pg_trigger
    where tgrelid = 'auth.users'::regclass
      and not tgisinternal
    order by tgname;
  `);
  console.log('TRIGGERS', JSON.stringify(triggers.rows, null, 2));

  const funcs = await client.query(`
    select p.proname, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','auth')
      and p.proname ilike '%user%'
      or p.proname ilike '%confirm%phone%'
      or p.proname ilike '%handle_new%'
    order by 1;
  `);
  console.log('FUNCS', funcs.rows.map((r) => r.proname));

  // Inspect profiles constraints
  const cons = await client.query(`
    select conname, pg_get_constraintdef(oid) as def
    from pg_constraint
    where conrelid = 'public.profiles'::regclass;
  `);
  console.log('PROFILES_CONSTRAINTS', JSON.stringify(cons.rows, null, 2));

  const cols = await client.query(`
    select column_name, is_nullable, column_default, data_type
    from information_schema.columns
    where table_schema='public' and table_name='profiles'
    order by ordinal_position;
  `);
  console.log('PROFILES_COLS', JSON.stringify(cols.rows, null, 2));
} finally {
  await client.end();
}
