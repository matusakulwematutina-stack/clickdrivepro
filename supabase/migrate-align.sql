-- Aligne la BD existante ClickPro Drive avec le MVP Expo
-- Sans détruire les tables déjà présentes.

-- PROFILES
alter table public.profiles add column if not exists rating numeric(3,2) default 5.0;

-- DRIVERS (id peut être distinct de profile_id)
alter table public.drivers add column if not exists is_online boolean not null default false;
alter table public.drivers add column if not exists is_available boolean not null default true;
alter table public.drivers add column if not exists vehicle_type text default 'taxi';
alter table public.drivers add column if not exists vehicle_brand text;
alter table public.drivers add column if not exists vehicle_model text;
alter table public.drivers add column if not exists vehicle_color text;
alter table public.drivers add column if not exists plate_number text;
alter table public.drivers add column if not exists lat double precision;
alter table public.drivers add column if not exists lng double precision;
alter table public.drivers add column if not exists heading double precision default 0;

-- Si status existe déjà, on le garde en miroir soft
-- valeurs utiles: offline | online | busy

-- VEHICLES
alter table public.vehicles add column if not exists vehicle_type text default 'taxi';
alter table public.vehicles add column if not exists brand text;
alter table public.vehicles add column if not exists status text default 'active';

-- RIDES
alter table public.rides add column if not exists vehicle_type text default 'taxi';
alter table public.rides add column if not exists pickup_address text;
alter table public.rides add column if not exists dropoff_address text;
alter table public.rides add column if not exists distance_km numeric(10,2);
alter table public.rides add column if not exists duration_min numeric(10,1);
alter table public.rides add column if not exists estimated_price numeric(12,2);
alter table public.rides add column if not exists final_price numeric(12,2);
alter table public.rides add column if not exists payment_method text default 'cash';
alter table public.rides add column if not exists client_rating int;
alter table public.rides add column if not exists driver_rating int;
alter table public.rides add column if not exists accepted_at timestamptz;
alter table public.rides add column if not exists completed_at timestamptz;

-- VEHICLE TYPES (nouvelle table légère)
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

-- Trigger profil à l'inscription (si absent)
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  r text := coalesce(new.raw_user_meta_data->>'role', 'client');
  n text := coalesce(new.raw_user_meta_data->>'full_name', '');
  driver_row_id uuid;
begin
  if r not in ('client', 'driver') then
    r := 'client';
  end if;

  insert into public.profiles (id, full_name, phone, role)
  values (new.id, n, new.phone, r)
  on conflict (id) do update
    set full_name = excluded.full_name,
        phone = coalesce(excluded.phone, public.profiles.phone),
        role = excluded.role;

  if r = 'driver' then
    insert into public.drivers (profile_id, status, is_online, is_available, vehicle_type, plate_number)
    values (
      new.id,
      'offline',
      false,
      true,
      coalesce(new.raw_user_meta_data->>'vehicle_type', 'taxi'),
      coalesce(new.raw_user_meta_data->>'plate_number', 'N/A')
    )
    returning id into driver_row_id;

    insert into public.vehicles (driver_id, vehicle_type, model, color, plate, status)
    values (
      driver_row_id,
      coalesce(new.raw_user_meta_data->>'vehicle_type', 'taxi'),
      coalesce(new.raw_user_meta_data->>'vehicle_model', 'N/A'),
      coalesce(new.raw_user_meta_data->>'vehicle_color', 'N/A'),
      coalesce(new.raw_user_meta_data->>'plate_number', 'N/A'),
      'active'
    );
  end if;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- RLS souple pour le MVP
alter table public.profiles enable row level security;
alter table public.drivers enable row level security;
alter table public.rides enable row level security;
alter table public.vehicles enable row level security;
alter table public.vehicle_types enable row level security;

drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles for select to authenticated using (true);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles for update to authenticated using (auth.uid() = id);
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles for insert to authenticated with check (auth.uid() = id);

drop policy if exists "drivers_select" on public.drivers;
create policy "drivers_select" on public.drivers for select to authenticated using (true);
drop policy if exists "drivers_update_own" on public.drivers;
create policy "drivers_update_own" on public.drivers for update to authenticated using (profile_id = auth.uid());
drop policy if exists "drivers_insert_own" on public.drivers;
create policy "drivers_insert_own" on public.drivers for insert to authenticated with check (profile_id = auth.uid());

drop policy if exists "rides_select" on public.rides;
create policy "rides_select" on public.rides for select to authenticated using (true);
drop policy if exists "rides_insert" on public.rides;
create policy "rides_insert" on public.rides for insert to authenticated with check (client_id = auth.uid());
drop policy if exists "rides_update" on public.rides;
create policy "rides_update" on public.rides for update to authenticated using (true);

drop policy if exists "vehicles_select" on public.vehicles;
create policy "vehicles_select" on public.vehicles for select to authenticated using (true);
drop policy if exists "vehicles_write_own" on public.vehicles;
create policy "vehicles_write_own" on public.vehicles for all to authenticated using (true) with check (true);

drop policy if exists "vehicle_types_read" on public.vehicle_types;
create policy "vehicle_types_read" on public.vehicle_types for select using (true);

-- Realtime
do $$ begin
  alter publication supabase_realtime add table public.rides;
exception when duplicate_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.drivers;
exception when duplicate_object then null;
end $$;
