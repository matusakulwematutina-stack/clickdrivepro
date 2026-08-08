import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/**
 * Callback PawaPay (configurer l’URL dans le dashboard PawaPay) :
 * https://<project>.supabase.co/functions/v1/pawapay-callback
 */
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
      },
    });
  }

  try {
    const body = await req.json();
    // Formats v1/v2 possibles
    const depositId =
      body.depositId || body?.data?.depositId || body?.deposit?.depositId;
    const status =
      body.status || body?.data?.status || body?.deposit?.status || '';
    const providerRef =
      body.providerTransactionId ||
      body?.data?.providerTransactionId ||
      null;

    if (!depositId) {
      return new Response(JSON.stringify({ error: 'depositId manquant' }), {
        status: 400,
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    if (String(status).toUpperCase() === 'COMPLETED') {
      const { error } = await admin.rpc('complete_pawapay_topup', {
        p_deposit_id: depositId,
        p_provider_ref: providerRef,
        p_provider_status: 'COMPLETED',
      });
      if (error) {
        console.error('complete_pawapay_topup', error.message);
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
        });
      }
    } else if (String(status).toUpperCase() === 'FAILED') {
      await admin
        .from('wallet_topups')
        .update({ status: 'failed', provider_status: 'FAILED' })
        .eq('deposit_id', depositId);
    } else {
      await admin
        .from('wallet_topups')
        .update({ provider_status: String(status) })
        .eq('deposit_id', depositId);
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : 'Erreur' }),
      { status: 500 },
    );
  }
});
