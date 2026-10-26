// PragyaGo: auth-login
// Phone + password → Supabase session. The email lookup happens HERE on the
// server, so the app never needs to read the profiles table before login.
// Deploy with "Verify JWT" OFF (riders/drivers aren't logged in yet).
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

// Ghana numbers may be stored as 0XXXXXXXXX, 233XXXXXXXXX or +233XXXXXXXXX.
function phoneVariants(raw: string): string[] {
  const digits = raw.replace(/[^\d]/g, '');
  let local = digits;
  if (digits.startsWith('233') && digits.length === 12) local = '0' + digits.slice(3);
  if (!local.startsWith('0') && local.length === 9) local = '0' + local;
  const intl = local.startsWith('0') ? '233' + local.slice(1) : local;
  return Array.from(new Set([raw.trim(), local, intl, '+' + intl]));
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!phone || !password) return json({ error: 'missing_fields' }, 400);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const { data: profile } = await admin
      .from('profiles')
      .select('email, role')
      .in('phone', phoneVariants(phone))
      .limit(1)
      .maybeSingle();

    // Same answer whether the number is unknown or the password is wrong,
    // so nobody can test which numbers are registered.
    if (!profile?.email) return json({ error: 'invalid_credentials' }, 401);

    const anon = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { auth: { persistSession: false } },
    );
    const { data, error } = await anon.auth.signInWithPassword({
      email: profile.email,
      password,
    });
    if (error || !data.session) return json({ error: 'invalid_credentials' }, 401);

    return json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      role: profile.role,
    });
  } catch (e) {
    console.error('auth-login error:', (e as Error)?.message);
    return json({ error: 'server_error' }, 500);
  }
});
