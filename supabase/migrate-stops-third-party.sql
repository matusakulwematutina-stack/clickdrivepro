-- Course pour un tiers + arrêts intermédiaires (double / triple)
-- Exécuter dans le SQL Editor Supabase.

alter table public.rides
  add column if not exists for_third_party boolean not null default false;

alter table public.rides
  add column if not exists passenger_name text;

alter table public.rides
  add column if not exists passenger_phone text;

-- Arrêts intermédiaires : [{ "label": "...", "lat": 0, "lng": 0 }, ...]
-- La destination finale reste dropoff_* ; 1 arrêt = double, 2 = triple.
alter table public.rides
  add column if not exists stops jsonb not null default '[]'::jsonb;

-- Combien d'arrêts intermédiaires déjà effectués (chauffeur)
alter table public.rides
  add column if not exists stops_done int not null default 0;

comment on column public.rides.for_third_party is 'true si la course est pour un autre passager';
comment on column public.rides.stops is 'Arrêts intermédiaires avant la destination finale';
comment on column public.rides.stops_done is 'Nombre d''arrêts intermédiaires déjà validés par le chauffeur';
