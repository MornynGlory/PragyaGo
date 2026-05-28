import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PRAGYA_COLORS = ['Red', 'Blue', 'Yellow', 'Green', 'White', 'Black', 'Orange', 'Silver'];

const COLOR_HEX: Record<string, string> = {
  Red: '#FF3B30', Blue: '#2563eb', Yellow: '#FFD60A', Green: '#34C759',
  White: '#F2F2F7', Black: '#1C1C1E', Orange: '#FF9500', Silver: '#8E8E93',
};

export default function RegisterScreen() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [ghanaCardId, setGhanaCardId] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [pragyaColor, setPragyaColor] = useState('');
  const [role, setRole] = useState<'rider' | 'driver'>('rider');
  const [loading, setLoading] = useState(false);

  const driverAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(driverAnim, {
      toValue: role === 'driver' ? 1 : 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, [role]);

  const handleRegister = async () => {
    if (!email.trim() || !password.trim() || !fullName.trim() || !phone.trim()) {
      Alert.alert('Validation', 'Please fill in all required fields');
      return;
    }
    if (role === 'driver') {
      if (!ghanaCardId.trim()) { Alert.alert('Validation', 'Please enter your Ghana Card ID'); return; }
      if (!plateNumber.trim()) { Alert.alert('Validation', 'Please enter your Plate Number'); return; }
      if (!pragyaColor) { Alert.alert('Validation', 'Please select your Pragya Color'); return; }
    }
    if (password !== confirmPassword) { Alert.alert('Validation', 'Passwords do not match'); return; }
    if (password.length < 6) { Alert.alert('Validation', 'Password must be at least 6 characters'); return; }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) { Alert.alert('Registration Error', error.message || 'An error occurred'); return; }
      if (!data?.user) return;

      const { error: profileError } = await supabase.from('profiles').insert([{
        id: data.user.id,
        role,
        full_name: fullName.trim(),
        phone: phone.trim(),
        email: email.trim(),
        created_at: new Date().toISOString(),
      }]);

      if (profileError) {
        Alert.alert('Profile Creation Error', 'Account created but profile setup failed. Please try logging in.');
        return;
      }

      if (role === 'driver') {
        const { error: driverError } = await supabase.from('drivers').insert([{
          profile_id: data.user.id,
          vehicle_number: ghanaCardId.trim(),
          plate_number: plateNumber.trim().toUpperCase(),
          pragya_color: pragyaColor,
          is_online: false,
          rating: 0,
          total_rides: 0,
        }]);
        if (driverError) {
          Alert.alert('Driver Profile Error', 'Account created but driver profile setup failed. Please try logging in.');
          return;
        }
      }

      Alert.alert('Success', 'Account created successfully! Please check your email to verify your account.');
      router.push('/auth/login');
    } catch (err) {
      console.error('Registration error:', err);
      Alert.alert('Error', 'An unexpected error occurred during registration');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView style={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.content}>
          <Text style={styles.title}>Join PragyaGo</Text>
          <Text style={styles.subtitle}>Create a new account</Text>

          <View style={styles.form}>
            <View style={styles.inputGroup}>
              <Text style={styles.label}>Full Name</Text>
              <TextInput style={styles.input} placeholder="Enter your full name" value={fullName} onChangeText={setFullName} editable={!loading} placeholderTextColor="#999" />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Email</Text>
              <TextInput style={styles.input} placeholder="Enter your email" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" editable={!loading} placeholderTextColor="#999" />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Phone Number *</Text>
              <TextInput style={styles.input} placeholder="024XXXXXXX" value={phone} onChangeText={setPhone} keyboardType="phone-pad" editable={!loading} placeholderTextColor="#999" />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>I want to</Text>
              <View style={styles.roleContainer}>
                <Pressable
                  style={[styles.roleCard, role === 'rider' && styles.roleCardRiderActive]}
                  onPress={() => setRole('rider')}
                  disabled={loading}
                >
                  <Text style={styles.roleCardEmoji}>👤</Text>
                  <Text style={[styles.roleCardTitle, role === 'rider' && styles.roleCardTitleGreen]}>Rider</Text>
                  <Text style={styles.roleCardDesc}>Book rides easily</Text>
                </Pressable>
                <Pressable
                  style={[styles.roleCard, role === 'driver' && styles.roleCardDriverActive]}
                  onPress={() => setRole('driver')}
                  disabled={loading}
                >
                  <Text style={styles.roleCardEmoji}>🛺</Text>
                  <Text style={[styles.roleCardTitle, role === 'driver' && styles.roleCardTitleBlue]}>Driver</Text>
                  <Text style={styles.roleCardDesc}>Earn with your Pragya</Text>
                </Pressable>
              </View>
            </View>

            {role === 'driver' && (
              <Animated.View style={[styles.driverSection, {
                opacity: driverAnim,
                transform: [{ translateY: driverAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
              }]}>
                <Text style={styles.driverSectionTitle}>🛺 Driver Details</Text>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Ghana Card ID *</Text>
                  <TextInput style={styles.input} placeholder="GHA-XXXXXXXXX-X" value={ghanaCardId} onChangeText={setGhanaCardId} autoCapitalize="characters" editable={!loading} placeholderTextColor="#999" />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Plate Number *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="M-21-AW 5615"
                    value={plateNumber}
                    onChangeText={(t) => setPlateNumber(t.toUpperCase())}
                    autoCapitalize="characters"
                    editable={!loading}
                    placeholderTextColor="#999"
                  />
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.label}>Pragya Color *</Text>
                  <View style={styles.colorGrid}>
                    {PRAGYA_COLORS.map((color) => (
                      <Pressable
                        key={color}
                        style={[
                          styles.colorChip,
                          pragyaColor === color && { borderColor: COLOR_HEX[color], backgroundColor: '#F8FAFF' },
                        ]}
                        onPress={() => setPragyaColor(color)}
                        disabled={loading}
                      >
                        <View style={[
                          styles.colorDot,
                          { backgroundColor: COLOR_HEX[color] },
                          color === 'White' && styles.colorDotWhite,
                        ]} />
                        <Text style={[
                          styles.colorChipText,
                          pragyaColor === color && { color: COLOR_HEX[color], fontWeight: '700' },
                        ]}>{color}</Text>
                      </Pressable>
                    ))}
                  </View>
                </View>

                <View style={styles.driverNote}>
                  <Text style={styles.driverNoteText}>🔒 These details will be locked after registration. Visit any PragyaGo office to make changes.</Text>
                </View>
              </Animated.View>
            )}

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Password</Text>
              <TextInput style={styles.input} placeholder="Minimum 6 characters" value={password} onChangeText={setPassword} secureTextEntry editable={!loading} placeholderTextColor="#999" />
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.label}>Confirm Password</Text>
              <TextInput style={styles.input} placeholder="Confirm your password" value={confirmPassword} onChangeText={setConfirmPassword} secureTextEntry editable={!loading} placeholderTextColor="#999" />
            </View>

            <Pressable
              style={[styles.registerButton, role === 'driver' && styles.registerButtonDriver, loading && styles.buttonDisabled]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.registerButtonText}>Create Account</Text>}
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
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20, paddingTop: 60, paddingBottom: 40 },
  title: { fontSize: 32, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  subtitle: { fontSize: 16, color: '#666', marginBottom: 32 },
  form: { marginBottom: 24 },
  inputGroup: { marginBottom: 16 },
  label: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 },
  input: {
    borderWidth: 1, borderColor: '#ddd', borderRadius: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    fontSize: 14, backgroundColor: '#fff', color: '#333',
  },
  roleContainer: { flexDirection: 'row', gap: 12 },
  roleCard: {
    flex: 1, borderWidth: 2, borderColor: '#ddd', borderRadius: 12,
    paddingVertical: 18, paddingHorizontal: 12, alignItems: 'center',
    backgroundColor: '#fff',
  },
  roleCardRiderActive: { borderColor: '#1D9E75', backgroundColor: '#F0FDF7' },
  roleCardDriverActive: { borderColor: '#2563eb', backgroundColor: '#EFF6FF' },
  roleCardEmoji: { fontSize: 30, marginBottom: 6 },
  roleCardTitle: { fontSize: 15, fontWeight: '700', color: '#444', marginBottom: 2 },
  roleCardTitleGreen: { color: '#1D9E75' },
  roleCardTitleBlue: { color: '#2563eb' },
  roleCardDesc: { fontSize: 11, color: '#888', textAlign: 'center' },
  driverSection: {
    borderWidth: 2, borderColor: '#2563eb', borderRadius: 12,
    padding: 16, marginBottom: 16, backgroundColor: '#F8FAFF',
  },
  driverSectionTitle: { fontSize: 14, fontWeight: '700', color: '#2563eb', marginBottom: 16 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: '#ddd', borderRadius: 20,
    paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#fff',
  },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  colorDotWhite: { borderWidth: 1, borderColor: '#ccc' },
  colorChipText: { fontSize: 12, color: '#555' },
  driverNote: { backgroundColor: '#EFF6FF', borderRadius: 8, padding: 10, marginTop: 4 },
  driverNoteText: { fontSize: 12, color: '#2563eb', lineHeight: 18 },
  registerButton: {
    backgroundColor: '#1D9E75', paddingVertical: 14,
    borderRadius: 8, alignItems: 'center', marginTop: 8,
  },
  registerButtonDriver: { backgroundColor: '#2563eb' },
  buttonDisabled: { opacity: 0.6 },
  registerButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  loginSection: { flexDirection: 'row', justifyContent: 'center', marginBottom: 16 },
  loginText: { fontSize: 14, color: '#666' },
  loginLink: { fontSize: 14, color: '#1D9E75', fontWeight: '600' },
  backButton: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 8 },
});
