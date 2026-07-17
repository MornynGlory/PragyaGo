import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PRAGYA_COLORS = ['Red', 'Blue', 'Yellow', 'Green', 'White', 'Black', 'Orange', 'Silver'];

const COLOR_HEX: Record<string, string> = {
  Red: '#FF3B30', Blue: '#2563eb', Yellow: '#FFD60A', Green: '#34C759',
  White: '#F2F2F7', Black: '#3A3A3C', Orange: '#FF9500', Silver: '#8E8E93',
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
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [showOTPScreen, setShowOTPScreen] = useState(false);
  const [otp, setOtp] = useState('');
  const [sendingOTP, setSendingOTP] = useState(false);
  const [verifyingOTP, setVerifyingOTP] = useState(false);
  const [registeredPhone, setRegisteredPhone] = useState('');

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
    if (!agreedToTerms) { Alert.alert('Terms Required', 'Please agree to our Terms of Service and Privacy Policy to continue.'); return; }
    if (password.length < 6) { Alert.alert('Validation', 'Password must be at least 6 characters'); return; }

    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({ email: email.trim(), password });
      if (error) { Alert.alert('Registration Error', error.message || 'An error occurred'); return; }
      if (!data?.user) return;

      const { error: profileError } = await supabase.from('profiles').insert([{
        id: data.user.id, role,
        full_name: fullName.trim(), phone: phone.trim(),
        email: email.trim(), created_at: new Date().toISOString(),
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
          is_online: false, rating: 0, total_rides: 0,
        }]);
        if (driverError) {
          Alert.alert('Driver Profile Error', 'Account created but driver profile setup failed. Please try logging in.');
          return;
        }
      }

      await sendOTP(phone.trim());
    } catch (err) {
      console.error('Registration error:', err);
      Alert.alert('Error', 'An unexpected error occurred during registration');
    } finally {
      setLoading(false);
    }
  };

  const sendOTP = async (phoneNumber: string) => {
    setSendingOTP(true);
    try {
      const response = await fetch('https://admin.pragyago.com/api/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: phoneNumber }),
      });
      const data = await response.json();
      if (data.success) {
        setRegisteredPhone(phoneNumber);
        setShowOTPScreen(true);
      } else {
        Alert.alert('Error', 'Could not send OTP. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Could not send OTP. Please try again.');
    } finally {
      setSendingOTP(false);
    }
  };

  const verifyOTP = async () => {
    if (otp.length !== 6) { Alert.alert('Error', 'Please enter the 6-digit code'); return; }
    setVerifyingOTP(true);
    try {
      const response = await fetch('https://admin.pragyago.com/api/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: registeredPhone, code: otp }),
      });
      const data = await response.json();
      if (data.verified) {
        await supabase.from('profiles').update({ phone_verified: true }).eq('phone', registeredPhone);
        Alert.alert('Success', 'Phone verified successfully!');
        if (role === 'driver') {
          router.replace('/auth/verify-driver' as any);
        } else {
          router.replace('/rider/home' as any);
        }
      } else {
        Alert.alert('Invalid Code', 'The code you entered is incorrect. Please try again.');
      }
    } catch {
      Alert.alert('Error', 'Could not verify OTP. Please try again.');
    } finally {
      setVerifyingOTP(false);
    }
  };

  const resendOTP = async () => {
    setOtp('');
    await sendOTP(registeredPhone);
  };

  if (showOTPScreen) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.otpContainer}>
          <TouchableOpacity style={styles.backBtn} onPress={() => setShowOTPScreen(false)}>
            <Text style={styles.backBtnText}>←</Text>
          </TouchableOpacity>

          <View style={styles.headerSection}>
            <Image source={require('@/assets/images/icon.png')} style={styles.logo} resizeMode="contain" />
            <Text style={styles.title}>Verify your number</Text>
            <Text style={styles.otpSubtitle}>Enter the 6-digit code sent to{'\n'}{registeredPhone}</Text>
          </View>

          <TextInput
            style={styles.otpInput}
            value={otp}
            onChangeText={setOtp}
            keyboardType="numeric"
            maxLength={6}
            placeholder="------"
            placeholderTextColor="rgba(255,255,255,0.2)"
            textAlign="center"
            autoFocus
            editable={!verifyingOTP}
          />

          <TouchableOpacity
            style={[styles.registerBtn, (verifyingOTP || sendingOTP) && styles.btnDisabled]}
            onPress={verifyOTP}
            disabled={verifyingOTP || sendingOTP}
            activeOpacity={0.85}
          >
            {verifyingOTP
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.registerBtnText}>Verify</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.resendBtn}
            onPress={resendOTP}
            disabled={sendingOTP || verifyingOTP}
            activeOpacity={0.7}
          >
            {sendingOTP
              ? <ActivityIndicator color="#1D9E75" size="small" />
              : <Text style={styles.resendBtnText}>Resend code</Text>
            }
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Background decorations */}
      <View style={styles.bgCircleTopRight} />
      <View style={styles.bgCircleBottomLeft} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Back button */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.replace('/')} disabled={loading}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>

        {/* Logo + heading */}
        <View style={styles.headerSection}>
          <Image source={require('@/assets/images/icon.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>Join PragyaGo</Text>
          <Text style={styles.subtitle}>Create your account in seconds</Text>
        </View>

        {/* Role selector */}
        <View style={styles.roleRow}>
          <TouchableOpacity
            style={[styles.roleCard, role === 'rider' && styles.roleCardActiveGreen]}
            onPress={() => setRole('rider')}
            disabled={loading}
          >
            <Text style={styles.roleEmoji}>👤</Text>
            <Text style={[styles.roleTitle, role === 'rider' && styles.roleTitleGreen]}>Rider</Text>
            <Text style={styles.roleSubtitle}>Book rides easily</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.roleCard, role === 'driver' && styles.roleCardActiveBlue]}
            onPress={() => setRole('driver')}
            disabled={loading}
          >
            <Text style={styles.roleEmoji}>🛺</Text>
            <Text style={[styles.roleTitle, role === 'driver' && styles.roleTitleBlue]}>Driver</Text>
            <Text style={styles.roleSubtitle}>Earn with your Pragya</Text>
          </TouchableOpacity>
        </View>

        {/* Common fields */}
        <View style={styles.form}>
          <Text style={styles.fieldLabel}>Full Name</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your full name"
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={fullName}
            onChangeText={setFullName}
            editable={!loading}
          />

          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter your email"
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            editable={!loading}
          />

          <Text style={styles.fieldLabel}>Phone Number</Text>
          <TextInput
            style={styles.input}
            placeholder="024XXXXXXX"
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            editable={!loading}
          />

          {/* Driver details */}
          {role === 'driver' && (
            <Animated.View style={[styles.driverSection, {
              opacity: driverAnim,
              transform: [{ translateY: driverAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 0] }) }],
            }]}>
              <Text style={styles.driverSectionTitle}>🛺 Driver Details</Text>

              <Text style={styles.fieldLabel}>Ghana Card ID</Text>
              <TextInput
                style={styles.input}
                placeholder="GHA-XXXXXXXXX-X"
                placeholderTextColor="rgba(255,255,255,0.35)"
                value={ghanaCardId}
                onChangeText={setGhanaCardId}
                autoCapitalize="characters"
                editable={!loading}
              />

              <Text style={styles.fieldLabel}>Plate Number</Text>
              <TextInput
                style={styles.input}
                placeholder="M-21-AW 5615"
                placeholderTextColor="rgba(255,255,255,0.35)"
                value={plateNumber}
                onChangeText={(t) => setPlateNumber(t.toUpperCase())}
                autoCapitalize="characters"
                editable={!loading}
              />

              <Text style={styles.fieldLabel}>Pragya Color</Text>
              <View style={styles.colorGrid}>
                {PRAGYA_COLORS.map((color) => (
                  <TouchableOpacity
                    key={color}
                    style={[
                      styles.colorChip,
                      pragyaColor === color && { borderColor: COLOR_HEX[color], backgroundColor: 'rgba(255,255,255,0.1)' },
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
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.driverNote}>
                <Text style={styles.driverNoteText}>🔒 These details will be locked after registration. Visit any PragyaGo office to make changes.</Text>
              </View>
            </Animated.View>
          )}

          <Text style={styles.fieldLabel}>Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Minimum 6 characters"
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            editable={!loading}
          />

          <Text style={styles.fieldLabel}>Confirm Password</Text>
          <TextInput
            style={styles.input}
            placeholder="Confirm your password"
            placeholderTextColor="rgba(255,255,255,0.35)"
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            secureTextEntry
            editable={!loading}
          />

          {/* Terms */}
          <View style={styles.termsRow}>
            <TouchableOpacity
              style={[styles.checkbox, agreedToTerms && styles.checkboxChecked]}
              onPress={() => setAgreedToTerms(v => !v)}
              disabled={loading}
            >
              {agreedToTerms && <Text style={styles.checkmark}>✓</Text>}
            </TouchableOpacity>
            <View style={styles.termsTextRow}>
              <Text style={styles.termsText}>I agree to the </Text>
              <TouchableOpacity onPress={() => Linking.openURL('https://www.pragyago.com/terms')}>
                <Text style={styles.termsLink}>Terms of Service</Text>
              </TouchableOpacity>
              <Text style={styles.termsText}> and </Text>
              <TouchableOpacity onPress={() => Linking.openURL('https://www.pragyago.com/privacy-policy')}>
                <Text style={styles.termsLink}>Privacy Policy</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Register button */}
          <Pressable
            style={({ pressed }) => [
              styles.registerBtn,
              role === 'driver' && styles.registerBtnDriver,
              loading && styles.btnDisabled,
              pressed && styles.btnPressed,
            ]}
            onPress={handleRegister}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.registerBtnText}>Create Account</Text>
            }
          </Pressable>
        </View>

        {/* Sign in link */}
        <View style={styles.signInRow}>
          <Text style={styles.signInPrompt}>Already have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/auth/login')} disabled={loading}>
            <Text style={styles.signInLink}>Sign In</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0D1F2D' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 48 },

  /* Background */
  bgCircleTopRight: {
    position: 'absolute', width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(29,158,117,0.06)', top: -60, right: -60,
  },
  bgCircleBottomLeft: {
    position: 'absolute', width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(24,95,165,0.07)', bottom: 80, left: -50,
  },

  /* Back */
  backBtn: {
    marginTop: 12, marginBottom: 20, width: 40, height: 40,
    borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center', alignItems: 'center',
  },
  backBtnText: { fontSize: 20, color: '#FFFFFF', lineHeight: 24 },

  /* Header */
  headerSection: { alignItems: 'center', marginBottom: 28 },
  logo: { width: 50, height: 50, borderRadius: 12, backgroundColor: 'transparent', marginBottom: 12 },
  title: { fontSize: 28, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },

  /* Role selector */
  roleRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  roleCard: {
    flex: 1, borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14, paddingVertical: 16, paddingHorizontal: 10,
    alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  roleCardActiveGreen: {
    borderColor: '#1D9E75',
    backgroundColor: 'rgba(29,158,117,0.15)',
  },
  roleCardActiveBlue: {
    borderColor: '#185FA5',
    backgroundColor: 'rgba(24,95,165,0.15)',
  },
  roleEmoji: { fontSize: 28, marginBottom: 6 },
  roleTitle: { fontSize: 15, fontWeight: '700', color: 'rgba(255,255,255,0.7)', marginBottom: 2 },
  roleTitleGreen: { color: '#1D9E75' },
  roleTitleBlue: { color: '#4DA3FF' },
  roleSubtitle: { fontSize: 11, color: 'rgba(255,255,255,0.4)', textAlign: 'center' },

  /* Form */
  form: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.6)', marginTop: 10, marginBottom: 6 },
  input: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 15,
    fontSize: 15, color: '#FFFFFF',
  },

  /* Driver section */
  driverSection: {
    borderWidth: 1, borderColor: 'rgba(24,95,165,0.2)', borderRadius: 12,
    padding: 16, marginTop: 10, marginBottom: 4,
    backgroundColor: 'rgba(24,95,165,0.08)',
  },
  driverSectionTitle: { fontSize: 14, fontWeight: '700', color: '#185FA5', marginBottom: 14 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  colorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.15)', borderRadius: 20,
    paddingVertical: 6, paddingHorizontal: 10,
  },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  colorDotWhite: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.4)' },
  colorChipText: { fontSize: 12, color: 'rgba(255,255,255,0.6)' },
  driverNote: {
    backgroundColor: 'rgba(24,95,165,0.12)', borderRadius: 8,
    padding: 10, marginTop: 8,
  },
  driverNoteText: { fontSize: 12, color: '#4DA3FF', lineHeight: 18 },

  /* Terms */
  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 18, marginBottom: 4, paddingHorizontal: 2 },
  checkbox: {
    width: 22, height: 22, borderRadius: 5,
    borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxChecked: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: '700', lineHeight: 16 },
  termsTextRow: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  termsText: { fontSize: 13, color: 'rgba(255,255,255,0.7)' },
  termsLink: { fontSize: 13, color: '#1D9E75', fontWeight: '600' },

  /* Register button */
  registerBtn: {
    backgroundColor: '#1D9E75', borderRadius: 14,
    paddingVertical: 18, alignItems: 'center', marginTop: 20,
    shadowColor: '#1D9E75', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 14, elevation: 7,
  },
  registerBtnDriver: { backgroundColor: '#185FA5', shadowColor: '#185FA5' },
  btnDisabled: { opacity: 0.6 },
  btnPressed: { opacity: 0.85, transform: [{ scale: 0.98 }] },
  registerBtnText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.3 },

  /* Sign in row */
  signInRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24 },
  signInPrompt: { fontSize: 14, color: 'rgba(255,255,255,0.5)' },
  signInLink: { fontSize: 14, fontWeight: '700', color: '#1D9E75' },

  /* OTP screen */
  otpContainer: { flex: 1, paddingHorizontal: 24, paddingBottom: 48 },
  otpSubtitle: { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 20 },
  otpInput: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16,
    fontSize: 32, fontWeight: '700', letterSpacing: 8,
    color: '#FFFFFF', marginBottom: 24,
  },
  resendBtn: { alignItems: 'center', marginTop: 16, paddingVertical: 10 },
  resendBtnText: { fontSize: 14, color: '#1D9E75', fontWeight: '600' },
});
