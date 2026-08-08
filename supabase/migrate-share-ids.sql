-- Partage d'identité client ↔ chauffeur sur une course liée

-- Le client / chauffeur peut lire le profil de l'autre s'il y a une course en commun
drop policy if exists "profiles_ride_counterpart" on public.profiles;
create policy "profiles_ride_counterpart" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.rides r
      where (
        (r.client_id = auth.uid() and r.driver_id in (
          select d.id from public.drivers d where d.profile_id = profiles.id
        ))
        or
        (r.client_id = profiles.id and r.driver_id in (
          select d.id from public.drivers d where d.profile_id = auth.uid()
        ))
        or
        -- Offres en attente : le client voit le profil des chauffeurs qui ont proposé
        (r.client_id = auth.uid() and exists (
          select 1
          from public.ride_offers o
          join public.drivers d on d.id = o.driver_id
          where o.ride_id = r.id
            and d.profile_id = profiles.id
            and o.status = 'pending'
        ))
        or
        -- Chauffeur voit le client dès qu'une course est demandée (même avant acceptation)
        (r.client_id = profiles.id and r.status in (
          'requested', 'offered', 'accepted', 'arriving', 'arrived', 'ongoing', 'completed'
        ) and exists (
          select 1 from public.drivers d
          where d.profile_id = auth.uid() and d.is_enabled = true
        ))
      )
    )
  );
