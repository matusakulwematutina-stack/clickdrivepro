/**
 * Promouvoir un profil existant en admin.
 * Usage: node supabase/promote-admin.mjs +243970000000
 */
import pg from 'pg';

const phoneArg = process.argv[2];
const password = process.env.DATABASE_PASSWORD || process.argv[3];
if (!phoneArg || !password) {
  console.error('Usage: DATABASE_PASSWORD=xxx node supabase/promote-admin.mjs +2439...');
  process.exit(1);
}

const digits = phoneArg.replace(/\D/g, '');
const variants = [
  phoneArg,
  `+${digits}`,
  digits,
  digits.startsWith('243') ? `+${digits}` : `+243${digits.replace(/^0+/, '')}`,
];

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
  const { rows } = await client.query(
    `select id, full_name, phone, role from public.profiles
     where phone = any($1::text[])
     order by updated_at desc nulls last
     limit 5`,
    [variants],
  );
  if (!rows.length) {
    console.error('Aucun profil trouvé pour', phoneArg);
    process.exitCode = 1;
    return;
  }
  const p = rows[0];
  await client.query(
    `update public.profiles set role = 'super_admin' where id = $1`,
    [p.id],
  );
  console.log('ADMIN OK:', p.full_name || p.phone, p.id, '(was', p.role + ')');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
