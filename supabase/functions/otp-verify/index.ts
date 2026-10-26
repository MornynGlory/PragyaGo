// PragyaGo: otp-verify
// Checks the code with SasuSync using the otp_id stored for THIS user, and only
// then marks the phone verified. Max 5 wrong attempts per code.
// Secret: SASUSYNC_API_KEY.
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

const MAX_ATTEMPTS = 5;

// SasuSync's success shape isn't documented here; accept the common forms.
function isVerified(ok: boolean, r: any): boolean {
  if (!ok) return false;
  return r?.success === true || r?.verified === true || r?.valid === true ||
    r?.status === 'success' || r?.status === 'verified' ||
    r?.data?.verified === true || r?.data?.valid === true;
}

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

    const reqBody = await req.json().catch(() => ({}));
    const code = typeof reqBody.code === 'string' ? reqBody.code.trim() : '';
    if (!/^\d{6}$/.test(code)) return json({ error: 'invalid_code_format' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: pending } = await admin
      .from('phone_verification_requests').select('*').eq('user_id', user.id).maybeSingle();
    if (!pending?.otp_id) return json({ error: 'no_pending_code' }, 400);
    if (new Date(pending.expires_at) < new Date()) return json({ error: 'code_expired' }, 400);
    if ((pending.attempts ?? 0) >= MAX_ATTEMPTS) return json({ error: 'too_many_attempts' }, 429);

    // Count the attempt before asking SasuSync, so failures can't be retried for free.
    await admin.from('phone_verification_requests')
      .update({ attempts: (pending.attempts ?? 0) + 1 }).eq('user_id', user.id);

    const apiKey = Deno.env.get('SASUSYNC_API_KEY');
    if (!apiKey) {
      console.error('SASUSYNC_API_KEY missing');
      return json({ error: 'sms_not_configured' }, 500);
    }

    const numericId = Number(pending.otp_id);
    const res = await fetch('https://sms.sasusync.com/otp/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        otp_id: Number.isFinite(numericId) ? numericId : pending.otp_id,
        code,
      }),
    });
    const body = await res.json().catch(() => ({}));

    if (!isVerified(res.ok, body)) {
      if (!res.ok) console.error('sasusync verify reply', res.status, JSON.stringify(body));
      const left = Math.max(MAX_ATTEMPTS - ((pending.attempts ?? 0) + 1), 0);
      return json({ error: 'wrong_code', attempts_left: left }, 400);
    }

    await admin.from('profiles').update({ phone_verified: true }).eq('id', user.id);
    await admin.from('phone_verification_requests').delete().eq('user_id', user.id);

    return json({ ok: true });
  } catch (e) {
    console.error('otp-verify error:', (e as Error)?.message);
    return json({ error: 'server_error' }, 500);
  }
});
