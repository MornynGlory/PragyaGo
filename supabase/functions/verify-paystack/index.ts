import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    // 1. Verify caller JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Unauthorized' }, 401);

    const anonClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    // Admin client bypasses RLS for balance updates
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { reference, type } = await req.json() as { reference: string; type: 'gocash' | 'wallet' };
    if (!reference || !type) return json({ error: 'Missing reference or type' }, 400);

    // 2. Idempotency — if already processed return early
    const { data: existing } = await admin
      .from('payments')
      .select('id, amount')
      .eq('reference', reference)
      .maybeSingle();
    if (existing) return json({ success: true, amount: existing.amount, alreadyProcessed: true });

    // 3. Verify with Paystack (secret key stays here, never in client)
    const psRes = await fetch(
      `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${Deno.env.get('PAYSTACK_SECRET_KEY')}` } }
    );
    const ps = await psRes.json();

    if (!ps.status || ps.data?.status !== 'success') {
      return json({
        success: false,
        status: ps.data?.status ?? 'failed',
        message: ps.message ?? 'Payment not successful',
      });
    }

    const amountGhs = ps.data.amount / 100; // pesewas → GHS

    // 4. Update balance
    if (type === 'gocash') {
      const { data: profile } = await admin
        .from('profiles')
        .select('go_cash_balance')
        .eq('id', user.id)
        .single();
      await admin
        .from('profiles')
        .update({ go_cash_balance: (profile?.go_cash_balance ?? 0) + amountGhs })
        .eq('id', user.id);
    } else if (type === 'wallet') {
      const { data: driver } = await admin
        .from('drivers')
        .select('id, wallet_balance')
        .eq('profile_id', user.id)
        .single();
      if (driver) {
        await admin
          .from('drivers')
          .update({ wallet_balance: (driver.wallet_balance ?? 0) + amountGhs })
          .eq('id', driver.id);
      }
    }

    // 5. Record payment (prevents double-credit on retry)
    await admin.from('payments').insert({
      user_id: user.id,
      reference,
      amount: amountGhs,
      type,
      status: 'success',
      created_at: new Date().toISOString(),
    });

    return json({ success: true, amount: amountGhs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: message }, 500);
  }
});
