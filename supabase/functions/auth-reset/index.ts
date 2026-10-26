// PragyaGo: auth-reset
// "Forgot password" by phone number. The email is looked up on the server and
// never returned, and the reply is the same whether or not the number exists.
// Deploy with "Verify JWT" OFF.
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

function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/[^\d]/g, '');
  let local = digits;
  if (digits.startsWith('233') && digits.length === 12) local = '0' + digits.slice(3);
  if (!local.startsWith('0') && local.length === 9) local = '0' + local;
  const intl = local.startsWith('0') ? '233' + local.slice(1) : local;
  return Array.from(new Set([raw.trim(), local, intl, '+' + intl]));
}

const GENERIC = {
  ok: true,
  message: "If an account exists for this number, we've sent a password reset link to its email.",
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    if (!phone) return json({ error: 'missing_fields' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );
    const { data: profile } = await admin
      .from('profiles')
      .select('email')
      .in('phone', phoneVariants(phone))
      .limit(1)
      .maybeSingle();

    if (profile?.email) {
      const anon = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { auth: { persistSession: false } },
      );
      const { error } = await anon.auth.resetPasswordForEmail(profile.email, {
        redirectTo: 'pragyago://auth/reset-password',
      });
      if (error) console.error('auth-reset send error:', error.message);
    }
    return json(GENERIC);
  } catch (e) {
    console.error('auth-reset error:', (e as Error)?.message);
    return json(GENERIC);
  }
});
