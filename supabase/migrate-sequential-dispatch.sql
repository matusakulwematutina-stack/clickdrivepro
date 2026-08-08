-- Dispatch séquentiel : 1 chauffeur à la fois (priorité distance)
-- + délais réglables admin (sonnerie chauffeur / réponse client / recherche totale)

-- ─── Réglages admin ─────────────────────────────────────────────
alter table public.app_settings
  add column if not exists driver_ring_seconds integer not null default 30;
alter table public.app_settings
  add column if not exists client_response_seconds integer not null default 45;
alter table public.app_settings
  add column if not exists search_duration_seconds integer not null default 600;

alter table public.app_settings drop constraint if exists app_settings_driver_ring_check;
alter table public.app_settings
  add constraint app_settings_driver_ring_check
  check (driver_ring_seconds between 10 and 300);

alter table public.app_settings drop constraint if exists app_settings_client_response_check;
alter table public.app_settings
  add constraint app_settings_client_response_check
  check (client_response_seconds between 15 and 600);

alter table public.app_settings drop constraint if exists app_settings_search_duration_check;
alter table public.app_settings
  add constraint app_settings_search_duration_check
  check (search_duration_seconds between 60 and 7200);

-- ─── Colonnes course ────────────────────────────────────────────
alter table public.rides
  add column if not exists offered_to_driver_id uuid references public.drivers(id);
alter table public.rides
  add column if not exists dispatch_expires_at timestamptz;
alter table public.rides
  add column if not exists client_response_expires_at timestamptz;
alter table public.rides
  add column if not exists search_expires_at timestamptz;
alter table public.rides
  add column if not exists dispatch_tried_ids uuid[] not null default '{}';
alter table public.rides
  add column if not exists dispatch_round integer not null default 0;

create index if not exists rides_offered_to_driver_idx
  on public.rides (offered_to_driver_id, status)
  where offered_to_driver_id is not null;

-- ─── Helpers timing ─────────────────────────────────────────────
create or replace function public.setting_driver_ring_seconds()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select driver_ring_seconds from public.app_settings where id = 1), 30);
$$;

create or replace function public.setting_client_response_seconds()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select client_response_seconds from public.app_settings where id = 1), 45);
$$;

create or replace function public.setting_search_duration_seconds()
returns integer language sql stable security definer set search_path = public as $$
  select coalesce((select search_duration_seconds from public.app_settings where id = 1), 600);
$$;

