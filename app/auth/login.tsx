import { supabase } from '@/lib/supabase';
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

export default function LoginScreen() {
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [focusedField, setFocusedField] = useState<'phone' | 'password' | null>(null);

  const handleLogin = async () => {
    if (!phone.trim() || !password.trim()) {
      Alert.alert('Validation', 'Please enter your phone number and password.');
      return;
    }

    setLoading(true);
    try {
      // Connection test
      const { data: testData, error: testError } = await supabase
        .from('profiles')
        .select('count');
      console.log('Connection test - count:', JSON.stringify(testData));
      console.log('Connection test - error:', JSON.stringify(testError));
      console.log('SUPABASE URL:', process.env.EXPO_PUBLIC_SUPABASE_URL);
      console.log('SUPABASE KEY exists:', !!process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

      // Step 1: look up profile by phone
      console.log('Phone:', phone.trim());
      const { data: profile } = await supabase
        .from('profiles')
        .select('id, role, email')
        .eq('phone', phone.trim())
        .maybeSingle();

      console.log('Profile:', JSON.stringify(profile));

      if (!profile) {
        Alert.alert('Error', 'Phone number not registered.');
        return;
      }

      // Step 2: sign in with the profile's email
      const { error } = await supabase.auth.signInWithPassword({
        email: profile.email,
        password,
      });

      console.log('SignIn error:', JSON.stringify(error));

      if (error) {
        Alert.alert('Login Failed', error.message);
        return;
      }

      // Step 3: navigate by role
      if (profile.role === 'driver') {
        router.replace('/driver/home' as any);
      } else {
        router.replace('/rider/home' as any);
      }
    } catch (err: any) {
      console.error('Login error:', err);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Background decorations */}
      <View style={styles.bgCircleTop} />
      <View style={styles.bgCircleBottom} />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* Back arrow */}
          <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/')} disabled={loading}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>

          {/* Logo + brand */}
          <View style={styles.logoSection}>
            <Image
              source={require('@/assets/images/icon.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <Text style={styles.brandName}>PragyaGo</Text>
          </View>

          {/* Heading */}
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in to continue</Text>

          {/* Form */}
          <View style={styles.form}>
            <TextInput
              style={[styles.input, focusedField === 'phone' && styles.inputFocused]}
              placeholder="024XXXXXXX"
              placeholderTextColor="rgba(255,255,255,0.3)"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              editable={!loading}
              onFocus={() => setFocusedField('phone')}
              onBlur={() => setFocusedField(null)}
            />

            <View style={styles.passwordWrapper}>
              <TextInput
                style={[styles.input, styles.passwordInput, focusedField === 'password' && styles.inputFocused]}
                placeholder="Password"
                placeholderTextColor="rgba(255,255,255,0.3)"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                editable={!loading}
                onFocus={() => setFocusedField('password')}
                onBlur={() => setFocusedField(null)}
              />
              <TouchableOpacity
                style={styles.eyeBtn}
                onPress={() => setShowPassword(v => !v)}
                disabled={loading}
              >
                <Text style={styles.eyeIcon}>{showPassword ? '🙈' : '👁️'}</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.forgotRow} disabled={loading}>
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>

            <Pressable
              style={({ pressed }) => [styles.loginBtn, loading && styles.loginBtnDisabled, pressed && styles.loginBtnPressed]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.loginBtnText}>Sign In</Text>
              }
            </Pressable>
          </View>

          {/* Register link */}
          <View style={styles.registerRow}>
            <Text style={styles.registerPrompt}>Don't have an account? </Text>
            <TouchableOpacity onPress={() => router.push('/auth/register')} disabled={loading}>
              <Text style={styles.registerLink}>Register</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0D1F2D',
  },
  scrollContent: {
    paddingHorizontal: 28,
    paddingBottom: 40,
    flexGrow: 1,
  },

  /* Background decorations */
  bgCircleTop: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(29,158,117,0.06)',
    top: -80,
    right: -60,
  },
  bgCircleBottom: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(24,95,165,0.07)',
    bottom: 40,
    left: -60,
  },

  /* Back button */
  backBtn: {
    marginTop: 12,
    marginBottom: 24,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  backBtnText: {
    fontSize: 20,
    color: '#FFFFFF',
    lineHeight: 24,
  },

  /* Logo */
  logoSection: {
    alignItems: 'center',
    marginBottom: 32,
  },
  logo: {
    width: 60,
    height: 60,
    borderRadius: 14,
    backgroundColor: 'transparent',
    marginBottom: 8,
  },
  brandName: {
    fontSize: 18,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.3,
  },

  /* Heading */
  title: {
    fontSize: 28,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -0.5,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 32,
  },

  /* Form */
  form: {
    gap: 14,
    marginBottom: 28,
  },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 15,
    color: '#FFFFFF',
  },
  inputFocused: {
    borderColor: '#1D9E75',
    backgroundColor: 'rgba(29,158,117,0.08)',
  },
  passwordWrapper: {
    position: 'relative',
  },
  passwordInput: {
    paddingRight: 52,
  },
  eyeBtn: {
    position: 'absolute',
    right: 14,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  eyeIcon: {
    fontSize: 18,
  },
  forgotRow: {
    alignSelf: 'flex-end',
    marginTop: -4,
  },
  forgotText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1D9E75',
  },
  loginBtn: {
    backgroundColor: '#1D9E75',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    marginTop: 4,
    shadowColor: '#1D9E75',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 14,
    elevation: 7,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  loginBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },

  /* Register row */
  registerRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  registerPrompt: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
  },
  registerLink: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D9E75',
  },
});
