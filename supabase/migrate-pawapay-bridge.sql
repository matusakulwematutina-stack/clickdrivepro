-- Bridge PawaPay Taxi des affaires → ClickPro Drive
-- Même projet Supabase (ngcjwhmjontbytzlzzlh) :
--   Taxi crédite wallets.balance_cents via confirm_wallet_deposit
--   ClickPro lit profiles/drivers.wallet_balance + wallet_ledger

create or replace function public.confirm_wallet_deposit(
  p_pawapay_reference text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment record;
  v_wallet_id uuid;
  v_amount_cents integer;
  v_profile_id uuid;
  v_name text;
  v_targets uuid[];
  v_fc text;
  v_driver_id uuid;
  v_topup_id uuid;
  v_clickpro_credited boolean := false;
begin
  select * into v_payment
  from public.pawapay_payments
  where pawapay_reference = p_pawapay_reference
  for update;

  if v_payment is null then
    raise exception 'Pawapay payment not found';
  end if;

  v_amount_cents := v_payment.amount_cents;

  select wt.wallet_id, w.profile_id
  into v_wallet_id, v_profile_id
  from public.wallet_transactions wt
  join public.wallets w on w.id = wt.wallet_id
  where wt.id = v_payment.wallet_transaction_id;

  select d.id into v_driver_id
  from public.drivers d
  where d.profile_id = v_profile_id;

  -- Idempotence Taxi + rattrapage ClickPro si besoin
  if v_payment.status = 'completed' and lower(p_status) = 'completed' then
    select id into v_topup_id
    from public.wallet_topups
    where deposit_id = p_pawapay_reference::uuid
    limit 1;

    if v_topup_id is not null then
      perform public.complete_pawapay_topup(
        p_pawapay_reference::uuid, null, 'COMPLETED'
      );
      v_clickpro_credited := true;
    elsif v_profile_id is not null and not exists (
      select 1 from public.wallet_ledger
      where profile_id = v_profile_id
        and kind = 'topup'
        and note = 'Recharge PawaPay ' || p_pawapay_reference
    ) then
      perform public._credit_wallet(
        v_profile_id, v_driver_id, v_amount_cents::numeric, 'topup',
        'Recharge PawaPay ' || p_pawapay_reference,
        null, null, null
      );
      v_clickpro_credited := true;
    end if;

    return jsonb_build_object(
      'ok', true,
      'already', true,
      'clickpro_credited', v_clickpro_credited
    );
  end if;

  update public.pawapay_payments
  set
    status = p_status,
    kind = coalesce(nullif(kind, ''), 'deposit'),
    updated_at = now()
  where id = v_payment.id;

  if lower(p_status) = 'completed' then
    update public.wallets
    set balance_cents = balance_cents + v_amount_cents,
        updated_at = now()
    where id = v_wallet_id;

    update public.wallet_transactions
    set status = 'completed',
        updated_at = now()
    where id = v_payment.wallet_transaction_id;

    begin
      update public.platform_settings
      set
        mm_treasury_cents = mm_treasury_cents + v_amount_cents,
        updated_at = now()
      where id = 1;
    exception when undefined_column or undefined_table then
      null;
    end;

    begin
      perform public.settle_driver_commission_debt(v_driver_id);
    exception when undefined_function then
      null;
    end;

    -- ClickPro : créditer profiles/drivers.wallet_balance
    select id into v_topup_id
    from public.wallet_topups
    where deposit_id = p_pawapay_reference::uuid
    limit 1;

    if v_topup_id is not null then
      perform public.complete_pawapay_topup(
        p_pawapay_reference::uuid,
        null,
        'COMPLETED'
      );
      v_clickpro_credited := true;
    elsif not exists (
      select 1
      from public.wallet_ledger
      where profile_id = v_profile_id
        and kind = 'topup'
        and note = 'Recharge PawaPay ' || p_pawapay_reference
    ) then
      perform public._credit_wallet(
        v_profile_id,
        v_driver_id,
        v_amount_cents::numeric,
        'topup',
        'Recharge PawaPay ' || p_pawapay_reference,
        null,
        null,
        null
      );
      v_clickpro_credited := true;
    end if;

    begin
      select coalesce(nullif(trim(full_name), ''), phone, 'Utilisateur')
      into v_name
      from public.profiles
      where id = v_profile_id;

      v_fc := trim(to_char(v_amount_cents, 'FM999G999G999'));
      v_targets := array[v_profile_id] || public.admin_profile_ids();
      select array_agg(distinct x) into v_targets from unnest(v_targets) as x where x is not null;

      perform public.notify_profiles_alert(
        v_targets,
        'wallet_deposit_success',
        'Dépôt Mobile Money réussi',
        format('%s a versé %s FC via PawaPay.', v_name, v_fc),
        jsonb_build_object(
          'amount_cents', v_amount_cents,
          'pawapay_reference', p_pawapay_reference,
          'profile_id', v_profile_id,
          'payer_name', v_name
        ),
        true
      );
    exception when undefined_function then
      null;
    end;

    return jsonb_build_object(
      'ok', true,
      'amount_cents', v_amount_cents,
      'profile_id', v_profile_id,
      'clickpro_credited', v_clickpro_credited
    );
  else
    update public.wallet_transactions
    set status = 'failed',
        updated_at = now()
    where id = v_payment.wallet_transaction_id;

    update public.wallet_topups
    set status = 'failed',
        provider_status = upper(p_status),
        processed_at = now()
    where deposit_id = p_pawapay_reference::uuid
      and status in ('pending', 'processing');

    return jsonb_build_object('ok', true, 'status', 'failed');
  end if;
end;
$$;

grant execute on function public.confirm_wallet_deposit(text, text) to authenticated, service_role;

notify pgrst, 'reload schema';