-- ─── Dispatch : prochain chauffeur (plus proche non essayé) ──────
-- (utilise public.haversine_km déjà présent — retour numeric)
drop function if exists public.dispatch_next_driver(uuid);
create or replace function public.dispatch_next_driver(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rides%rowtype;
  v_driver_id uuid;
  v_ring int;
  v_radius numeric;
  v_search int;
begin
  select * into r from public.rides where id = p_ride_id for update;
  if not found then
    raise exception 'Course introuvable';
  end if;

  if r.status not in ('requested', 'offered') then
    return jsonb_build_object('ok', false, 'reason', 'status', 'status', r.status);
  end if;

  if r.driver_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_assigned');
  end if;

  v_search := public.setting_search_duration_seconds();
  if r.search_expires_at is null then
    update public.rides
      set search_expires_at = now() + make_interval(secs => v_search)
      where id = r.id
      returning * into r;
  end if;

  if r.search_expires_at is not null and r.search_expires_at < now() then
    update public.rides
      set status = 'no_driver_found',
          offered_to_driver_id = null,
          dispatch_expires_at = null,
          client_response_expires_at = null,
          updated_at = now()
      where id = r.id;
    return jsonb_build_object('ok', false, 'reason', 'search_expired');
  end if;

  -- Marquer le chauffeur courant comme essayé
  if r.offered_to_driver_id is not null then
    update public.rides
      set dispatch_tried_ids = array_append(
            coalesce(dispatch_tried_ids, '{}'),
            r.offered_to_driver_id
          )
      where id = r.id
        and not (r.offered_to_driver_id = any (coalesce(dispatch_tried_ids, '{}')));
    select * into r from public.rides where id = p_ride_id;
  end if;

  -- Refuser offres pending du tour précédent
  update public.ride_offers
    set status = 'declined', updated_at = now()
    where ride_id = r.id and status = 'pending';

  v_radius := coalesce(
    (select zone_radius_km from public.app_settings where id = 1),
    60
  );
  v_ring := public.setting_driver_ring_seconds();

  select d.id into v_driver_id
  from public.drivers d
  where d.is_online = true
    and coalesce(d.is_available, true) = true
    and coalesce(d.is_enabled, true) = true
    and d.lat is not null and d.lng is not null
    and d.vehicle_type = r.vehicle_type
    and not (d.id = any (coalesce(r.dispatch_tried_ids, '{}')))
    and public.haversine_km(d.lat, d.lng, r.pickup_lat, r.pickup_lng) <= v_radius
  order by public.haversine_km(d.lat, d.lng, r.pickup_lat, r.pickup_lng) asc
  limit 1;

  if v_driver_id is null then
    update public.rides
      set status = 'no_driver_found',
          offered_to_driver_id = null,
          dispatch_expires_at = null,
          client_response_expires_at = null,
          updated_at = now()
      where id = r.id;
    return jsonb_build_object('ok', false, 'reason', 'no_driver');
  end if;

  update public.rides
    set status = 'offered',
        offered_to_driver_id = v_driver_id,
        dispatch_expires_at = now() + make_interval(secs => v_ring),
        client_response_expires_at = null,
        dispatch_round = coalesce(dispatch_round, 0) + 1,
        updated_at = now()
    where id = r.id;

  return jsonb_build_object(
    'ok', true,
    'driver_id', v_driver_id,
    'ring_seconds', v_ring,
    'dispatch_expires_at', (now() + make_interval(secs => v_ring))
  );
end;
$$;

grant execute on function public.dispatch_next_driver(uuid) to authenticated, service_role;

-- Démarrer le dispatch après création course
drop function if exists public.start_ride_dispatch(uuid);
create or replace function public.start_ride_dispatch(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rides%rowtype;
begin
  select * into r from public.rides where id = p_ride_id;
  if not found then raise exception 'Course introuvable'; end if;
  if r.client_id is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Non autorisé';
  end if;
  if r.status not in ('requested', 'offered') then
    return jsonb_build_object('ok', false, 'reason', 'bad_status');
  end if;

  update public.rides
    set dispatch_tried_ids = '{}',
        offered_to_driver_id = null,
        dispatch_round = 0,
        search_expires_at = now() + make_interval(secs => public.setting_search_duration_seconds()),
        updated_at = now()
    where id = p_ride_id;

  return public.dispatch_next_driver(p_ride_id);
end;
$$;

grant execute on function public.start_ride_dispatch(uuid) to authenticated;

-- Tick : expire sonnerie chauffeur / délai client → chauffeur suivant
drop function if exists public.tick_ride_dispatch(uuid);
create or replace function public.tick_ride_dispatch(p_ride_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rides%rowtype;
  advanced int := 0;
  cur uuid;
begin
  for r in
    select * from public.rides
    where status in ('requested', 'offered')
      and driver_id is null
      and (p_ride_id is null or id = p_ride_id)
    for update
  loop
    -- Délai réponse client expiré → refuser offre + chauffeur suivant
    if r.client_response_expires_at is not null
       and r.client_response_expires_at < now() then
      update public.ride_offers
        set status = 'declined', updated_at = now()
        where ride_id = r.id and status = 'pending';
      perform public.dispatch_next_driver(r.id);
      advanced := advanced + 1;
      continue;
    end if;

    -- Sonnerie chauffeur expirée (sans offre pending) → suivant
    if r.dispatch_expires_at is not null
       and r.dispatch_expires_at < now()
       and r.client_response_expires_at is null
       and not exists (
         select 1 from public.ride_offers o
         where o.ride_id = r.id and o.status = 'pending'
       ) then
      perform public.dispatch_next_driver(r.id);
      advanced := advanced + 1;
      continue;
    end if;

    -- Jamais dispatché
    if r.offered_to_driver_id is null and r.status = 'requested' then
      perform public.dispatch_next_driver(r.id);
      advanced := advanced + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'advanced', advanced);
end;
$$;

grant execute on function public.tick_ride_dispatch(uuid) to authenticated, service_role;

-- Liste courses pour LE chauffeur ciblé uniquement
drop function if exists public.list_dispatch_rides_for_driver();
create or replace function public.list_dispatch_rides_for_driver()
returns setof public.rides
language plpgsql
security definer
set search_path = public
as $$
declare
  v_driver_id uuid;
begin
  select id into v_driver_id
  from public.drivers
  where profile_id = auth.uid()
  limit 1;

  if v_driver_id is null then
    return;
  end if;

  perform public.tick_ride_dispatch(null);

  return query
    select r.*
    from public.rides r
    where r.status in ('requested', 'offered')
      and r.driver_id is null
      and r.offered_to_driver_id = v_driver_id
      and (r.dispatch_expires_at is null or r.dispatch_expires_at > now())
      and (r.search_expires_at is null or r.search_expires_at > now())
      and not exists (
        select 1 from public.ride_offers o
        where o.ride_id = r.id
          and o.driver_id = v_driver_id
          and o.status in ('pending', 'selected')
      )
    order by r.created_at desc
    limit 5;
end;
$$;

grant execute on function public.list_dispatch_rides_for_driver() to authenticated;

-- Après offre chauffeur : lancer le délai réponse client
drop function if exists public.mark_offer_awaiting_client(uuid);
create or replace function public.mark_offer_awaiting_client(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sec int;
begin
  v_sec := public.setting_client_response_seconds();
  update public.rides
    set client_response_expires_at = now() + make_interval(secs => v_sec),
        -- pause la sonnerie : le chauffeur a déjà répondu
        dispatch_expires_at = null,
        updated_at = now()
    where id = p_ride_id
      and status in ('requested', 'offered');
end;
$$;

grant execute on function public.mark_offer_awaiting_client(uuid) to authenticated;

-- Client refuse une offre → chauffeur suivant
drop function if exists public.decline_ride_offer(uuid);
create or replace function public.decline_ride_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  off public.ride_offers%rowtype;
  r public.rides%rowtype;
  nxt jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into off from public.ride_offers where id = p_offer_id for update;
  if off.id is null then raise exception 'Offre introuvable'; end if;

  select * into r from public.rides where id = off.ride_id for update;
  if r.client_id <> auth.uid() then
    raise exception 'Seul le client peut refuser';
  end if;

  update public.ride_offers
    set status = 'declined', updated_at = now()
    where id = off.id;

  update public.rides
    set client_response_expires_at = null, updated_at = now()
    where id = r.id;

  nxt := public.dispatch_next_driver(r.id);
  return jsonb_build_object('ok', true, 'next', nxt);
end;
$$;

grant execute on function public.decline_ride_offer(uuid) to authenticated;

-- Mettre à jour admin_update_settings pour les nouveaux champs
create or replace function public.admin_update_settings(p_patch jsonb)
returns public.app_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.app_settings;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé à l''admin';
  end if;

  update public.app_settings s
  set
    active_province_code = coalesce(p_patch->>'active_province_code', s.active_province_code),
    zone_radius_km = coalesce((p_patch->>'zone_radius_km')::numeric, s.zone_radius_km),
    price_per_km_taxi = coalesce((p_patch->>'price_per_km_taxi')::numeric, s.price_per_km_taxi),
    price_per_km_moto = coalesce((p_patch->>'price_per_km_moto')::numeric, s.price_per_km_moto),
    price_per_km_pickup = coalesce((p_patch->>'price_per_km_pickup')::numeric, s.price_per_km_pickup),
    base_fare_taxi = coalesce((p_patch->>'base_fare_taxi')::numeric, s.base_fare_taxi),
    base_fare_moto = coalesce((p_patch->>'base_fare_moto')::numeric, s.base_fare_moto),
    base_fare_pickup = coalesce((p_patch->>'base_fare_pickup')::numeric, s.base_fare_pickup),
    commission_percent = coalesce((p_patch->>'commission_percent')::numeric, s.commission_percent),
    commission_enabled = coalesce((p_patch->>'commission_enabled')::boolean, s.commission_enabled),
    pawapay_enabled = coalesce((p_patch->>'pawapay_enabled')::boolean, s.pawapay_enabled),
    min_withdrawal_fc = coalesce((p_patch->>'min_withdrawal_fc')::numeric, s.min_withdrawal_fc),
    min_driver_balance_fc = coalesce(
      (p_patch->>'min_driver_balance_fc')::numeric,
      s.min_driver_balance_fc
    ),
    driver_ring_seconds = coalesce(
      (p_patch->>'driver_ring_seconds')::integer,
      s.driver_ring_seconds
    ),
    client_response_seconds = coalesce(
      (p_patch->>'client_response_seconds')::integer,
      s.client_response_seconds
    ),
    search_duration_seconds = coalesce(
      (p_patch->>'search_duration_seconds')::integer,
      s.search_duration_seconds
    ),
    updated_at = now(),
    updated_by = auth.uid()
  where s.id = 1
  returning * into row;

  if p_patch ? 'active_province_code' then
    update public.service_provinces set is_active = false;
    update public.service_provinces
    set is_active = true, updated_at = now()
    where code = p_patch->>'active_province_code';
  end if;

  return row;
end;
$$;

grant execute on function public.admin_update_settings(jsonb) to authenticated;

notify pgrst, 'reload schema';
