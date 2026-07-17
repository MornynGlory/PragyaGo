import { supabase } from '@/lib/supabase';
import { Feather } from '@expo/vector-icons';
import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type ScreenState = 'loading' | 'ready' | 'error' | 'done';

function parseTokensFromURL(url: string): { access_token: string; refresh_token: string; type: string } | null {
  // Supabase sends tokens as hash fragment: #access_token=...&refresh_token=...&type=recovery
  // Fallback: might come as query params on some configurations
  const hashIdx = url.indexOf('#');
  const queryIdx = url.indexOf('?');
  const fragment =
    hashIdx >= 0
      ? url.slice(hashIdx + 1)
      : queryIdx >= 0
      ? url.slice(queryIdx + 1)
      : '';
  if (!fragment) return null;

  const params = new URLSearchParams(fragment);
  const access_token = params.get('access_token');
  const refresh_token = params.get('refresh_token');
  const type = params.get('type');
  if (!access_token || !refresh_token || type !== 'recovery') return null;
  return { access_token, refresh_token, type };
}

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [screen, setScreen] = useState<ScreenState>('loading');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [focusedField, setFocusedField] = useState<'new' | 'confirm' | null>(null);

  const applyTokens = async (url: string) => {
    const tokens = parseTokensFromURL(url);
    if (!tokens) {
      setScreen('error');
      return;
    }
    const { error } = await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
    if (error) {
      setScreen('error');
    } else {
      setScreen('ready');
    }
  };

  useEffect(() => {
    // Case 1: app was launched cold from the deep link
    Linking.getInitialURL().then((url) => {
      if (url) {
        applyTokens(url);
        return;
      }
      // Case 2: no initial URL — listen for it (app was already open)
      const sub = Linking.addEventListener('url', ({ url: incomingUrl }) => {
        applyTokens(incomingUrl);
        sub.remove();
      });
      // If neither fires after a moment, show an error
      const timer = setTimeout(() => setScreen('error'), 8000);
      return () => {
        sub.remove();
        clearTimeout(timer);
      };
    });

    // Case 3: Supabase emits PASSWORD_RECOVERY (e.g., if another tab/handler set the session)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setScreen('ready');
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleUpdatePassword = async () => {
    if (!newPassword || !confirmPassword) {
      Alert.alert('Required', 'Please fill in both password fields.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Mismatch', 'Passwords do not match. Please try again.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Too Short', 'Password must be at least 6 characters.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    await supabase.auth.signOut();
    setScreen('done');
  };

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (screen === 'loading') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.bgCircleTop} />
        <View style={styles.bgCircleBottom} />
        <View style={styles.centeredContainer}>
          <ActivityIndicator size="large" color="#1D9E75" />
          <Text style={styles.loadingText}>Verifying reset link…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ── Invalid / expired link ───────────────────────────────────────────────────
  if (screen === 'error') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.bgCircleTop} />
        <View style={styles.bgCircleBottom} />
        <View style={styles.centeredContainer}>
          <Feather name="alert-triangle" size={56} color="#FF3B30" />
          <Text style={styles.errorTitle}>Link Invalid or Expired</Text>
          <Text style={styles.errorMessage}>
            This password reset link is invalid or has expired. Please request a new one.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
            onPress={() => router.replace('/auth/forgot-password' as any)}
          >
            <Text style={styles.btnText}>Request New Link</Text>
          </Pressable>
          <TouchableOpacity style={styles.secondaryLink} onPress={() => router.replace('/auth/login')}>
            <Text style={styles.secondaryLinkText}>Back to Login</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Success ──────────────────────────────────────────────────────────────────
  if (screen === 'done') {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.bgCircleTop} />
        <View style={styles.bgCircleBottom} />
        <View style={styles.centeredContainer}>
          <Feather name="check-circle" size={64} color="#1D9E75" />
          <Text style={styles.successTitle}>Password Updated!</Text>
          <Text style={styles.successMessage}>
            Your password has been changed successfully. You can now sign in with your new password.
          </Text>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
            onPress={() => router.replace('/auth/login')}
          >
            <Text style={styles.btnText}>Sign In</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.bgCircleTop} />
      <View style={styles.bgCircleBottom} />

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.logoSection}>
            <Feather name="lock" size={52} color="#1D9E75" />
          </View>

          <Text style={styles.title}>Set New Password</Text>
          <Text style={styles.subtitle}>
            Choose a strong password with at least 6 characters.
          </Text>

          <View style={styles.form}>
            <Text style={styles.inputLabel}>New Password</Text>
            <View style={styles.passwordWrapper}>
              <TextInput
                style={[styles.input, styles.passwordInput, focusedField === 'new' && styles.inputFocused]}
                placeholder="Enter new password"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry={!showNew}
                editable={!loading}
                onFocus={() => setFocusedField('new')}
                onBlur={() => setFocusedField(null)}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowNew(v => !v)}
                disabled={loading}
              >
                <Feather name={showNew ? 'eye-off' : 'eye'} size={18} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Confirm Password</Text>
            <View style={styles.passwordWrapper}>
              <TextInput
                style={[styles.input, styles.passwordInput, focusedField === 'confirm' && styles.inputFocused]}
                placeholder="Re-enter new password"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirm}
                editable={!loading}
                onFocus={() => setFocusedField('confirm')}
                onBlur={() => setFocusedField(null)}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowConfirm(v => !v)}
                disabled={loading}
              >
                <Feather name={showConfirm ? 'eye-off' : 'eye'} size={18} color="rgba(255,255,255,0.6)" />
              </TouchableOpacity>
            </View>

            <Pressable
              style={({ pressed }) => [styles.btn, loading && styles.btnDisabled, pressed && styles.btnPressed]}
              onPress={handleUpdatePassword}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.btnText}>Update Password</Text>
              }
            </Pressable>
          </View>

          <View style={styles.backToLoginRow}>
            <TouchableOpacity onPress={() => router.replace('/auth/login')} disabled={loading}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Feather name="arrow-left" size={14} color="rgba(255,255,255,0.5)" />
                <Text style={styles.backToLoginLink}>Back to Login</Text>
              </View>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0D1F2D' },
  scrollContent: { paddingHorizontal: 28, paddingBottom: 40, flexGrow: 1 },

  bgCircleTop: {
    position: 'absolute', width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(29,158,117,0.06)', top: -80, right: -60,
  },
  bgCircleBottom: {
    position: 'absolute', width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(24,95,165,0.07)', bottom: 40, left: -60,
  },

  centeredContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 32,
  },
  loadingText: { marginTop: 16, fontSize: 15, color: 'rgba(255,255,255,0.6)' },

  errorIcon: { fontSize: 56, marginBottom: 20 },
  errorTitle: {
    fontSize: 22, fontWeight: '800', color: '#FFFFFF',
    textAlign: 'center', marginBottom: 12,
  },
  errorMessage: {
    fontSize: 14, color: 'rgba(255,255,255,0.55)', textAlign: 'center',
    lineHeight: 21, marginBottom: 28,
  },
  secondaryLink: { marginTop: 16, paddingVertical: 8 },
  secondaryLinkText: { fontSize: 14, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },

  successIcon: { fontSize: 64, marginBottom: 24 },
  successTitle: {
    fontSize: 26, fontWeight: '900', color: '#FFFFFF',
    textAlign: 'center', marginBottom: 14,
  },
  successMessage: {
    fontSize: 15, color: 'rgba(255,255,255,0.6)', textAlign: 'center',
    lineHeight: 22, marginBottom: 32,
  },

  logoSection: { alignItems: 'center', marginTop: 40, marginBottom: 28 },
  lockIcon: { fontSize: 52 },

  title: {
    fontSize: 28, fontWeight: '900', color: '#FFFFFF',
    letterSpacing: -0.5, marginBottom: 10,
  },
  subtitle: {
    fontSize: 14, color: 'rgba(255,255,255,0.5)',
    marginBottom: 32, lineHeight: 20,
  },

  form: { gap: 14, marginBottom: 28 },
  inputLabel: {
    fontSize: 13, fontWeight: '600',
    color: 'rgba(255,255,255,0.7)', marginBottom: -6,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16,
    fontSize: 15, color: '#FFFFFF',
  },
  inputFocused: { borderColor: '#1D9E75', backgroundColor: 'rgba(29,158,117,0.08)' },
  passwordWrapper: { position: 'relative' },
  passwordInput: { paddingRight: 52 },
  eyeBtn: {
    position: 'absolute', right: 14, top: 0, bottom: 0,
    justifyContent: 'center', paddingHorizontal: 4,
  },
  eyeIcon: { fontSize: 18 },

  btn: {
    backgroundColor: '#1D9E75', borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', marginTop: 4,
    shadowColor: '#1D9E75', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 14, elevation: 7,
  },
  btnDisabled: { opacity: 0.6 },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  btnText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.3 },

  backToLoginRow: { alignItems: 'center' },
  backToLoginLink: { fontSize: 14, fontWeight: '600', color: 'rgba(255,255,255,0.5)' },
});
