-- ClickPro Drive — Wallets, ledger, véhicule, commission par course

-- 1) Profils client : solde
alter table public.profiles
  add column if not exists wallet_balance numeric(12,2) not null default 0;

-- 2) Chauffeur : docs véhicule
alter table public.drivers
  add column if not exists vehicle_brand text;
alter table public.drivers
  add column if not exists vehicle_model text;
alter table public.drivers
  add column if not exists vehicle_color text;
alter table public.drivers
  add column if not exists license_number text;
alter table public.drivers
  add column if not exists board_document_ref text;

-- 3) Settings
alter table public.app_settings
  add column if not exists min_driver_balance_fc numeric(12,2) not null default 5000;

-- 4) Courses : commission annulée / payée
alter table public.rides
  add column if not exists commission_waived boolean not null default false;
alter table public.rides
  add column if not exists commission_paid boolean not null default false;

-- payment_method élargi (wallet)
do $$ begin
  alter table public.rides drop constraint if exists rides_payment_method_check;
exception when undefined_object then null;
end $$;

do $$ begin
  alter table public.rides
    add constraint rides_payment_method_check
    check (payment_method in ('cash', 'wallet', 'orange_money', 'airtel_money', 'card'));
exception when duplicate_object then null;
end $$;

-- 5) Recharges (entrée d'argent)
create table if not exists public.wallet_topups (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  amount_fc numeric(12,2) not null check (amount_fc > 0),
  phone text,
  provider text not null default 'pawapay',
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'failed')),
  admin_note text,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  processed_by uuid references public.profiles(id)
);

create index if not exists wallet_topups_status_idx
  on public.wallet_topups(status, created_at desc);

-- 6) Ledger (mouvements entrée / sortie)
create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  driver_id uuid references public.drivers(id) on delete set null,
  direction text not null check (direction in ('in', 'out')),
  kind text not null,
  amount_fc numeric(12,2) not null check (amount_fc > 0),
  balance_after numeric(12,2),
  ride_id uuid references public.rides(id) on delete set null,
  topup_id uuid references public.wallet_topups(id) on delete set null,
  withdrawal_id uuid references public.withdrawals(id) on delete set null,
  note text,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index if not exists wallet_ledger_created_idx
  on public.wallet_ledger(created_at desc);
create index if not exists wallet_ledger_profile_idx
  on public.wallet_ledger(profile_id, created_at desc);

-- 7) Helpers admin
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role in ('admin', 'super_admin')
  );
$$;

