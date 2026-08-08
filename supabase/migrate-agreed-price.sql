-- Prix convenu = offre acceptée (estimé + final figés ensemble)

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

  v_price := off.offered_price_cents;

  update public.ride_offers
    set status = 'declined', updated_at = now()
    where ride_id = r.id
      and id <> off.id
      and status = 'pending';

  update public.ride_offers
    set status = 'selected', updated_at = now()
    where id = off.id;

  -- Figé : le prix affiché partout = exactement l’offre acceptée
  update public.rides
    set driver_id = off.driver_id,
        status = 'accepted',
        estimated_price = v_price,
        final_price = v_price,
        accepted_at = now(),
        updated_at = now()
    where id = r.id;

  update public.drivers
    set is_available = false, status = 'busy', updated_at = now()
    where id = off.driver_id;

  return jsonb_build_object(
    'ride_id', r.id,
    'driver_id', off.driver_id,
    'price', v_price
  );
end;
$$;

grant execute on function public.accept_ride_offer(uuid) to authenticated;

notify pgrst, 'reload schema';
