// PragyaGo: topup-verify
// Confirms a top-up WITH PAYSTACK before crediting anything:
//   status 'success', currency GHS, amount exactly as started, same reference.
// Then credits the balance once (credit_topup is idempotent).
// Body: { reference }
// Secret: PAYSTACK_SECRET_KEY
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'unauthorized' }, 401);
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: 'unauthorized' }, 401);

    const body = await req.json().catch(() => ({}));
    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (!reference) return json({ error: 'missing_reference' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    // The top-up must have been started by THIS user.
    const { data: topup } = await admin
      .from('wallet_topups').select('*')
      .eq('reference', reference).eq('user_id', user.id).maybeSingle();
    if (!topup) return json({ error: 'unknown_reference' }, 404);
    if (topup.status === 'credited') {
      return json({ success: true, already_credited: true, amount: Number(topup.amount_ghs) });
    }

    const secret = Deno.env.get('PAYSTACK_SECRET_KEY');
    if (!secret) {
      console.error('PAYSTACK_SECRET_KEY missing');
      return json({ error: 'payments_not_configured' }, 500);
    }

    const psRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secret}` } },
    );
    const ps = await psRes.json().catch(() => ({}));
    const d = ps?.data;

    if (!psRes.ok || !ps?.status || !d) {
      console.error('paystack verify error', psRes.status, ps?.message);
      return json({ success: false, status: 'unverified', message: 'Could not confirm the payment yet. Try again shortly.' }, 202);
    }

    if (d.status !== 'success') {
      if (['failed', 'abandoned', 'reversed'].includes(d.status) && topup.status === 'pending') {
        await admin.from('wallet_topups')
          .update({ status: 'failed', failure_reason: `paystack: ${d.status}` })
          .eq('id', topup.id).eq('status', 'pending');
      }
      return json({ success: false, status: d.status });   // e.g. 'ongoing' / 'pending' → app can retry
    }

    const expectedPesewas = Math.round(Number(topup.amount_ghs) * 100);
    if (d.reference !== reference || d.currency !== 'GHS' || Number(d.amount) !== expectedPesewas) {
      console.error('topup mismatch', reference, d.currency, d.amount, expectedPesewas);
      await admin.from('wallet_topups')
        .update({ status: 'failed', failure_reason: `mismatch: ${d.currency} ${d.amount} vs ${expectedPesewas}` })
        .eq('id', topup.id).eq('status', 'pending');
      return json({ success: false, status: 'mismatch', message: 'Payment details did not match. Please contact support.' }, 409);
    }

    const { data: credit, error: creditError } = await admin.rpc('credit_topup', {
      p_reference: reference,
      p_channel: typeof d.channel === 'string' ? d.channel : null,
    });
    if (creditError || !credit?.success) {
      console.error('credit_topup failed', creditError?.message, JSON.stringify(credit));
      return json({ error: 'credit_failed' }, 500);
    }

    return json({
      success: true,
      amount: Number(credit.amount),
      balance: credit.balance !== undefined ? Number(credit.balance) : undefined,
      already_credited: !!credit.already_credited,
    });
  } catch (e) {
    console.error('topup-verify error:', (e as Error)?.message);
    return json({ error: 'server_error' }, 500);
  }
});
