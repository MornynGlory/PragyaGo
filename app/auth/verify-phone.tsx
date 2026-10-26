import { supabase } from '@/lib/supabase';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function maskPhone(phone: string): string {
  if (phone.length < 6) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-3);
}

export default function VerifyPhoneScreen() {
  const router = useRouter();
  const { phone } = useLocalSearchParams<{ phone: string }>();

  const [enteredCode, setEnteredCode] = useState('');
  const [sending, setSending] = useState(false);
  const [sendFailed, setSendFailed] = useState(false);
  const [sendError, setSendError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [maskedPhoneFromServer, setMaskedPhoneFromServer] = useState<string | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    dispatchCode();
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      sub.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLogout = async () => {
    try { await supabase.auth.signOut(); } catch {}
    router.replace('/' as any);
  };

  const routeByRole = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/' as any); return; }
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .single();
      if (profile?.role === 'driver') {
        router.replace('/auth/verify-driver' as any);
      } else {
        router.replace('/rider/home' as any);
      }
    } catch {
      router.replace('/rider/home' as any);
    }
  };

  const startCooldown = (seconds: number) => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setCooldown(Math.max(0, Math.floor(seconds)));
    cooldownRef.current = setInterval(() => {
      setCooldown(prev => {
        if (prev <= 1) { clearInterval(cooldownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  const dispatchCode = async () => {
    setSending(true);
    setSendFailed(false);
    setSendError('');
    setVerifyError('');
    try {
      const { data, error } = await supabase.functions.invoke('otp-send', { body: {} });

      if (error || !data) {
        setSendFailed(true);
        setSendError('Could not send SMS. Please try again.');
        return;
      }

      if (data.error) {
        switch (data.error) {
          case 'too_soon': {
            const retry = Number(data.retry_after_seconds) || 60;
            startCooldown(retry);
            setSendError(`Please wait ${retry}s before requesting another code.`);
            setSendFailed(false);
            return;
          }
          case 'too_many_requests':
            setSendFailed(true);
            setSendError('Too many attempts. Please try again later.');
            return;
          case 'no_phone_on_profile':
            setSendFailed(true);
            setSendError('No phone number on file. Please contact support.');
            return;
          case 'invalid_phone':
            setSendFailed(true);
            setSendError('The phone number on your profile looks invalid.');
            return;
          case 'sms_failed':
          default:
            setSendFailed(true);
            setSendError('Could not send SMS. Please try again.');
            return;
        }
      }

      if (data.already_verified) {
        await routeByRole();
        return;
      }

      if (data.phone_masked) setMaskedPhoneFromServer(data.phone_masked);
      startCooldown(Number(data.expires_in_seconds) || 60);
    } catch (err) {
      setSendFailed(true);
      setSendError(err instanceof Error ? err.message : 'Failed to send code. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const handleVerify = async () => {
    if (enteredCode.length !== 6) {
      setVerifyError('Please enter the 6-digit code.');
      return;
    }
    setVerifying(true);
    setVerifyError('');
    try {
      const { data, error } = await supabase.functions.invoke('otp-verify', {
        body: { code: enteredCode },
      });

      if (error || !data) {
        setVerifyError('Verification failed. Please try again.');
        return;
      }

      if (data.error) {
        switch (data.error) {
          case 'wrong_code': {
            const left = data.attempts_left;
            setVerifyError(typeof left === 'number'
              ? `Wrong code — ${left} attempt${left === 1 ? '' : 's'} left.`
              : 'Wrong code. Please try again.');
            return;
          }
          case 'code_expired':
            setVerifyError('Code expired, tap Resend.');
            return;
          case 'no_pending_code':
            setVerifyError('No pending code. Tap Resend to get a new one.');
            return;
          case 'too_many_attempts':
            setVerifyError('Too many attempts. Tap Resend for a new code.');
            return;
          case 'invalid_code_format':
            setVerifyError('Please enter the 6-digit code.');
            return;
          default:
            setVerifyError('Verification failed. Please try again.');
            return;
        }
      }

      if (data.ok) {
        await routeByRole();
        return;
      }
      setVerifyError('Verification failed. Please try again.');
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Verification failed. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const displayPhone = maskedPhoneFromServer ?? maskPhone(phone ?? '');

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <Text style={styles.emoji}>📱</Text>
        <Text style={styles.title}>Verify Your Number</Text>
        <Text style={styles.subtitle}>
          {'We sent a 6-digit code to\n'}
          <Text style={styles.phoneText}>{displayPhone}</Text>
        </Text>

        {sending && (
          <View style={styles.sendingRow}>
            <ActivityIndicator color="#1D9E75" size="small" />
            <Text style={styles.sendingText}>Sending code…</Text>
          </View>
        )}

        {sendFailed && !sending && (
          <View style={styles.sendFailedBox}>
            <Text style={styles.sendFailedText}>{sendError || 'Could not send SMS.'}</Text>
            <Pressable style={styles.tryAgainButton} onPress={dispatchCode} disabled={sending}>
              <Text style={styles.tryAgainText}>Try Again</Text>
            </Pressable>
          </View>
        )}

        {!sending && (
          <>
            <TextInput
              style={styles.codeInput}
              value={enteredCode}
              onChangeText={v => {
                setEnteredCode(v.replace(/\D/g, '').slice(0, 6));
                setVerifyError('');
              }}
              placeholder="- - - - - -"
              placeholderTextColor="#ccc"
              keyboardType="number-pad"
              maxLength={6}
              textAlign="center"
              autoFocus
              editable={!verifying}
            />

            {verifyError ? <Text style={styles.errorText}>{verifyError}</Text> : null}

            <Pressable
              style={[
                styles.verifyButton,
                (verifying || enteredCode.length < 6) && styles.buttonDisabled,
              ]}
              onPress={handleVerify}
              disabled={verifying || enteredCode.length < 6}
            >
              {verifying
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.verifyButtonText}>Verify</Text>}
            </Pressable>

            {!sendFailed && (
              <Pressable
                style={styles.resendButton}
                onPress={dispatchCode}
                disabled={sending || cooldown > 0}
              >
                <Text style={[styles.resendText, (sending || cooldown > 0) && styles.resendTextDim]}>
                  {cooldown > 0 ? `Resend code in ${cooldown}s` : 'Resend code'}
                </Text>
              </Pressable>
            )}
          </>
        )}
        <TouchableOpacity onPress={handleLogout} style={{ marginTop: 24, paddingVertical: 10 }}>
          <Text style={{ color: '#888', fontSize: 14, textAlign: 'center' }}>Log out</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fff' },
  container: { flex: 1, paddingHorizontal: 28, paddingTop: 48, alignItems: 'center' },
  emoji: { fontSize: 52, marginBottom: 16 },
  title: { fontSize: 24, fontWeight: 'bold', color: '#1D9E75', marginBottom: 10 },
  subtitle: { fontSize: 15, color: '#666', textAlign: 'center', lineHeight: 22, marginBottom: 28 },
  phoneText: { fontWeight: '700', color: '#333' },
  sendingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 24 },
  sendingText: { color: '#888', fontSize: 13 },
  sendFailedBox: {
    width: '100%',
    backgroundColor: '#FFF5F5',
    borderWidth: 1,
    borderColor: '#FFCDD2',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    marginBottom: 20,
    gap: 12,
  },
  sendFailedText: { color: '#C0392B', fontSize: 13, textAlign: 'center', lineHeight: 19 },
  tryAgainButton: {
    backgroundColor: '#FF3B30',
    paddingVertical: 10,
    paddingHorizontal: 32,
    borderRadius: 8,
  },
  tryAgainText: { color: '#fff', fontSize: 14, fontWeight: '700' },
  codeInput: {
    width: '100%',
    borderWidth: 2,
    borderColor: '#1D9E75',
    borderRadius: 12,
    paddingVertical: 18,
    fontSize: 30,
    fontWeight: 'bold',
    color: '#333',
    letterSpacing: 12,
    marginBottom: 12,
    backgroundColor: '#F9FFFE',
  },
  errorText: { color: '#FF3B30', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  verifyButton: {
    width: '100%',
    backgroundColor: '#1D9E75',
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonDisabled: { opacity: 0.5 },
  verifyButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  resendButton: { paddingVertical: 10 },
  resendText: { color: '#1D9E75', fontSize: 14, fontWeight: '600' },
  resendTextDim: { color: '#aaa' },
});
