-- PawaPay : colonnes dépôt / callback pour recharges directes

alter table public.wallet_topups
  add column if not exists deposit_id uuid;
alter table public.wallet_topups
  add column if not exists mmo_provider text;
alter table public.wallet_topups
  add column if not exists currency text not null default 'CDF';
alter table public.wallet_topups
  add column if not exists provider_status text;
alter table public.wallet_topups
  add column if not exists provider_ref text;

create unique index if not exists wallet_topups_deposit_id_uidx
  on public.wallet_topups(deposit_id)
  where deposit_id is not null;

-- Étendre les statuts
alter table public.wallet_topups drop constraint if exists wallet_topups_status_check;
alter table public.wallet_topups
  add constraint wallet_topups_status_check
  check (status in ('pending', 'processing', 'approved', 'rejected', 'failed'));

-- Crédit automatique après paiement PawaPay (service role / edge function)
create or replace function public.complete_pawapay_topup(
  p_deposit_id uuid,
  p_provider_ref text default null,
  p_provider_status text default 'COMPLETED'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.wallet_topups%rowtype;
begin
  select * into t from public.wallet_topups where deposit_id = p_deposit_id for update;
  if not found then
    raise exception 'Topup introuvable pour deposit %', p_deposit_id;
  end if;
  if t.status = 'approved' then
    return;
  end if;

  perform public._credit_wallet(
    t.profile_id, t.driver_id, t.amount_fc, 'topup',
    'Recharge PawaPay', null, t.id, null
  );

  update public.wallet_topups
  set status = 'approved',
      provider_status = p_provider_status,
      provider_ref = coalesce(p_provider_ref, provider_ref),
      processed_at = now()
  where id = t.id;
end;
$$;

grant execute on function public.complete_pawapay_topup(uuid, text, text) to service_role;
