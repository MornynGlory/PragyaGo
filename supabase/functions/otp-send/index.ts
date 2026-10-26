// PragyaGo: otp-send
// Sends a phone-verification code via SasuSync to the LOGGED-IN user's own
// phone number (taken from their profile, never from the request), so the
// app can't be used to send SMS to arbitrary numbers.
// Secrets: SASUSYNC_API_KEY (required), SASUSYNC_OTP_MESSAGE (optional).
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

const EXPIRY_MINUTES = 5;
const MIN_SECONDS_BETWEEN_SENDS = 60;
const MAX_SENDS_PER_HOUR = 5;

// 0XXXXXXXXX / +233… / 233… → 233XXXXXXXXX
function toGhanaIntl(raw: string): string | null {
  const d = (raw ?? '').replace(/[^\d]/g, '');
  if (d.length === 10 && d.startsWith('0')) return '233' + d.slice(1);
  if (d.length === 12 && d.startsWith('233')) return d;
  if (d.length === 9) return '233' + d;
  return null;
}

// SasuSync's reply shape isn't documented here; accept the common places an id appears.
function pickOtpId(r: any): string | null {
  const v = r?.otp_id ?? r?.data?.otp_id ?? r?.id ?? r?.data?.id ?? r?.data?.otp?.id;
  return v === undefined || v === null ? null : String(v);
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

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: profile } = await admin
      .from('profiles').select('phone, phone_verified').eq('id', user.id).maybeSingle();
    if (!profile?.phone) return json({ error: 'no_phone_on_profile' }, 400);
    if (profile.phone_verified) return json({ ok: true, already_verified: true });

    const number = toGhanaIntl(profile.phone);
    if (!number) return json({ error: 'invalid_phone' }, 400);

    // Rate limits: protect the SMS budget and stop abuse.
    const now = new Date();
    const { data: prev } = await admin
      .from('phone_verification_requests').select('*').eq('user_id', user.id).maybeSingle();
    if (prev?.last_sent_at) {
      const wait = MIN_SECONDS_BETWEEN_SENDS - (now.getTime() - new Date(prev.last_sent_at).getTime()) / 1000;
      if (wait > 0) return json({ error: 'too_soon', retry_after_seconds: Math.ceil(wait) }, 429);
    }
    const windowStart = prev?.window_start ? new Date(prev.window_start) : now;
    const inWindow = now.getTime() - windowStart.getTime() < 60 * 60 * 1000;
    const sendsInWindow = inWindow ? (prev?.sends_in_window ?? 0) : 0;
    if (sendsInWindow >= MAX_SENDS_PER_HOUR) return json({ error: 'too_many_requests' }, 429);

    const apiKey = Deno.env.get('SASUSYNC_API_KEY');
    if (!apiKey) {
      console.error('SASUSYNC_API_KEY missing');
      return json({ error: 'sms_not_configured' }, 500);
    }

    const message = Deno.env.get('SASUSYNC_OTP_MESSAGE') ??
      `Your PragyaGo verification code is %otp_code%. It expires in ${EXPIRY_MINUTES} minutes.`;

    const res = await fetch('https://sms.sasusync.com/otp/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify({
        number,
        sender_id: 'PragyaGo',
        message,
        medium: 'sms',
        otp_type: 'numeric',
        expiry: EXPIRY_MINUTES,
        length: 6,
      }),
    });
    const body = await res.json().catch(() => ({}));
    const otpId = pickOtpId(body);
    if (!res.ok || !otpId) {
      // Log SasuSync's reply (it contains no secrets) so failures can be diagnosed.
      console.error('sasusync generate failed', res.status, JSON.stringify(body));
      return json({ error: 'sms_failed' }, 502);
    }

    await admin.from('phone_verification_requests').upsert({
      user_id: user.id,
      phone: number,
      otp_id: otpId,
      expires_at: new Date(now.getTime() + EXPIRY_MINUTES * 60 * 1000).toISOString(),
      attempts: 0,
      last_sent_at: now.toISOString(),
      window_start: inWindow ? windowStart.toISOString() : now.toISOString(),
      sends_in_window: sendsInWindow + 1,
    });

    return json({
      ok: true,
      phone_masked: number.slice(0, 5) + '****' + number.slice(-3),
      expires_in_seconds: EXPIRY_MINUTES * 60,
    });
  } catch (e) {
    console.error('otp-send error:', (e as Error)?.message);
    return json({ error: 'server_error' }, 500);
  }
});
