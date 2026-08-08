-- ClickPro Drive — schéma MVP (Supabase / PostgreSQL)
-- Exécuter dans le SQL Editor Supabase si les tables n'existent pas encore.

create extension if not exists "pgcrypto";

-- Profils (lié à auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  role text not null check (role in ('client', 'driver')) default 'client',
  avatar_url text,
  rating numeric(3,2) default 5.0,
  created_at timestamptz not null default now()
);

-- Chauffeurs
create table if not exists public.drivers (
  id uuid primary key references public.profiles(id) on delete cascade,
  is_online boolean not null default false,
  is_available boolean not null default true,
  vehicle_type text not null default 'taxi' check (vehicle_type in ('taxi', 'moto', 'pickup')),
  vehicle_brand text,
  vehicle_model text,
  vehicle_color text,
  plate_number text,
  lat double precision,
  lng double precision,
  heading double precision default 0,
  updated_at timestamptz not null default now()
);

-- Types de véhicule / tarifs
create table if not exists public.vehicle_types (
  id text primary key,
  label text not null,
  base_fare numeric(12,2) not null default 5000,
  price_per_km numeric(12,2) not null default 1200,
  price_per_min numeric(12,2) not null default 150,
  min_fare numeric(12,2) not null default 5000,
  icon text,
  active boolean not null default true
);

insert into public.vehicle_types (id, label, base_fare, price_per_km, price_per_min, min_fare, icon)
values
  ('taxi', 'Taxi', 5000, 1200, 150, 5000, 'car'),
  ('moto', 'Moto', 2000, 800, 100, 2000, 'bike'),
  ('pickup', 'Pickup', 8000, 1800, 200, 8000, 'truck')
on conflict (id) do nothing;

-- Courses
create table if not exists public.rides (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id),
  driver_id uuid references public.drivers(id),
  vehicle_type text not null default 'taxi' references public.vehicle_types(id),
  status text not null default 'searching'
    check (status in (
      'searching', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled'
    )),
  pickup_address text,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  dropoff_address text,
  dropoff_lat double precision not null,
  dropoff_lng double precision not null,
  distance_km numeric(10,2),
  duration_min numeric(10,1),
  estimated_price numeric(12,2),
  final_price numeric(12,2),
  payment_method text not null default 'cash'
    check (payment_method in ('cash', 'orange_money', 'airtel_money', 'card')),
  client_rating int check (client_rating between 1 and 5),
  driver_rating int check (driver_rating between 1 and 5),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz
);

create index if not exists rides_status_idx on public.rides(status);
create index if not exists rides_client_idx on public.rides(client_id);
create index if not exists rides_driver_idx on public.rides(driver_id);
create index if not exists drivers_online_idx on public.drivers(is_online, is_available);

-- Auto-créer un profil à l'inscription
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  r text := coalesce(new.raw_user_meta_data->>'role', 'client');
  n text := coalesce(new.raw_user_meta_data->>'full_name', '');
begin
  if r not in ('client', 'driver') then
    r := 'client';
  end if;

  insert into public.profiles (id, full_name, phone, role)
  values (new.id, n, new.phone, r);

  if r = 'driver' then
    insert into public.drivers (id, vehicle_type, plate_number)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'vehicle_type', 'taxi'),
      coalesce(new.raw_user_meta_data->>'plate_number', 'N/A')
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Estimation de prix
create or replace function public.estimate_fare(
  p_vehicle_type text,
  p_distance_km numeric,
  p_duration_min numeric
)
returns numeric
language sql
stable
as $$
  select greatest(
    vt.min_fare,
    vt.base_fare + (p_distance_km * vt.price_per_km) + (p_duration_min * vt.price_per_min)
  )
  from public.vehicle_types vt
  where vt.id = p_vehicle_type;
$$;

-- RLS
alter table public.profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.vehicle_types enable row level security;
alter table public.rides enable row level security;

drop policy if exists "profiles read own or public drivers" on public.profiles;
create policy "profiles read own or public drivers" on public.profiles
  for select using (
    auth.uid() = id or role = 'driver'
  );

drop policy if exists "profiles update own" on public.profiles;
create policy "profiles update own" on public.profiles
  for update using (auth.uid() = id);

drop policy if exists "drivers read all authenticated" on public.drivers;
create policy "drivers read all authenticated" on public.drivers
  for select to authenticated using (true);

drop policy if exists "drivers update own" on public.drivers;
create policy "drivers update own" on public.drivers
  for update using (auth.uid() = id);

drop policy if exists "vehicle_types public read" on public.vehicle_types;
create policy "vehicle_types public read" on public.vehicle_types
  for select using (true);

drop policy if exists "rides select involved" on public.rides;
create policy "rides select involved" on public.rides
  for select using (
    auth.uid() = client_id
    or auth.uid() = driver_id
    or exists (
      select 1 from public.drivers d
      where d.id = auth.uid() and d.is_online = true
    )
  );

drop policy if exists "rides insert client" on public.rides;
create policy "rides insert client" on public.rides
  for insert with check (auth.uid() = client_id);

drop policy if exists "rides update involved" on public.rides;
create policy "rides update involved" on public.rides
  for update using (
    auth.uid() = client_id or auth.uid() = driver_id
  );

-- Realtime
alter publication supabase_realtime add table public.rides;
alter publication supabase_realtime add table public.drivers;
