import { supabase } from '@/lib/supabase';
import { sendOTP } from '@/lib/arkesel';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

function generateCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

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
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    dispatchCode();
    return () => { if (cooldownRef.current) clearInterval(cooldownRef.current); };
  }, []);

  const startCooldown = () => {
    setCooldown(60);
    if (cooldownRef.current) clearInterval(cooldownRef.current);
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
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const code = generateCode();
      const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const { error: storeError } = await supabase
        .from('profiles')
        .update({ otp_code: code, otp_expires_at: expiresAt })
        .eq('id', user.id);
      if (storeError) throw storeError;

      const result = await sendOTP(phone ?? '', code);
      if (!result.success) {
        setSendFailed(true);
        setSendError(result.message ?? 'Could not send SMS. Please try again.');
      }
    } catch (err) {
      setSendFailed(true);
      setSendError(err instanceof Error ? err.message : 'Failed to send code. Please try again.');
    } finally {
      setSending(false);
    }
    startCooldown();
  };

  const handleVerify = async () => {
    if (enteredCode.length !== 6) {
      setVerifyError('Please enter the 6-digit code.');
      return;
    }
    setVerifying(true);
    setVerifyError('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile, error: fetchError } = await supabase
        .from('profiles')
        .select('otp_code, otp_expires_at')
        .eq('id', user.id)
        .single();
      if (fetchError || !profile) throw new Error('Could not fetch verification record.');

      if (!profile.otp_expires_at || new Date(profile.otp_expires_at) < new Date()) {
        setVerifyError('Code has expired. Please request a new one.');
        setVerifying(false);
        return;
      }

      if (enteredCode !== profile.otp_code) {
        setVerifyError('Invalid code. Please try again.');
        setVerifying(false);
        return;
      }

      const { error: updateError } = await supabase
        .from('profiles')
        .update({ phone_verified: true, otp_code: null, otp_expires_at: null })
        .eq('id', user.id);
      if (updateError) throw updateError;

      router.replace('/rider/home' as any);
    } catch (err) {
      setVerifyError(err instanceof Error ? err.message : 'Verification failed. Please try again.');
      setVerifying(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <Text style={styles.emoji}>📱</Text>
        <Text style={styles.title}>Verify Your Number</Text>
        <Text style={styles.subtitle}>
          {'We sent a 6-digit code to\n'}
          <Text style={styles.phoneText}>{maskPhone(phone ?? '')}</Text>
        </Text>

        {/* Loading state */}
        {sending && (
          <View style={styles.sendingRow}>
            <ActivityIndicator color="#1D9E75" size="small" />
            <Text style={styles.sendingText}>Sending code…</Text>
          </View>
        )}

        {/* Send failure — prominent error + Try Again */}
        {sendFailed && !sending && (
          <View style={styles.sendFailedBox}>
            <Text style={styles.sendFailedText}>{sendError || 'Could not send SMS.'}</Text>
            <Pressable style={styles.tryAgainButton} onPress={dispatchCode} disabled={sending}>
              <Text style={styles.tryAgainText}>Try Again</Text>
            </Pressable>
          </View>
        )}

        {/* Code input + verify — visible even after failure so user can enter code if SMS arrived anyway */}
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

            {/* Resend only shown when SMS sent successfully; Try Again handles failed sends */}
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
