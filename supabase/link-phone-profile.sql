-- Option B : réutiliser un profil existant trouvé par téléphone
-- après authentification Supabase (auth.uid()).

create unique index if not exists profiles_phone_uidx
  on public.profiles (phone)
  where phone is not null and length(trim(phone)) > 0;

create or replace function public.link_existing_profile_by_phone()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  meta_phone text;
  meta_name text;
  meta_role text;
  existing public.profiles%rowtype;
  reused boolean := false;
  previous_id uuid := null;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  meta_phone := nullif(trim(coalesce(
    auth.jwt() -> 'user_metadata' ->> 'phone',
    ''
  )), '');

  meta_name := coalesce(
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'full_name'), ''),
    'Utilisateur'
  );

  meta_role := coalesce(
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'role'), ''),
    'client'
  );

  if meta_role not in ('client', 'driver') then
    meta_role := 'client';
  end if;

  if meta_phone is not null then
    select * into existing
    from public.profiles p
    where p.phone = meta_phone
       or p.phone = replace(meta_phone, '+', '')
       or replace(coalesce(p.phone, ''), '+', '') = replace(meta_phone, '+', '')
    order by case when p.id = uid then 0 else 1 end
    limit 1;
  end if;

  if existing.id is not null and existing.id <> uid then
    previous_id := existing.id;
    reused := true;

    update public.drivers
      set profile_id = uid
      where profile_id = existing.id;

    update public.rides
      set client_id = uid
      where client_id = existing.id;

    -- si d'anciennes courses pointaient driver_id = profile id (legacy)
    update public.rides
      set driver_id = d.id
      from public.drivers d
      where public.rides.driver_id = existing.id
        and d.profile_id = uid;

    delete from public.profiles where id = existing.id;
  end if;

  insert into public.profiles (id, full_name, phone, role)
  values (
    uid,
    coalesce(nullif(trim(existing.full_name), ''), meta_name),
    coalesce(meta_phone, existing.phone),
    coalesce(existing.role, meta_role)
  )
  on conflict (id) do update
    set phone = coalesce(excluded.phone, public.profiles.phone),
        full_name = coalesce(nullif(trim(public.profiles.full_name), ''), excluded.full_name),
        role = coalesce(public.profiles.role, excluded.role);

  -- chauffeur : s'assurer qu'une ligne drivers existe pour ce profile
  if coalesce(existing.role, meta_role) = 'driver'
     and not exists (select 1 from public.drivers where profile_id = uid) then
    insert into public.drivers (profile_id, status, is_online, is_available)
    values (uid, 'offline', false, true);
  end if;

  return jsonb_build_object(
    'profile_id', uid,
    'reused', reused,
    'previous_id', previous_id,
    'phone', coalesce(meta_phone, existing.phone)
  );
end;
$$;

revoke all on function public.link_existing_profile_by_phone() from public;
grant execute on function public.link_existing_profile_by_phone() to authenticated;

-- Lecture téléphone pour savoir si le numéro existe déjà (avant inscription)
create or replace function public.lookup_profile_by_phone(p_phone text)
returns table (
  id uuid,
  full_name text,
  phone text,
  role text
)
language sql
security definer
set search_path = public
as $$
  select p.id, p.full_name, p.phone, p.role
  from public.profiles p
  where p.phone = p_phone
     or p.phone = replace(p_phone, '+', '')
     or replace(coalesce(p.phone, ''), '+', '') = replace(p_phone, '+', '')
  limit 1;
$$;

revoke all on function public.lookup_profile_by_phone(text) from public;
grant execute on function public.lookup_profile_by_phone(text) to anon, authenticated;
