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
    if (!email?.trim() || !password?.trim() || !fullName?.trim() || !phone?.trim()) {
      Alert.alert('Validation', 'Please fill in all fields');
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

    if (!role) {
      Alert.alert('Validation', 'Please select a role');
      return;
    }

    setLoading(true);
    try {
      console.log('Starting registration...');
      const { data, error } = await supabase.auth.signUp({
        email: email?.trim() || '',
        password: password || '',
      });

      console.log('Auth result:', JSON.stringify(data), JSON.stringify(error));

      if (error) {
        Alert.alert('Registration Error', error?.message || 'An error occurred');
      } else if (data?.user) {
        try {
          console.log('Creating profile for user:', data.user.id);
          const { error: profileError } = await supabase
            .from('profiles')
            .insert([
              {
                id: data.user.id,
                role: role || 'rider',
                full_name: fullName || '',
                phone: phone || '',
                created_at: new Date().toISOString(),
              },
            ]);

          console.log('Profile insert result:', JSON.stringify(profileError));

          if (profileError) {
            console.error('Profile creation error:', profileError);
            Alert.alert(
              'Profile Creation Error',
              'Account created but profile setup failed. Please try logging in.'
            );
            return;
          }

          if (role === 'driver') {
            console.log('Creating driver profile for user:', data.user.id);
            const { error: driverError } = await supabase
              .from('drivers')
              .insert([
                {
                  profile_id: data.user.id,
                  vehicle_number: ghanaCardId || '',
                  is_online: false,
                  rating: 0,
                  total_rides: 0,
                },
              ]);

            console.log('Driver insert result:', JSON.stringify(driverError));

            if (driverError) {
              console.error('Driver profile creation error:', driverError);
              Alert.alert(
                'Driver Profile Error',
                'Account created but driver profile setup failed. Please try logging in.'
              );
              return;
            }
          }

          Alert.alert(
            'Success',
            'Account created successfully! Please check your email to verify your account.'
          );
          router.push('/auth/login');
        } catch (profileError) {
          console.error('Profile error:', profileError);
          Alert.alert('Error', 'Failed to create user profile');
        }
      }
    } catch (error) {
      console.error('Registration error:', error);
      Alert.alert('Error', 'An unexpected error occurred during registration');
    } finally {
      setLoading(false);
    }
  };

  const handleLoginNavigation = () => {
    router.push('/auth/login');
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>Join PragyaGo</Text>
        <Text style={styles.subtitle}>Create a new account</Text>

        <View style={styles.form}>
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

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Role</Text>
            <View style={styles.roleContainer}>
              <Pressable
                style={[
                  styles.roleButton,
                  role === 'rider' && styles.roleButtonActive,
                ]}
                onPress={() => setRole('rider')}
                disabled={loading}
              >
                <Text
                  style={[
                    styles.roleButtonText,
                    role === 'rider' && styles.roleButtonTextActive,
                  ]}
                >
                  🚗 Rider
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.roleButton,
                  role === 'driver' && styles.roleButtonActive,
                ]}
                onPress={() => setRole('driver')}
                disabled={loading}
              >
                <Text
                  style={[
                    styles.roleButtonText,
                    role === 'driver' && styles.roleButtonTextActive,
                  ]}
                >
                  🚙 Driver
                </Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Phone Number *</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter your phone number"
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              editable={!loading}
              placeholderTextColor="#999"
            />
          </View>

          {role === 'driver' && (
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Ghana Card ID *</Text>
              <TextInput
                style={styles.input}
                placeholder="Enter your Ghana Card ID"
                value={ghanaCardId}
                onChangeText={setGhanaCardId}
                editable={!loading}
                placeholderTextColor="#999"
              />
            </View>
          )}

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
          <Pressable onPress={handleLoginNavigation} disabled={loading}>
            <Text style={styles.loginLink}>Login here</Text>
          </Pressable>
        </View>

        <Pressable onPress={() => router.replace('/')}>
          <Text style={styles.backButton}>← Back to Home</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
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
    color: '#333',
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
  pickerContainer: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
    overflow: 'hidden',
  },
  roleContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  roleButton: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  roleButtonActive: {
    borderColor: '#34C759',
    backgroundColor: '#E8F5E9',
  },
  roleButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  roleButtonTextActive: {
    color: '#34C759',
  },
  registerButton: {
    backgroundColor: '#34C759',
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
    color: '#34C759',
    fontWeight: '600',
  },
  backButton: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
    marginTop: 8,
  },
});
