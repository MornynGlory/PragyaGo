// PragyaGo: topup-init
// Starts a Go Cash or driver-wallet top-up. The SERVER creates the Paystack
// reference and records it as pending for this user and amount, so a payment
// can only ever be credited to the person and amount it was started for.
// Body: { kind: 'go_cash' | 'driver_wallet', amount: number (GH₵) }
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

const MIN_GHS = 1;
const MAX_GHS = 2000;

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
    const kind = body.kind;
    const amount = Number(body.amount);
    if (kind !== 'go_cash' && kind !== 'driver_wallet') return json({ error: 'invalid_kind' }, 400);
    if (!Number.isFinite(amount) || amount < MIN_GHS || amount > MAX_GHS) {
      return json({ error: 'invalid_amount', min: MIN_GHS, max: MAX_GHS }, 400);
    }
    const amountGhs = Math.round(amount * 100) / 100;

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: profile } = await admin
      .from('profiles').select('role, email, suspended').eq('id', user.id).maybeSingle();
    if (!profile) return json({ error: 'no_profile' }, 400);
    if (profile.suspended) return json({ error: 'account_suspended' }, 403);
    if (kind === 'driver_wallet') {
      const { data: driver } = await admin
        .from('drivers').select('id').eq('profile_id', user.id).maybeSingle();
      if (!driver) return json({ error: 'not_a_driver' }, 403);
    }

    const email = profile.email ?? user.email;
    if (!email) return json({ error: 'no_email' }, 400);

    const reference =
      `PG${kind === 'go_cash' ? 'GC' : 'DW'}_` + crypto.randomUUID().replace(/-/g, '').slice(0, 20);

    const { error } = await admin.from('wallet_topups').insert({
      user_id: user.id,
      kind,
      reference,
      amount_ghs: amountGhs,
    });
    if (error) {
      console.error('topup-init insert failed', error.message);
      return json({ error: 'server_error' }, 500);
    }

    return json({ reference, amount: amountGhs, email, currency: 'GHS' });
  } catch (e) {
    console.error('topup-init error:', (e as Error)?.message);
    return json({ error: 'server_error' }, 500);
  }
});
