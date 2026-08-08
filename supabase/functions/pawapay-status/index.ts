import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Poll statut dépôt PawaPay + confirm via webhook RPC (bridge ClickPro).
 * Toujours HTTP 200 { ok, error? } pour supabase.functions.invoke.
 */

function json(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function pawapayBase() {
  return (
    Deno.env.get('PAWAPAY_BASE_URL') ||
    (Deno.env.get('PAWAPAY_ENV') === 'production'
      ? 'https://api.pawapay.io'
      : 'https://api.sandbox.pawapay.io')
  ).replace(/\/$/, '');
}

function mapPawaStatus(raw: unknown): string {
  return String(raw ?? 'UNKNOWN').toUpperCase();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader.startsWith('Bearer ')) {
      return json({ ok: false, error: 'Non authentifié' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const pawapayToken = Deno.env.get('PAWAPAY_API_TOKEN');
    if (!pawapayToken) {
      return json({ ok: false, error: 'PAWAPAY_API_TOKEN manquant' });
    }

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const admin = createClient(supabaseUrl, serviceKey);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return json({ ok: false, error: 'Session invalide' });

    const body = await req.json().catch(() => ({}));
    const depositId = String(
      body.depositId ?? body.deposit_id ?? '',
    ).trim();
    if (!depositId) return json({ ok: false, error: 'depositId requis' });

    const { data: payment } = await admin
      .from('pawapay_payments')
      .select('id, status, amount_cents, wallet_transaction_id')
      .eq('pawapay_reference', depositId)
      .maybeSingle();

    const { data: topup } = await admin
      .from('wallet_topups')
      .select('id, status, profile_id')
      .eq('deposit_id', depositId)
      .maybeSingle();

    if (topup && topup.profile_id !== user.id) {
      return json({ ok: false, error: 'Recharge introuvable' });
    }

    if (topup?.status === 'approved' || payment?.status === 'completed') {
      // Rattrapage ClickPro si webhook Taxi a déjà marqué completed
      if (payment?.status === 'completed' && topup?.status !== 'approved') {
        await admin.rpc('confirm_wallet_deposit', {
          p_pawapay_reference: depositId,
          p_status: 'completed',
        });
      }
      return json({
        ok: true,
        status: 'COMPLETED',
        depositId,
        credited: true,
        topupStatus: 'approved',
      });
    }

    const pawRes = await fetch(`${pawapayBase()}/v2/deposits/${depositId}`, {
      headers: { Authorization: `Bearer ${pawapayToken}` },
    });
    const pawJson = await pawRes.json().catch(() => ({}));
    const data = (pawJson?.data || pawJson) as Record<string, unknown>;
    const pStatus = mapPawaStatus(data?.status ?? pawJson?.status);

    if (topup) {
      await admin
        .from('wallet_topups')
        .update({
          provider_status: pStatus,
          provider_ref: (data?.providerTransactionId as string) || null,
        })
        .eq('id', topup.id);
    }

    if (pStatus === 'COMPLETED') {
      const { error } = await admin.rpc('confirm_wallet_deposit', {
        p_pawapay_reference: depositId,
        p_status: 'completed',
      });
      if (error) return json({ ok: false, error: error.message, status: pStatus });
      return json({
        ok: true,
        status: 'COMPLETED',
        depositId,
        credited: true,
        topupStatus: 'approved',
      });
    }

    if (['FAILED', 'REJECTED', 'CANCELLED', 'CANCELED', 'EXPIRED'].includes(pStatus)) {
      await admin.rpc('confirm_wallet_deposit', {
        p_pawapay_reference: depositId,
        p_status: 'failed',
      });
      return json({
        ok: true,
        status: 'FAILED',
        depositId,
        credited: false,
      });
    }

    return json({
      ok: true,
      status: pStatus,
      depositId,
      credited: false,
      topupStatus: topup?.status ?? payment?.status ?? null,
    });
  } catch (e) {
    console.error('pawapay-status', e);
    return json({
      ok: false,
      error: e instanceof Error ? e.message : 'Erreur statut',
    });
  }
});
