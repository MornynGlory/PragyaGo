import { Alert } from 'react-native';
import { supabase } from '@/lib/supabase';

type RouterLike = { replace: (path: any) => void };

/**
 * Decide where a logged-in user should land. Call after sign-in / app start.
 * Enforces: suspended, deleted-with-expired-grace-period, phone verification,
 * driver verification status.
 */
export async function routeAfterAuth(router: RouterLike): Promise<void> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { router.replace('/'); return; }

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, phone_verified, suspended, suspension_reason, is_deleted')
    .eq('id', user.id)
    .single();

  if (error || !profile?.role) {
    router.replace('/');
    return;
  }

  if (profile.suspended) {
    const reason = profile.suspension_reason ?? 'No reason provided.';
    await supabase.auth.signOut();
    router.replace('/');
    Alert.alert(
      'Account Suspended',
      `Your account has been suspended.\n\nReason: ${reason}\n\nPlease contact PragyaGo support.`
    );
    return;
  }

  if (profile.is_deleted) {
    const { data: deletion } = await supabase
      .from('account_deletions')
      .select('id, grace_period_ends_at')
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .order('deletion_requested_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const stillInGrace = deletion?.grace_period_ends_at
      ? new Date(deletion.grace_period_ends_at).getTime() > Date.now()
      : false;

    if (stillInGrace) {
      await supabase.from('profiles').update({
        is_deleted: false,
        deletion_requested_at: null,
        deletion_reason: null,
      }).eq('id', user.id);
      await supabase.from('account_deletions').update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
      }).eq('id', deletion!.id);
      Alert.alert('Welcome back!', 'Your account deletion request has been cancelled and your account is active again.');
      // fall through
    } else {
      await supabase.auth.signOut();
      router.replace('/');
      Alert.alert(
        'Account Deleted',
        "This account was permanently deleted after the 30-day grace period. Please register again if you'd like to use PragyaGo."
      );
      return;
    }
  }

  if (!profile.phone_verified) {
    router.replace('/auth/verify-phone');
    return;
  }

  if (profile.role === 'driver') {
    const { data: driver } = await supabase
      .from('drivers')
      .select('verification_status, vehicle_verified')
      .eq('profile_id', user.id)
      .single();
    const status = driver?.verification_status;
    if (status == null) router.replace('/auth/verify-driver');
    else if (status === 'pending') router.replace('/auth/pending');
    else if (status === 'rejected') router.replace('/auth/rejected');
    else if (status === 'approved' && !driver?.vehicle_verified) router.replace('/auth/verify-vehicle');
    else router.replace('/driver/home');
    return;
  }

  router.replace('/rider/home');
}
