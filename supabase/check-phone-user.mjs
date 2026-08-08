import pg from 'pg';

const phone = process.argv[2] || '+243970256585';
const password = process.env.DATABASE_PASSWORD;
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
  const profiles = await client.query(
    `select id, full_name, phone, role from public.profiles
     where phone = $1 or replace(phone,'+','') = replace($1,'+','')`,
    [phone],
  );
  console.log('PROFILE', profiles.rows);

  const email = `${phone.replace('+','')}@phone.clickpro.drive`;
  const users = await client.query(
    `select id, email, email_confirmed_at, created_at, last_sign_in_at
     from auth.users
     where email = $1 or phone = $2 or id = any($3::uuid[])`,
    [email, phone, profiles.rows.map((r) => r.id)],
  );
  console.log('AUTH', users.rows);
  console.log('EXPECTED_EMAIL', email);
} finally {
  await client.end();
}
