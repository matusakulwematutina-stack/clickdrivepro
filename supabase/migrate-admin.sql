-- ClickPro Drive — Admin RDC (compatible schéma existant)
-- Rôles: client | driver | admin | super_admin

-- 1) Rôles
alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles
set role = 'client'
where role is null
   or role not in ('client', 'driver', 'admin', 'super_admin');

alter table public.profiles
  add constraint profiles_role_check
  check (role in ('client', 'driver', 'admin', 'super_admin'));

-- 2) Chauffeur
alter table public.drivers
  add column if not exists is_enabled boolean not null default true;

alter table public.drivers
  add column if not exists wallet_balance numeric(12,2) not null default 0;

-- Aligner is_enabled sur is_approved si présent
do $$ begin
  update public.drivers
  set is_enabled = coalesce(is_approved, true)
  where is_enabled is distinct from coalesce(is_approved, true);
exception when undefined_column then null;
end $$;

-- 3) Courses commission
alter table public.rides
  add column if not exists commission_percent numeric(5,2);

alter table public.rides
  add column if not exists commission_amount numeric(12,2);

alter table public.rides
  add column if not exists province_code text;

-- 4) Réglages
create table if not exists public.app_settings (
  id int primary key default 1 check (id = 1),
  active_province_code text not null default 'HK',
  zone_radius_km numeric(8,2) not null default 60,
  price_per_km_taxi numeric(12,2) not null default 1200,
  price_per_km_moto numeric(12,2) not null default 800,
  price_per_km_pickup numeric(12,2) not null default 1800,
  base_fare_taxi numeric(12,2) not null default 5000,
  base_fare_moto numeric(12,2) not null default 2000,
  base_fare_pickup numeric(12,2) not null default 8000,
  commission_percent numeric(5,2) not null default 15,
  commission_enabled boolean not null default true,
  pawapay_enabled boolean not null default true,
  min_withdrawal_fc numeric(12,2) not null default 5000,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

insert into public.app_settings (id) values (1)
on conflict (id) do nothing;

-- 5) Provinces RDC
create table if not exists public.service_provinces (
  code text primary key,
  name text not null,
  center_lat double precision not null,
  center_lng double precision not null,
  default_radius_km numeric(8,2) not null default 80,
  is_active boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.service_provinces (code, name, center_lat, center_lng, default_radius_km, is_active) values
  ('HK',  'Haut-Katanga',           -11.6647, 27.4794, 60,  true),
  ('LU',  'Lualaba',                -10.7167, 25.4667, 80,  false),
  ('KS',  'Kasai',                  -5.8960,  22.4160, 90,  false),
  ('KO',  'Kasai Oriental',         -6.1500,  23.6000, 90,  false),
  ('KC',  'Kasai Central',          -6.1333,  22.4000, 90,  false),
  ('LO',  'Lomami',                 -6.1330,  24.4830, 90,  false),
  ('SA',  'Sankuru',                -3.5000,  23.6000, 100, false),
  ('MN',  'Maniema',                -2.9500,  25.9500, 100, false),
  ('SK',  'Sud-Kivu',               -2.5000,  28.8667, 80,  false),
  ('NK',  'Nord-Kivu',              -1.6785,  29.2228, 80,  false),
  ('IT',  'Ituri',                   1.7500,  29.8333, 100, false),
  ('TH',  'Tshopo',                  0.5167,  25.2000, 100, false),
  ('BU',  'Bas-Uele',                2.8000,  24.7330, 110, false),
  ('HU',  'Haut-Uele',               2.8500,  27.6167, 110, false),
  ('TU',  'Tshuapa',                -0.7330,  22.2500, 110, false),
  ('MQ',  'Mongala',                 2.1500,  21.5167, 110, false),
  ('SU',  'Sud-Ubangi',              3.2500,  19.7667, 100, false),
  ('NU',  'Nord-Ubangi',             4.2833,  21.0167, 100, false),
  ('EQ',  'Équateur',                0.0500,  18.2667, 100, false),
  ('MA',  'Mai-Ndombe',             -2.0000,  18.3000, 110, false),
  ('KG',  'Kongo Central',          -5.8167,  13.4667, 80,  false),
  ('KN',  'Kinshasa',               -4.3276,  15.3136, 50,  false),
  ('KW',  'Kwilu',                  -5.0333,  18.8167, 100, false),
  ('KWU', 'Kwango',                 -6.7500,  17.2000, 100, false),
  ('TO',  'Tanganyika',             -5.9000,  29.2000, 100, false),
  ('HL',  'Haut-Lomami',            -8.7330,  24.9830, 100, false)
on conflict (code) do nothing;

-- 6) Compléter sos_alerts existant (ne pas recréer)
alter table public.sos_alerts
  add column if not exists reporter_id uuid references public.profiles(id);

