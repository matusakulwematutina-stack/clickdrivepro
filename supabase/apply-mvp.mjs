/**
 * Applique schema.sql via le pooler Supabase.
 * Usage: node supabase/apply-mvp.mjs
 * Mot de passe: variable DATABASE_PASSWORD ou argument CLI.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const password = process.env.DATABASE_PASSWORD || process.argv[2];

if (!password) {
  console.error('Usage: DATABASE_PASSWORD=xxx node supabase/apply-mvp.mjs');
  process.exit(1);
}

const sqlPath = path.join(__dirname, 'schema.sql');
let sql = fs.readFileSync(sqlPath, 'utf8');

// Realtime: ignorer si déjà présent
sql += `
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.rides;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
`;

// Retirer les lignes alter publication brutes du fichier (gérées ci-dessus)
sql = sql
  .replace(/alter publication supabase_realtime add table public\.rides;/gi, '')
  .replace(/alter publication supabase_realtime add table public\.drivers;/gi, '');

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
  console.log('Schema MVP appliqué avec succès.');
} catch (e) {
  console.error('Erreur SQL:', e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
