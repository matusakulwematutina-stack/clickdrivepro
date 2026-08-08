import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import {
  DEPOSIT_MIN_CDF,
  PROVIDER_MAP,
  failureMessage,
  formatAmountCdf,
  isValidOperator,
  normalizePhone,
  type MmOperator,
} from '../_shared/pawapay.ts';

/**
 * Dépôts PawaPay v2 — même contrat que Taxi des affaires
 * (projet partagé ngcjwhmjontbytzlzzlh).
 *
 * Wallet ClickPro : amount_cents + operator + phone
 * → initiate_wallet_deposit + ligne wallet_topups (UI admin)
 * → callback pawapay-webhook → confirm_wallet_deposit (bridge ClickPro)
 */

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function checkDepositStatus(
  base: string,
  token: string,
  depositId: string,
): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${base}/v2/deposits/${depositId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });
    const body = await res.json();
    if (!res.ok) return null;
    return body as Record<string, unknown>;
  } catch {
    return null;
  }
}

function initiationOk(pp: Record<string, unknown>): boolean {
  const status = String(pp.status ?? '').toUpperCase();
  return status === 'ACCEPTED' || status === 'DUPLICATE_IGNORED';
}

function initiationRejected(pp: Record<string, unknown>): boolean {
  return String(pp.status ?? '').toUpperCase() === 'REJECTED';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const pawapayToken = Deno.env.get('PAWAPAY_API_TOKEN') ?? '';
    const pawapayBase = (
      Deno.env.get('PAWAPAY_BASE_URL') ?? 'https://api.sandbox.pawapay.io'
    ).replace(/\/$/, '');

    if (!authHeader.startsWith('Bearer ')) {
      return json({ error: 'Authorization Bearer requis' }, 401);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();
    if (userError || !user) {
      return json({ error: 'Session invalide' }, 401);
    }

    const body = await req.json();
    const rideId = body.ride_id as string | undefined;
    // Compat ClickPro ancien client: amount / provider
    const amountCentsWallet = Number(
      body.amount_cents ?? body.amount ?? NaN,
    );
    const phone = normalizePhone(
      String(body.phone ?? body.payer_phone ?? ''),
    );

    let operatorRaw = String(body.operator ?? '');
    if (!operatorRaw && body.provider) {
      const p = String(body.provider);
      if (p === 'AIRTEL_COD') operatorRaw = 'airtel_money';
      else if (p === 'VODACOM_MPESA_COD') operatorRaw = 'mpesa';
      else if (p === 'ORANGE_COD') operatorRaw = 'orange_money';
    }
    if (!operatorRaw) operatorRaw = 'airtel_money';

    if (!isValidOperator(operatorRaw)) {
      return json({ error: 'Opérateur invalide' }, 400);
    }
    const operator: MmOperator = operatorRaw;

    if (phone.length < 11) {
      return json({ error: 'Numéro Mobile Money invalide (MSISDN 243…)' }, 400);
    }

    const depositId = crypto.randomUUID();

    const depositPayload = (amount: string) => ({
      depositId,
      amount,
      currency: 'CDF',
      payer: {
        type: 'MMO',
        accountDetails: {
          phoneNumber: phone,
          provider: PROVIDER_MAP[operator],
        },
      },
      customerMessage: 'ClickDrive',
    });

    async function callPawaPay(
      amount: string,
      metadata: Array<Record<string, unknown>>,
    ): Promise<
      | { ok: true; pawapay: Record<string, unknown> }
      | { ok: false; error: string; details?: unknown }
    > {
      if (!pawapayToken) {
        return {
          ok: false,
          error:
            'PAWAPAY_API_TOKEN manquant. Déploie avec .\\scripts\\deploy-pawapay.ps1 -SetSecrets',
        };
      }

      let ppJson: Record<string, unknown> = {};
      let httpOk = false;
      try {
        const ppRes = await fetch(`${pawapayBase}/v2/deposits`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${pawapayToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ ...depositPayload(amount), metadata }),
        });
        httpOk = ppRes.ok;
        ppJson = (await ppRes.json()) as Record<string, unknown>;
      } catch (e) {
        const checked = await checkDepositStatus(
          pawapayBase,
          pawapayToken,
          depositId,
        );
        if (checked) {
          const st = String(checked.status ?? '').toUpperCase();
          if (
            ['ACCEPTED', 'COMPLETED', 'SUBMITTED', 'PROCESSING', 'FOUND']
              .includes(st)
          ) {
            return { ok: true, pawapay: checked };
          }
          if (['NOT_FOUND', 'FAILED', 'REJECTED'].includes(st)) {
            return {
              ok: false,
              error: 'Dépôt non accepté par PawaPay',
              details: checked,
            };
          }
        }
        return {
          ok: false,
          error: e instanceof Error ? e.message : 'Erreur réseau PawaPay',
        };
      }

      if (initiationRejected(ppJson)) {
        return {
          ok: false,
          error: failureMessage(ppJson, 'PawaPay a rejeté le dépôt'),
          details: ppJson.failureReason ?? ppJson,
        };
      }

      if (!httpOk && !initiationOk(ppJson)) {
        const checked = await checkDepositStatus(
          pawapayBase,
          pawapayToken,
          depositId,
        );
        if (checked) {
          const st = String(checked.status ?? '').toUpperCase();
          if (st === 'NOT_FOUND') {
            return {
              ok: false,
              error: 'Dépôt introuvable chez PawaPay',
              details: checked,
            };
          }
          return { ok: true, pawapay: checked };
        }
        return {
          ok: false,
          error: 'Réponse PawaPay ambiguë',
          details: ppJson,
        };
      }

      if (!initiationOk(ppJson)) {
        return {
          ok: false,
          error: `Statut d'initiation inattendu: ${ppJson.status}`,
          details: ppJson,
        };
      }

      return { ok: true, pawapay: ppJson };
    }

    // ----- Mode portefeuille (ClickPro + Taxi) -----
    if (!rideId && Number.isFinite(amountCentsWallet)) {
      const minDeposit = DEPOSIT_MIN_CDF[operator];
      if (amountCentsWallet < minDeposit) {
        return json({
          error:
            operator === 'mpesa'
              ? `Montant minimum M-Pesa : ${minDeposit} FC`
              : `Montant minimum : ${minDeposit} FC`,
        }, 400);
      }

      const { data, error } = await userClient.rpc('initiate_wallet_deposit', {
        p_amount_cents: amountCentsWallet,
        p_payer_phone: phone,
      });
      if (error) throw error;

      await admin
        .from('pawapay_payments')
        .update({ pawapay_reference: depositId })
        .eq('id', data?.pawapay_payment_id);

      // Ligne ClickPro (admin recharges / historique)
      const { data: driver } = await admin
        .from('drivers')
        .select('id')
        .eq('profile_id', user.id)
        .maybeSingle();

      await admin.from('wallet_topups').insert({
        profile_id: user.id,
        driver_id: driver?.id ?? null,
        amount_fc: amountCentsWallet,
        phone,
        provider: 'pawapay',
        mmo_provider: PROVIDER_MAP[operator],
        currency: 'CDF',
        deposit_id: depositId,
        status: 'processing',
        provider_status: 'INITIATING',
      });

      const result = await callPawaPay(
        formatAmountCdf(amountCentsWallet, operator),
        [
          { kind: 'wallet_deposit' },
          { userId: user.id, isPII: true },
          { app: 'clickpro' },
        ],
      );

      if (!result.ok) {
        await admin.rpc('confirm_wallet_deposit', {
          p_pawapay_reference: depositId,
          p_status: 'failed',
        });
        return json(
          { ok: false, error: result.error, details: result.details },
          400,
        );
      }

      await admin
        .from('wallet_topups')
        .update({
          provider_status: String(result.pawapay.status ?? 'ACCEPTED'),
        })
        .eq('deposit_id', depositId);

      return json({
        ok: true,
        kind: 'wallet_deposit',
        status: 'pending',
        deposit_id: depositId,
        depositId,
        nextStep: result.pawapay.nextStep ?? 'FINAL_STATUS',
        data: { ...data, pawapay_reference: depositId },
        pawapay: result.pawapay,
      });
    }

    // ----- Mode paiement course (Taxi) -----
    if (!rideId) {
      return json({ error: 'ride_id ou amount_cents requis' }, 400);
    }

    const { data: payment, error: initError } = await userClient.rpc(
      'initiate_pawapay_payment',
      {
        p_ride_id: rideId,
        p_phone: phone,
        p_operator: operator,
        p_deposit_id: depositId,
      },
    );
    if (initError) throw initError;

    const rideAmount = Number(payment.amount_cents ?? 0);
    const minDeposit = DEPOSIT_MIN_CDF[operator];
    if (rideAmount < minDeposit) {
      await admin.rpc('fail_mobile_money_payment', {
        p_provider_ref: depositId,
      });
      return json({
        error:
          operator === 'mpesa'
            ? `Course trop basse pour M-Pesa (min. ${minDeposit} FC).`
            : `Montant course sous le minimum PawaPay (${minDeposit} FC).`,
      }, 400);
    }

    const amount = formatAmountCdf(rideAmount, operator);
    if (!pawapayToken) {
      return json({
        ok: true,
        kind: 'ride_payment',
        status: 'pending',
        deposit_id: depositId,
        payment,
        warning: 'PAWAPAY_API_TOKEN manquant : dépôt en pending seulement.',
      });
    }

    const result = await callPawaPay(amount, [
      { kind: 'ride_payment' },
      { rideId },
      { operator },
      { userId: user.id, isPII: true },
    ]);

    if (!result.ok) {
      await admin.rpc('fail_mobile_money_payment', {
        p_provider_ref: depositId,
      });
      return json({ error: result.error, details: result.details }, 400);
    }

    return json({
      ok: true,
      kind: 'ride_payment',
      status: 'pending',
      deposit_id: depositId,
      depositId,
      nextStep: result.pawapay.nextStep ?? 'FINAL_STATUS',
      pawapay: result.pawapay,
      payment,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return json({ ok: false, error: message }, 400);
  }
});
