-- Rayon matching chauffeur ↔ client (dispatch), défaut 3 km

alter table public.app_settings
  add column if not exists dispatch_radius_km numeric(8,2) not null default 3;

alter table public.app_settings drop constraint if exists app_settings_dispatch_radius_check;
alter table public.app_settings
  add constraint app_settings_dispatch_radius_check
  check (dispatch_radius_km between 0.5 and 50);

update public.app_settings
set dispatch_radius_km = 3
where id = 1 and (dispatch_radius_km is null or dispatch_radius_km <= 0);

create or replace function public.setting_dispatch_radius_km()
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select dispatch_radius_km from public.app_settings where id = 1),
    3
  );
$$;

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

  update public.ride_offers
    set status = 'declined', updated_at = now()
    where ride_id = r.id and status = 'pending';

  -- Distance max chauffeur–client (réglage admin, défaut 3 km)
  v_radius := public.setting_dispatch_radius_km();
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
    return jsonb_build_object('ok', false, 'reason', 'no_driver', 'radius_km', v_radius);
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
    'radius_km', v_radius,
    'dispatch_expires_at', (now() + make_interval(secs => v_ring))
  );
end;
$$;

grant execute on function public.dispatch_next_driver(uuid) to authenticated, service_role;

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
    dispatch_radius_km = coalesce(
      (p_patch->>'dispatch_radius_km')::numeric,
      s.dispatch_radius_km
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
