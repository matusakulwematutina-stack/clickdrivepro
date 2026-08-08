-- Auto-confirme les comptes téléphone (email technique @phone.clickpro.drive)
-- pour que mot de passe / login marchent sans validation e-mail.

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
end;
$$;

drop trigger if exists trg_auto_confirm_phone_auth on auth.users;
create trigger trg_auto_confirm_phone_auth
  before insert on auth.users
  for each row
  execute function public.auto_confirm_phone_auth_user();

-- Confirmer les comptes téléphone déjà créés mais non validés
update auth.users
set email_confirmed_at = coalesce(email_confirmed_at, now())
where email like '%@phone.clickpro.drive'
  and email_confirmed_at is null;
