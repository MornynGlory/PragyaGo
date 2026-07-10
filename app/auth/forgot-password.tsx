import { supabase } from '@/lib/supabase';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
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

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [focused, setFocused] = useState(false);
  const [sent, setSent] = useState(false);
  const [sentEmail, setSentEmail] = useState('');

  const handleSend = async () => {
    if (!phone.trim()) {
      Alert.alert('Required', 'Please enter your phone number.');
      return;
    }
    setLoading(true);
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('email')
        .eq('phone', phone.trim())
        .maybeSingle();

      if (!profile?.email) {
        Alert.alert('Not Found', 'No account found with this phone number.');
        return;
      }

      const { error } = await supabase.auth.resetPasswordForEmail(profile.email, {
        redirectTo: 'pragyago://auth/reset-password',
      });

      if (error) {
        Alert.alert('Error', error.message);
        return;
      }

      setSentEmail(profile.email);
      setSent(true);
    } catch {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.bgCircleTop} />
        <View style={styles.bgCircleBottom} />
        <View style={styles.successContainer}>
          <Feather name="check-circle" size={64} color="#1D9E75" />
          <Text style={styles.successTitle}>Check your email!</Text>
          <Text style={styles.successMessage}>
            {`We sent a password reset link to\n${sentEmail}\n\nOpen the email and tap the link to set a new password.`}
          </Text>
          <Pressable
            style={({ pressed }) => [styles.btn, pressed && styles.btnPressed]}
            onPress={() => router.replace('/auth/login')}
          >
            <Text style={styles.btnText}>Back to Login</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

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
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} disabled={loading}>
            <Feather name="arrow-left" size={20} color="#FFFFFF" />
          </TouchableOpacity>

          <View style={styles.logoSection}>
            <Image
              source={require('@/assets/images/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.brandName}>PragyaGo</Text>
          </View>

          <Text style={styles.title}>Reset Password</Text>
          <Text style={styles.subtitle}>
            Enter your phone number and we'll send a reset link to your email
          </Text>

          <View style={styles.form}>
            <Text style={styles.inputLabel}>Phone Number</Text>
            <TextInput
              style={[styles.input, focused && styles.inputFocused]}
              placeholder="024XXXXXXXX"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              editable={!loading}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            />

            <Pressable
              style={({ pressed }) => [styles.btn, loading && styles.btnDisabled, pressed && styles.btnPressed]}
              onPress={handleSend}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.btnText}>Send Reset Link</Text>
              }
            </Pressable>
          </View>

          <View style={styles.backToLoginRow}>
            <Text style={styles.backToLoginPrompt}>Remember your password? </Text>
            <TouchableOpacity onPress={() => router.replace('/auth/login')} disabled={loading}>
              <Text style={styles.backToLoginLink}>Sign In</Text>
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

  backBtn: {
    marginTop: 12, marginBottom: 24, width: 40, height: 40, borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)', justifyContent: 'center', alignItems: 'center',
  },
  backBtnText: { fontSize: 20, color: '#FFFFFF', lineHeight: 24 },

  logoSection: { alignItems: 'center', marginBottom: 32 },
  logo: { width: 60, height: 60, borderRadius: 14, marginBottom: 8 },
  brandName: { fontSize: 18, fontWeight: '700', color: '#FFFFFF', letterSpacing: -0.3 },

  title: {
    fontSize: 28, fontWeight: '900', color: '#FFFFFF',
    letterSpacing: -0.5, marginBottom: 10,
  },
  subtitle: {
    fontSize: 14, color: 'rgba(255,255,255,0.5)',
    marginBottom: 32, lineHeight: 20,
  },

  form: { gap: 14, marginBottom: 28 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.7)', marginBottom: -6 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16,
    fontSize: 15, color: '#FFFFFF',
  },
  inputFocused: { borderColor: '#1D9E75', backgroundColor: 'rgba(29,158,117,0.08)' },

  btn: {
    backgroundColor: '#1D9E75', borderRadius: 14, paddingVertical: 18,
    alignItems: 'center', marginTop: 4,
    shadowColor: '#1D9E75', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 14, elevation: 7,
  },
  btnDisabled: { opacity: 0.6 },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  btnText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.3 },

  backToLoginRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center' },
  backToLoginPrompt: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  backToLoginLink: { fontSize: 14, fontWeight: '700', color: '#1D9E75' },

  // Success screen
  successContainer: {
    flex: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 32,
  },
  successIcon: { fontSize: 64, marginBottom: 24 },
  successTitle: {
    fontSize: 26, fontWeight: '900', color: '#FFFFFF',
    marginBottom: 16, textAlign: 'center',
  },
  successMessage: {
    fontSize: 15, color: 'rgba(255,255,255,0.6)', textAlign: 'center',
    lineHeight: 22, marginBottom: 36,
  },
});