alter table public.sos_alerts
  add column if not exists reporter_role text;

alter table public.sos_alerts
  add column if not exists admin_note text;

alter table public.sos_alerts
  add column if not exists updated_at timestamptz default now();

-- 7) Retraits PawaPay
create table if not exists public.withdrawals (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.drivers(id) on delete cascade,
  amount_fc numeric(12,2) not null check (amount_fc > 0),
  phone text not null,
  provider text not null default 'pawapay',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'paid', 'rejected', 'failed')),
  provider_ref text,
  admin_note text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.profiles(id)
);

create index if not exists withdrawals_status_idx on public.withdrawals(status, created_at desc);

-- 8) Helpers
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
  );
$$;

create or replace function public.admin_reset_driver_password(
  p_profile_id uuid,
  p_new_password text
)
returns void
language plpgsql
security definer
set search_path = public, auth, extensions
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé à l''admin';
  end if;
  if length(coalesce(p_new_password, '')) < 6 then
    raise exception 'Mot de passe trop court (min. 6)';
  end if;
  if not exists (
    select 1 from public.profiles where id = p_profile_id and role = 'driver'
  ) then
    raise exception 'Profil chauffeur introuvable';
  end if;

  update auth.users
  set encrypted_password = crypt(p_new_password, gen_salt('bf')),
      updated_at = now()
  where id = p_profile_id;
end;
$$;

create or replace function public.admin_set_driver_enabled(
  p_driver_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé à l''admin';
  end if;
  update public.drivers
  set
    is_enabled = p_enabled,
    is_approved = p_enabled,
    is_online = case when p_enabled then is_online else false end,
    is_available = case when p_enabled then is_available else false end,
    status = case when p_enabled then status else 'offline' end,
    updated_at = now()
  where id = p_driver_id;
end;
$$;

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

-- 9) RLS
alter table public.app_settings enable row level security;
alter table public.service_provinces enable row level security;
alter table public.sos_alerts enable row level security;
alter table public.withdrawals enable row level security;

drop policy if exists "settings_read_auth" on public.app_settings;
create policy "settings_read_auth" on public.app_settings
  for select to authenticated using (true);

drop policy if exists "settings_admin_all" on public.app_settings;
create policy "settings_admin_all" on public.app_settings
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "provinces_read_auth" on public.service_provinces;
create policy "provinces_read_auth" on public.service_provinces
  for select to authenticated using (true);

drop policy if exists "provinces_admin_all" on public.service_provinces;
create policy "provinces_admin_all" on public.service_provinces
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "sos_insert_auth" on public.sos_alerts;
create policy "sos_insert_auth" on public.sos_alerts
  for insert to authenticated with check (true);

drop policy if exists "sos_select_auth" on public.sos_alerts;
create policy "sos_select_auth" on public.sos_alerts
  for select to authenticated using (true);

drop policy if exists "sos_admin_update" on public.sos_alerts;
create policy "sos_admin_update" on public.sos_alerts
  for update to authenticated using (public.is_admin());

drop policy if exists "withdrawals_select" on public.withdrawals;
create policy "withdrawals_select" on public.withdrawals
  for select to authenticated using (
    public.is_admin()
    or exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.profile_id = auth.uid()
    )
  );

drop policy if exists "withdrawals_insert" on public.withdrawals;
create policy "withdrawals_insert" on public.withdrawals
  for insert to authenticated with check (
    exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.profile_id = auth.uid()
    )
  );

drop policy if exists "withdrawals_admin_update" on public.withdrawals;
create policy "withdrawals_admin_update" on public.withdrawals
  for update to authenticated using (public.is_admin());

drop policy if exists "profiles_admin_read" on public.profiles;
create policy "profiles_admin_read" on public.profiles
  for select to authenticated using (public.is_admin() or auth.uid() = id);

drop policy if exists "drivers_admin_all" on public.drivers;
create policy "drivers_admin_all" on public.drivers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

do $$ begin
  alter publication supabase_realtime add table public.sos_alerts;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.withdrawals;
exception when duplicate_object then null;
end $$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.admin_reset_driver_password(uuid, text) to authenticated;
grant execute on function public.admin_set_driver_enabled(uuid, boolean) to authenticated;
grant execute on function public.admin_update_settings(jsonb) to authenticated;