-- Créditer un portefeuille (profil + driver si lié)
create or replace function public._credit_wallet(
  p_profile_id uuid,
  p_driver_id uuid,
  p_amount numeric,
  p_kind text,
  p_note text,
  p_ride_id uuid,
  p_topup_id uuid,
  p_withdrawal_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  bal numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  if p_driver_id is not null then
    update public.drivers
    set wallet_balance = coalesce(wallet_balance, 0) + p_amount
    where id = p_driver_id
    returning wallet_balance into bal;
  else
    update public.profiles
    set wallet_balance = coalesce(wallet_balance, 0) + p_amount
    where id = p_profile_id
    returning wallet_balance into bal;
  end if;

  insert into public.wallet_ledger(
    profile_id, driver_id, direction, kind, amount_fc, balance_after,
    ride_id, topup_id, withdrawal_id, note, created_by
  ) values (
    p_profile_id, p_driver_id, 'in', p_kind, p_amount, bal,
    p_ride_id, p_topup_id, p_withdrawal_id, p_note, auth.uid()
  );

  return bal;
end;
$$;

create or replace function public._debit_wallet(
  p_profile_id uuid,
  p_driver_id uuid,
  p_amount numeric,
  p_kind text,
  p_note text,
  p_ride_id uuid,
  p_topup_id uuid,
  p_withdrawal_id uuid
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  bal numeric;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Montant invalide';
  end if;

  if p_driver_id is not null then
    update public.drivers
    set wallet_balance = coalesce(wallet_balance, 0) - p_amount
    where id = p_driver_id
      and coalesce(wallet_balance, 0) >= p_amount
    returning wallet_balance into bal;
    if bal is null then
      raise exception 'Solde chauffeur insuffisant';
    end if;
  else
    update public.profiles
    set wallet_balance = coalesce(wallet_balance, 0) - p_amount
    where id = p_profile_id
      and coalesce(wallet_balance, 0) >= p_amount
    returning wallet_balance into bal;
    if bal is null then
      raise exception 'Solde insuffisant';
    end if;
  end if;

  insert into public.wallet_ledger(
    profile_id, driver_id, direction, kind, amount_fc, balance_after,
    ride_id, topup_id, withdrawal_id, note, created_by
  ) values (
    p_profile_id, p_driver_id, 'out', p_kind, p_amount, bal,
    p_ride_id, p_topup_id, p_withdrawal_id, p_note, auth.uid()
  );

  return bal;
end;
$$;

-- Demande de recharge (client ou chauffeur)
create or replace function public.request_wallet_topup(
  p_amount numeric,
  p_phone text default null,
  p_provider text default 'pawapay'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  did uuid;
  tid uuid;
begin
  if uid is null then raise exception 'Non authentifié'; end if;
  if p_amount is null or p_amount < 100 then
    raise exception 'Montant minimum 100 FC';
  end if;

  select id into did from public.drivers where profile_id = uid limit 1;

  insert into public.wallet_topups(profile_id, driver_id, amount_fc, phone, provider)
  values (uid, did, p_amount, coalesce(p_phone, (select phone from public.profiles where id = uid)), coalesce(p_provider, 'pawapay'))
  returning id into tid;

  return tid;
end;
$$;

-- Admin : approuver recharge
create or replace function public.admin_approve_topup(
  p_topup_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.wallet_topups%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin requis'; end if;

  select * into t from public.wallet_topups where id = p_topup_id for update;
  if not found then raise exception 'Recharge introuvable'; end if;
  if t.status <> 'pending' then raise exception 'Déjà traitée'; end if;

  perform public._credit_wallet(
    t.profile_id, t.driver_id, t.amount_fc, 'topup',
    coalesce(p_note, 'Recharge approuvée'), null, t.id, null
  );

  update public.wallet_topups
  set status = 'approved',
      admin_note = p_note,
      processed_at = now(),
      processed_by = auth.uid()
  where id = p_topup_id;
end;
$$;

create or replace function public.admin_reject_topup(
  p_topup_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin requis'; end if;
  update public.wallet_topups
  set status = 'rejected',
      admin_note = p_note,
      processed_at = now(),
      processed_by = auth.uid()
  where id = p_topup_id and status = 'pending';
end;
$$;

-- Admin : mouvement manuel
create or replace function public.admin_wallet_adjust(
  p_profile_id uuid,
  p_direction text,
  p_amount numeric,
  p_note text default null,
  p_driver_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  did uuid := p_driver_id;
begin
  if not public.is_admin() then raise exception 'Admin requis'; end if;
  if did is null then
    select id into did from public.drivers where profile_id = p_profile_id limit 1;
  end if;

  if p_direction = 'in' then
    perform public._credit_wallet(
      p_profile_id, did, p_amount, 'admin_adjust', p_note, null, null, null
    );
  elsif p_direction = 'out' then
    perform public._debit_wallet(
      p_profile_id, did, p_amount, 'admin_adjust', p_note, null, null, null
    );
  else
    raise exception 'direction in|out';
  end if;
end;
$$;

-- Admin : course sans commission
create or replace function public.admin_waive_ride_commission(p_ride_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception 'Admin requis'; end if;
  update public.rides
  set commission_waived = true,
      commission_percent = 0,
      commission_amount = 0
  where id = p_ride_id;
end;
$$;

-- Finaliser course : commission + paiement wallet client
create or replace function public.finalize_ride_payments(p_ride_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.rides%rowtype;
  d public.drivers%rowtype;
  settings public.app_settings%rowtype;
  price numeric;
  pct numeric;
  commission numeric := 0;
  paid_commission boolean := false;
  paid_client boolean := false;
begin
  select * into r from public.rides where id = p_ride_id for update;
  if not found then raise exception 'Course introuvable'; end if;

  price := coalesce(r.final_price, r.estimated_price, 0);

  -- Paiement client wallet / money électronique
  if r.payment_method in ('wallet', 'orange_money', 'airtel_money', 'card')
     and not exists (
       select 1 from public.wallet_ledger
       where ride_id = r.id and kind = 'ride_payment' and direction = 'out'
     )
  then
    perform public._debit_wallet(
      r.client_id, null, price, 'ride_payment',
      'Paiement course', r.id, null, null
    );
    paid_client := true;
  end if;

  -- Commission chauffeur
  if r.driver_id is not null
     and coalesce(r.commission_waived, false) = false
     and coalesce(r.commission_paid, false) = false
  then
    select * into settings from public.app_settings where id = 1;
    if settings.commission_enabled then
      -- Ne pas laisser un 0 client écraser le % admin
      pct := coalesce(
        nullif(r.commission_percent, 0),
        settings.commission_percent,
        0
      );
      commission := round(price * pct / 100.0, 2);
      if commission > 0 then
        select * into d from public.drivers where id = r.driver_id for update;
        perform public._debit_wallet(
          d.profile_id, d.id, commission, 'commission',
          'Commission course', r.id, null, null
        );
        paid_commission := true;
      end if;
      update public.rides
      set commission_percent = pct,
          commission_amount = commission,
          commission_paid = true
      where id = r.id;
    end if;
  elsif coalesce(r.commission_waived, false) then
    update public.rides
    set commission_percent = 0,
        commission_amount = 0,
        commission_paid = true
    where id = r.id;
  end if;

  return jsonb_build_object(
    'commission', commission,
    'paid_commission', paid_commission,
    'paid_client', paid_client
  );
end;
$$;

-- Retrait payé : débiter le wallet chauffeur + ledger
create or replace function public.admin_mark_withdrawal_paid(
  p_withdrawal_id uuid,
  p_note text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  w public.withdrawals%rowtype;
  d public.drivers%rowtype;
begin
  if not public.is_admin() then raise exception 'Admin requis'; end if;
  select * into w from public.withdrawals where id = p_withdrawal_id for update;
  if not found then raise exception 'Retrait introuvable'; end if;
  if w.status = 'paid' then return; end if;

  select * into d from public.drivers where id = w.driver_id for update;
  perform public._debit_wallet(
    d.profile_id, d.id, w.amount_fc, 'withdrawal',
    coalesce(p_note, 'Retrait PawaPay'), null, null, w.id
  );

  update public.withdrawals
  set status = 'paid',
      admin_note = coalesce(p_note, admin_note),
      processed_at = now(),
      processed_by = auth.uid()
  where id = p_withdrawal_id;
end;
$$;

-- RLS
alter table public.wallet_topups enable row level security;
alter table public.wallet_ledger enable row level security;

drop policy if exists "topups_select" on public.wallet_topups;
create policy "topups_select" on public.wallet_topups
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

drop policy if exists "topups_insert" on public.wallet_topups;
create policy "topups_insert" on public.wallet_topups
  for insert to authenticated
  with check (profile_id = auth.uid());

drop policy if exists "topups_admin_update" on public.wallet_topups;
create policy "topups_admin_update" on public.wallet_topups
  for update to authenticated
  using (public.is_admin());

drop policy if exists "ledger_select" on public.wallet_ledger;
create policy "ledger_select" on public.wallet_ledger
  for select to authenticated
  using (profile_id = auth.uid() or public.is_admin());

drop policy if exists "ledger_admin_insert" on public.wallet_ledger;
create policy "ledger_admin_insert" on public.wallet_ledger
  for insert to authenticated
  with check (public.is_admin());

grant execute on function public.request_wallet_topup(numeric, text, text) to authenticated;
grant execute on function public.admin_approve_topup(uuid, text) to authenticated;
grant execute on function public.admin_reject_topup(uuid, text) to authenticated;
grant execute on function public.admin_wallet_adjust(uuid, text, numeric, text, uuid) to authenticated;
grant execute on function public.admin_waive_ride_commission(uuid) to authenticated;
grant execute on function public.finalize_ride_payments(uuid) to authenticated;
grant execute on function public.admin_mark_withdrawal_paid(uuid, text) to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.wallet_topups;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.wallet_ledger;
exception when duplicate_object then null;
end $$;

-- Mettre à jour RPC settings pour solde min chauffeur
create or replace function public.admin_update_settings(p_patch jsonb)
returns public.app_settings
language plpgsql
security definer
set search_path = public
as $$
declare
  row public.app_settings;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé à l''admin';
  end if;

  update public.app_settings s
  set
    active_province_code = coalesce(p_patch->>'active_province_code', s.active_province_code),
    zone_radius_km = coalesce((p_patch->>'zone_radius_km')::numeric, s.zone_radius_km),
    price_per_km_taxi = coalesce((p_patch->>'price_per_km_taxi')::numeric, s.price_per_km_taxi),
    price_per_km_moto = coalesce((p_patch->>'price_per_km_moto')::numeric, s.price_per_km_moto),
    price_per_km_pickup = coalesce((p_patch->>'price_per_km_pickup')::numeric, s.price_per_km_pickup),
    base_fare_taxi = coalesce((p_patch->>'base_fare_taxi')::numeric, s.base_fare_taxi),
    base_fare_moto = coalesce((p_patch->>'base_fare_moto')::numeric, s.base_fare_moto),
    base_fare_pickup = coalesce((p_patch->>'base_fare_pickup')::numeric, s.base_fare_pickup),
    commission_percent = coalesce((p_patch->>'commission_percent')::numeric, s.commission_percent),
    commission_enabled = coalesce((p_patch->>'commission_enabled')::boolean, s.commission_enabled),
    pawapay_enabled = coalesce((p_patch->>'pawapay_enabled')::boolean, s.pawapay_enabled),
    min_withdrawal_fc = coalesce((p_patch->>'min_withdrawal_fc')::numeric, s.min_withdrawal_fc),
    min_driver_balance_fc = coalesce((p_patch->>'min_driver_balance_fc')::numeric, s.min_driver_balance_fc),
    updated_at = now(),
    updated_by = auth.uid()
  where s.id = 1
  returning * into row;

  if p_patch ? 'active_province_code' then
    update public.service_provinces set is_active = false;
    update public.service_provinces
    set is_active = true, updated_at = now()
    where code = p_patch->>'active_province_code';
  end if;

  return row;
end;
$$;
