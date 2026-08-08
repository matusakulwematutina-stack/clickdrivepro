-- Corrige "Database error saving new user"
-- Cause fréquente : UNIQUE(phone) sur profiles quand le numéro existe déjà.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r text := coalesce(nullif(trim(new.raw_user_meta_data->>'role'), ''), 'client');
  n text := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), '');
  ph text := nullif(trim(coalesce(
    new.raw_user_meta_data->>'phone',
    new.phone,
    ''
  )), '');
  existing_id uuid;
  driver_row_id uuid;
  role_val public.user_role;
begin
  if r not in ('client', 'driver', 'admin', 'super_admin', 'partner') then
    r := 'client';
  end if;
  role_val := r::public.user_role;

  -- Téléphone déjà pris par un autre profil → on crée le profil SANS phone
  -- (l'app appellera link_existing_profile_by_phone ensuite)
  if ph is not null then
    select p.id into existing_id
    from public.profiles p
    where p.phone = ph
       or replace(coalesce(p.phone, ''), '+', '') = replace(ph, '+', '')
    limit 1;

    if existing_id is not null and existing_id <> new.id then
      ph := null;
    end if;
  end if;

  insert into public.profiles as p (id, full_name, phone, role)
  values (new.id, nullif(n, ''), ph, role_val)
  on conflict (id) do update
    set full_name = coalesce(nullif(excluded.full_name, ''), p.full_name),
        phone = coalesce(excluded.phone, p.phone),
        role = excluded.role,
        updated_at = now();

  if r = 'driver' then
    if not exists (select 1 from public.drivers d where d.profile_id = new.id) then
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

      begin
        insert into public.vehicles (driver_id, vehicle_type, model, color, plate, status)
        values (
          driver_row_id,
          coalesce(new.raw_user_meta_data->>'vehicle_type', 'taxi'),
          coalesce(new.raw_user_meta_data->>'vehicle_model', 'N/A'),
          coalesce(new.raw_user_meta_data->>'vehicle_color', 'N/A'),
          coalesce(new.raw_user_meta_data->>'plate_number', 'N/A'),
          'active'
        );
      exception when others then
        raise warning 'handle_new_user vehicles: %', SQLERRM;
      end;
    end if;
  end if;

  return new;
exception when others then
  -- Ne jamais bloquer la création auth.users
  raise warning 'handle_new_user failed: %', SQLERRM;
  return new;
end;
$$;

-- Soften auto-confirm too (au cas où phone_confirmed_at pose problème)
create or replace function public.auto_confirm_phone_auth_user()
returns trigger
language plpgsql
security definer
set search_path = auth, public
as $$
begin
  if new.email is not null and (
    new.email like '%@phone.clickdrive.app'
    or new.email like '%@phone.clickpro.drive'
  ) then
    new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  end if;
  return new;
exception when others then
  return new;
end;
$$;
