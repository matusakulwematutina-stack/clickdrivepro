-- Négociation prix : offres chauffeur sur une course (rides)
-- Compatible avec le flux actuel ClickPro Drive.

alter table public.ride_offers
  add column if not exists ride_id uuid references public.rides(id) on delete cascade;

alter table public.ride_offers
  add column if not exists note text;

-- Permettre les offres liées à une ride sans ride_request
do $$
begin
  alter table public.ride_offers alter column ride_request_id drop not null;
exception when others then null;
end $$;

create unique index if not exists ride_offers_ride_driver_uidx
  on public.ride_offers (ride_id, driver_id)
  where ride_id is not null;

alter table public.ride_offers enable row level security;

drop policy if exists "ride_offers_select" on public.ride_offers;
create policy "ride_offers_select" on public.ride_offers
  for select to authenticated using (true);

drop policy if exists "ride_offers_insert_driver" on public.ride_offers;
create policy "ride_offers_insert_driver" on public.ride_offers
  for insert to authenticated
  with check (
    exists (
      select 1 from public.drivers d
      where d.id = driver_id and d.profile_id = auth.uid()
    )
  );

drop policy if exists "ride_offers_update" on public.ride_offers;
create policy "ride_offers_update" on public.ride_offers
  for update to authenticated using (true);

-- Accepter une offre : met à jour la course + statut offre
create or replace function public.accept_ride_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  off public.ride_offers%rowtype;
  r public.rides%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into off from public.ride_offers where id = p_offer_id for update;
  if off.id is null then
    raise exception 'Offre introuvable';
  end if;
  if off.status <> 'pending' then
    raise exception 'Offre déjà traitée';
  end if;
  if off.ride_id is null then
    raise exception 'Offre sans course';
  end if;

  select * into r from public.rides where id = off.ride_id for update;
  if r.client_id <> auth.uid() then
    raise exception 'Seul le client peut accepter';
  end if;
  if r.status not in ('requested', 'offered') then
    raise exception 'Course non disponible pour négociation';
  end if;

  -- Refuse les autres offres pending
  update public.ride_offers
    set status = 'declined', updated_at = now()
    where ride_id = r.id
      and id <> off.id
      and status = 'pending';

  update public.ride_offers
    set status = 'selected', updated_at = now()
    where id = off.id;

  update public.rides
    set driver_id = off.driver_id,
        status = 'accepted',
        estimated_price = off.offered_price_cents,
        accepted_at = now(),
        updated_at = now()
    where id = r.id;

  update public.drivers
    set is_available = false, status = 'busy', updated_at = now()
    where id = off.driver_id;

  return jsonb_build_object(
    'ride_id', r.id,
    'driver_id', off.driver_id,
    'price', off.offered_price_cents
  );
end;
$$;

revoke all on function public.accept_ride_offer(uuid) from public;
grant execute on function public.accept_ride_offer(uuid) to authenticated;

create or replace function public.decline_ride_offer(p_offer_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  off public.ride_offers%rowtype;
  r public.rides%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  select * into off from public.ride_offers where id = p_offer_id for update;
  if off.id is null then
    raise exception 'Offre introuvable';
  end if;

  select * into r from public.rides where id = off.ride_id;
  if r.client_id <> auth.uid() then
    raise exception 'Seul le client peut refuser';
  end if;

  update public.ride_offers
    set status = 'declined', updated_at = now()
    where id = off.id;

  -- Remet la course en recherche si plus aucune offre pending
  if not exists (
    select 1 from public.ride_offers
    where ride_id = r.id and status = 'pending'
  ) and r.status = 'offered' then
    update public.rides
      set status = 'requested', updated_at = now()
      where id = r.id;
  end if;

  return jsonb_build_object('ok', true, 'offer_id', off.id);
end;
$$;

revoke all on function public.decline_ride_offer(uuid) from public;
grant execute on function public.decline_ride_offer(uuid) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.ride_offers;
exception when duplicate_object then null;
end $$;
