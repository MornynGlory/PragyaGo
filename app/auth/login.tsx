import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!phone.trim() || !password.trim()) {
      Alert.alert('Validation', 'Please enter your phone number and password.');
      return;
    }

    setLoading(true);
    try {
      console.log('Looking up phone:', phone.trim());
      const { data: profile, error: profileError } = await supabase
        .from('profiles')
        .select('id, role, email')
        .eq('phone', phone.trim())
        .single();

      console.log('Profile result:', JSON.stringify(profile), 'Error:', JSON.stringify(profileError));

      if (profileError) {
        const notFound = profileError.code === 'PGRST116' || profileError.details?.includes('0 rows');
        Alert.alert('Error', notFound ? 'Phone number not registered.' : 'Failed to look up account. Please try again.');
        return;
      }

      if (!profile) {
        Alert.alert('Error', 'Phone number not registered.');
        return;
      }

      console.log('Email found:', profile?.email);
      const email = profile.email ?? null;
      if (!email) {
        Alert.alert('Error', 'Account details incomplete. Please contact support.');
        return;
      }

      const role = profile.role ?? 'rider';

      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      console.log('Sign in error:', JSON.stringify(signInError));

      if (signInError) {
        Alert.alert('Login Failed', signInError.message ?? 'Incorrect password.');
        return;
      }

      if (role === 'driver') {
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
      <ScrollView style={styles.container}>
        <View style={styles.content}>
          <Text style={styles.title}>Welcome Back</Text>
          <Text style={styles.subtitle}>Sign in to PragyaGo</Text>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Phone Number</Text>
              <TextInput
                style={styles.input}
                placeholder="024XXXXXXX"
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
                editable={!loading}
                placeholderTextColor={colors.subtext}
              />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                editable={!loading}
                placeholderTextColor={colors.subtext}
              />
            </View>

            <Pressable
              style={[styles.loginButton, loading && styles.buttonDisabled]}
              onPress={handleLogin}
              disabled={loading}
            >
              {loading
                ? <ActivityIndicator color="#fff" />
                : <Text style={styles.loginButtonText}>Login</Text>
              }
            </Pressable>
          </View>

          <View style={styles.registerSection}>
            <Text style={styles.registerText}>Don't have an account? </Text>
            <Pressable onPress={() => router.push('/auth/register')} disabled={loading}>
              <Text style={styles.registerLink}>Register here</Text>
            </Pressable>
          </View>

          <Pressable onPress={() => router.replace('/')}>
            <Text style={styles.backButton}>← Back to Home</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    container: { flex: 1, backgroundColor: c.background },
    content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
    title: { fontSize: 32, fontWeight: 'bold', color: '#1D9E75', marginBottom: 8 },
    subtitle: { fontSize: 16, color: c.subtext, marginBottom: 32 },
    form: { marginBottom: 24 },
    inputGroup: { marginBottom: 16 },
    label: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 8 },
    input: {
      borderWidth: 1, borderColor: c.border, borderRadius: 8,
      paddingHorizontal: 16, paddingVertical: 12,
      fontSize: 14, backgroundColor: c.inputBg, color: c.text,
    },
    loginButton: {
      backgroundColor: '#1D9E75', paddingVertical: 14,
      borderRadius: 8, alignItems: 'center', marginTop: 8,
    },
    buttonDisabled: { opacity: 0.6 },
    loginButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
    registerSection: { flexDirection: 'row', justifyContent: 'center', marginBottom: 16 },
    registerText: { fontSize: 14, color: c.subtext },
    registerLink: { fontSize: 14, color: '#1D9E75', fontWeight: '600' },
    backButton: { fontSize: 14, color: c.subtext, textAlign: 'center', marginTop: 8 },
  });
}
