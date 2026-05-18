import { supabase } from '@/lib/supabase';
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

export default function RegisterScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [ghanaCardId, setGhanaCardId] = useState('');
  const [role, setRole] = useState<'rider' | 'driver'>('rider');
  const [loading, setLoading] = useState(false);

  const handleRegister = async () => {
    if (!email?.trim() || !password?.trim() || !fullName?.trim()) {
      Alert.alert('Validation', 'Please fill in all fields');
      return;
    }

    if (!phone?.trim()) {
      Alert.alert('Validation', 'Please enter your phone number');
      return;
    }

    if (role === 'driver' && !ghanaCardId?.trim()) {
      Alert.alert('Validation', 'Please enter your Ghana Card ID');
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert('Validation', 'Passwords do not match');
      return;
    }

    if ((password?.length ?? 0) < 6) {
      Alert.alert('Validation', 'Password must be at least 6 characters');
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password: password,
      });

      if (error) {
        Alert.alert('Registration Error', error.message);
        return;
      }

      if (data?.user) {
        const { error: profileError } = await supabase
          .from('profiles')
          .insert([{
            id: data.user.id,
            role: role,
            full_name: fullName,
            phone: phone,
            created_at: new Date().toISOString(),
          }]);

        if (profileError) {
          Alert.alert('Error', profileError.message);
          return;
        }

        if (role === 'driver') {
          const { error: driverError } = await supabase
            .from('drivers')
            .insert([{
              profile_id: data.user.id,
              vehicle_number: ghanaCardId,
              is_online: false,
              rating: 0,
              total_rides: 0,
            }]);

          if (driverError) {
            Alert.alert('Error', driverError.message);
            return;
          }
        }

        Alert.alert(
          'Success',
          'Account created! Please check your email to verify your account.',
          [{ text: 'OK', onPress: () => router.push('/auth/login') }]
        );
      }
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Join PragyaGo</Text>
        <Text style={styles.subtitle}>Create a new account</Text>

        <View style={styles.form}>

          {/* Full Name */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Full Name</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your full name"
              value={fullName}
              onChangeText={setFullName}
              editable={!loading}
              placeholderTextColor="#999"
            />
          </View>

          {/* Email */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              editable={!loading}
              placeholderTextColor="#999"
            />
          </View>

          {/* Phone Number */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Phone Number</Text>
            <TextInput
              style={styles.input}
              placeholder="024XXXXXXX"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              editable={!loading}
              placeholderTextColor="#999"
            />
          </View>

          {/* Role Selector */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>I am a</Text>
            <View style={styles.roleContainer}>
              <Pressable
                style={[styles.roleButton, role === 'rider' && styles.roleButtonActive]}
                onPress={() => setRole('rider')}
                disabled={loading}
              >
                <Text style={[styles.roleButtonText, role === 'rider' && styles.roleButtonTextActive]}>
                  Rider
                </Text>
              </Pressable>
              <Pressable
                style={[styles.roleButton, role === 'driver' && styles.roleButtonActive]}
                onPress={() => setRole('driver')}
                disabled={loading}
              >
                <Text style={[styles.roleButtonText, role === 'driver' && styles.roleButtonTextActive]}>
                  Driver
                </Text>
              </Pressable>
            </View>
          </View>

          {/* Ghana Card ID - only for drivers */}
          {role === 'driver' && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Ghana Card ID</Text>
              <TextInput
                style={styles.input}
                placeholder="GHA-XXXXXXXXX-X"
                value={ghanaCardId}
                onChangeText={setGhanaCardId}
                autoCapitalize="characters"
                editable={!loading}
                placeholderTextColor="#999"
              />
            </View>
          )}

          {/* Password */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your password (min 6 characters)"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              editable={!loading}
              placeholderTextColor="#999"
            />
          </View>

          {/* Confirm Password */}
          <View style={styles.inputGroup}>
            <Text style={styles.label}>Confirm Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Confirm your password"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              editable={!loading}
              placeholderTextColor="#999"
            />
          </View>

          {/* Register Button */}
          <Pressable
            style={[styles.registerButton, loading && styles.buttonDisabled]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.registerButtonText}>Create Account</Text>
            )}
          </Pressable>
        </View>

        <View style={styles.loginSection}>
          <Text style={styles.loginText}>Already have an account? </Text>
          <Pressable onPress={() => router.push('/auth/login')} disabled={loading}>
            <Text style={styles.loginLink}>Login here</Text>
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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f5f5' },
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  content: {
    padding: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#1D9E75',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 32,
  },
  form: {
    marginBottom: 24,
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    backgroundColor: '#fff',
    color: '#333',
  },
  roleContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  roleButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  roleButtonActive: {
    backgroundColor: '#1D9E75',
    borderColor: '#1D9E75',
  },
  roleButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#333',
  },
  roleButtonTextActive: {
    color: '#fff',
  },
  registerButton: {
    backgroundColor: '#1D9E75',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  registerButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loginSection: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 16,
  },
  loginText: {
    fontSize: 14,
    color: '#666',
  },
  loginLink: {
    fontSize: 14,
    color: '#1D9E75',
    fontWeight: '600',
  },
  backButton: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
  },
});