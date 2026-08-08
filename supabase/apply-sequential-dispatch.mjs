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

const sql = fs.readFileSync(
  path.join(__dirname, 'migrate-sequential-dispatch.sql'),
  'utf8',
);
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
  // Also clear dispatch fields on accept
  await client.query(`
    create or replace function public.accept_ride_offer(p_offer_id uuid)
    returns jsonb
    language plpgsql
    security definer
    set search_path = public
    as $$
    declare
      off public.ride_offers%rowtype;
      r public.rides%rowtype;
      v_price numeric;
    begin
      if auth.uid() is null then raise exception 'Not authenticated'; end if;
      select * into off from public.ride_offers where id = p_offer_id for update;
      if off.id is null then raise exception 'Offre introuvable'; end if;
      if off.status <> 'pending' then raise exception 'Offre déjà traitée'; end if;
      select * into r from public.rides where id = off.ride_id for update;
      if r.client_id <> auth.uid() then raise exception 'Seul le client peut accepter'; end if;
      if r.status not in ('requested', 'offered') then
        raise exception 'Course non disponible pour négociation';
      end if;
      v_price := off.offered_price_cents;
      update public.ride_offers set status = 'declined', updated_at = now()
        where ride_id = r.id and id <> off.id and status = 'pending';
      update public.ride_offers set status = 'selected', updated_at = now() where id = off.id;
      update public.rides set
        driver_id = off.driver_id,
        status = 'accepted',
        estimated_price = v_price,
        final_price = v_price,
        offered_to_driver_id = off.driver_id,
        dispatch_expires_at = null,
        client_response_expires_at = null,
        accepted_at = now(),
        updated_at = now()
      where id = r.id;
      update public.drivers
        set is_available = false, status = 'busy', updated_at = now()
        where id = off.driver_id;
      return jsonb_build_object('ride_id', r.id, 'driver_id', off.driver_id, 'price', v_price);
    end;
    $$;
    grant execute on function public.accept_ride_offer(uuid) to authenticated;
  `);
  console.log('migrate-sequential-dispatch OK');
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
