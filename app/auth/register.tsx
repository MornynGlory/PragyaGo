import { supabase } from '@/lib/supabase';
import { routeAfterAuth } from '@/lib/routeAfterAuth';
import { useTheme } from '@/lib/theme';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TERMS_ACCEPTED_KEY, TERMS_VERSION } from './terms-screen';

const PRAGYA_COLORS = ['Red', 'Blue', 'Yellow', 'Green', 'White', 'Black', 'Orange', 'Silver'];
const COLOR_HEX: Record<string, string> = {
  Red: '#FF3B30', Blue: '#2563eb', Yellow: '#FFD60A', Green: '#34C759',
  White: '#F2F2F7', Black: '#3A3A3C', Orange: '#FF9500', Silver: '#8E8E93',
};

const GH_MOBILE_PREFIXES = ['020', '023', '024', '025', '026', '027', '028', '029', '050', '053', '054', '055', '056', '057', '059'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isGhMobile(digits: string): boolean {
  if (digits.length !== 10 || !digits.startsWith('0')) return false;
  return GH_MOBILE_PREFIXES.includes(digits.slice(0, 3));
}

function formatGhPhone(digits: string): string {
  const d = digits.slice(0, 10);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)} ${d.slice(3)}`;
  return `${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`;
}

type PasswordRules = {
  length: boolean;
  upper: boolean;
  lower: boolean;
  digit: boolean;
  symbol: boolean;
};
function passwordRules(pw: string): PasswordRules {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    digit: /\d/.test(pw),
    symbol: /[^A-Za-z0-9]/.test(pw),
  };
}
function passwordScore(pw: string): { score: number; label: 'Weak' | 'Fair' | 'Strong' } {
  const r = passwordRules(pw);
  const base = (r.length ? 1 : 0) + (r.upper ? 1 : 0) + (r.lower ? 1 : 0) + (r.digit ? 1 : 0);
  const bonus = r.symbol && pw.length >= 10 ? 1 : 0;
  const score = base + bonus;
  const label: 'Weak' | 'Fair' | 'Strong' = score <= 2 ? 'Weak' : score <= 3 ? 'Fair' : 'Strong';
  return { score, label };
}
function rulesAllPass(pw: string): boolean {
  const r = passwordRules(pw);
  return r.length && r.upper && r.lower && r.digit;
}

export default function RegisterScreen() {
  const router = useRouter();
  const theme = useTheme();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phoneDigits, setPhoneDigits] = useState('');
  const [ghanaCardId, setGhanaCardId] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [pragyaColor, setPragyaColor] = useState('');
  const [role, setRole] = useState<'rider' | 'driver'>('rider');
  const [loading, setLoading] = useState(false);
  const [checkingTerms, setCheckingTerms] = useState(true);
  const termsAcceptanceRef = useRef<{ version: string; acceptedAt: string } | null>(null);

  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // OTP step
  const [showOTPScreen, setShowOTPScreen] = useState(false);
  const [otp, setOtp] = useState('');
  const [sendingOTP, setSendingOTP] = useState(false);
  const [verifyingOTP, setVerifyingOTP] = useState(false);
  const [registeredPhone, setRegisteredPhone] = useState('');
  const [otpError, setOtpError] = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const resendCooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // field refs for returnKeyType="next"
  const emailRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const ghanaCardRef = useRef<TextInput>(null);
  const plateRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);
  const confirmRef = useRef<TextInput>(null);

  useEffect(() => {
    return () => { if (resendCooldownRef.current) clearInterval(resendCooldownRef.current); };
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(TERMS_ACCEPTED_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed?.accepted) {
          router.replace('/auth/terms-screen' as any);
          return;
        }
        termsAcceptanceRef.current = {
          version: parsed.version ?? TERMS_VERSION,
          acceptedAt: parsed.acceptedAt ?? new Date().toISOString(),
        };
        setCheckingTerms(false);
      } catch {
        router.replace('/auth/terms-screen' as any);
      }
    })();
  }, []);

  const startResendCooldown = (seconds: number) => {
    if (resendCooldownRef.current) clearInterval(resendCooldownRef.current);
    setResendCooldown(Math.max(0, Math.floor(seconds)));
    resendCooldownRef.current = setInterval(() => {
      setResendCooldown(prev => {
        if (prev <= 1) { clearInterval(resendCooldownRef.current!); return 0; }
        return prev - 1;
      });
    }, 1000);
  };

  // ----- field validators -----
  const nameError = (): string | null => {
    const parts = fullName.trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return 'Please enter your first and last name.';
    return null;
  };
  const emailError = (): string | null => {
    const e = email.trim().toLowerCase();
    if (!e) return 'Email is required.';
    if (!EMAIL_RE.test(e)) return 'Enter a valid email address.';
    return null;
  };
  const phoneError = (): string | null => {
    if (!phoneDigits) return 'Phone number is required.';
    if (!isGhMobile(phoneDigits)) return 'Enter a 10-digit Ghana mobile number (e.g. 024…).';
    return null;
  };
  const passwordError = (): string | null => {
    if (!password) return 'Password is required.';
    if (!rulesAllPass(password)) return 'Password does not meet the requirements.';
    return null;
  };
  const confirmError = (): string | null => {
    if (!confirmPassword) return 'Please confirm your password.';
    if (confirmPassword !== password) return 'Passwords do not match.';
    return null;
  };
  const driverGhanaCardError = (): string | null => {
    if (role !== 'driver') return null;
    if (!ghanaCardId.trim()) return 'Ghana Card ID is required.';
    return null;
  };
  const driverPlateError = (): string | null => {
    if (role !== 'driver') return null;
    if (!plateNumber.trim()) return 'Plate number is required.';
    return null;
  };
  const driverColorError = (): string | null => {
    if (role !== 'driver') return null;
    if (!pragyaColor) return 'Please pick a colour.';
    return null;
  };

  const showErr = (key: string, err: string | null): string | null =>
    (touched[key] || submitAttempted) ? err : null;

  const formValid =
    !nameError() && !emailError() && !phoneError() &&
    !passwordError() && !confirmError() &&
    !driverGhanaCardError() && !driverPlateError() && !driverColorError();

  const markTouched = (k: string) => setTouched(t => ({ ...t, [k]: true }));

  const friendlySignUpError = (msg: string): string => {
    const m = (msg || '').toLowerCase();
    if (m.includes('already registered') || m.includes('user already registered') || m.includes('already exists')) {
      return 'This email is already registered.';
    }
    if (m.includes('password') && m.includes('short')) return "Password doesn't meet the requirements.";
    if (m.includes('invalid email')) return 'Enter a valid email address.';
    return 'Something went wrong creating your account. Please try again.';
  };

  const handleRegister = async () => {
    Keyboard.dismiss();
    setSubmitAttempted(true);
    if (!formValid) return;

    setLoading(true);
    try {
      const trimmedEmail = email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signUp({ email: trimmedEmail, password });
      if (error) {
        const msg = error.message || '';
        if (/already registered|already exists|user already registered/i.test(msg)) {
          await signInExistingAccount(trimmedEmail);
          return;
        }
        Alert.alert('Registration Error', friendlySignUpError(msg));
        return;
      }
      if (!data?.user) return;

      const { error: profileError } = await supabase.from('profiles').insert([{
        id: data.user.id, role,
        full_name: fullName.trim(), phone: phoneDigits,
        email: trimmedEmail, created_at: new Date().toISOString(),
      }]);
      if (profileError) {
        Alert.alert('Profile Creation Error', 'Account created but profile setup failed. Please try logging in.');
        return;
      }

      const acceptedAt = termsAcceptanceRef.current?.acceptedAt ?? new Date().toISOString();
      await supabase.from('profiles').update({
        terms_accepted_at: acceptedAt,
        terms_version: termsAcceptanceRef.current?.version ?? TERMS_VERSION,
        privacy_accepted_at: acceptedAt,
      }).eq('id', data.user.id);
      await AsyncStorage.removeItem(TERMS_ACCEPTED_KEY);

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

      if (!data.session) {
        const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
          email: trimmedEmail,
          password,
        });
        if (signInError || !signInData?.session) {
          Alert.alert(
            'Email confirmation required',
            'Your account was created but we could not start a session (email confirmation may be required). Please contact support — the OTP verification flow needs a logged-in user.'
          );
          return;
        }
      }

      setRegisteredPhone(phoneDigits);
      setShowOTPScreen(true);
      await sendOtpCode();
    } catch (err) {
      console.error('Registration error:', err);
      Alert.alert('Error', 'An unexpected error occurred during registration');
    } finally {
      setLoading(false);
    }
  };

  const signInExistingAccount = async (emailArg?: string) => {
    const trimmedEmail = (emailArg ?? email.trim().toLowerCase());
    const { data, error } = await supabase.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });
    if (error || !data?.user) {
      Alert.alert(
        'Account Already Exists',
        'This email is already registered. Please check your password and try again, or reset your password.'
      );
      return;
    }
    Alert.alert('Welcome back!', 'Signing you in...');
    await routeAfterAuth(router);
  };

  const sendOtpCode = async (): Promise<boolean> => {
    setSendingOTP(true);
    setOtpError('');
    try {
      const { data, error } = await supabase.functions.invoke('otp-send', { body: {} });
      if (error || !data) {
        Alert.alert('Error', 'Could not send OTP. Please try again.');
        return false;
      }
      if (data.error) {
        switch (data.error) {
          case 'too_soon': {
            const retry = Number(data.retry_after_seconds) || 60;
            startResendCooldown(retry);
            setOtpError(`Please wait ${retry}s before requesting another code.`);
            return false;
          }
          case 'too_many_requests':
            Alert.alert('Too many attempts', 'Please try again later.');
            return false;
          case 'no_phone_on_profile':
            Alert.alert('Error', 'No phone number on your profile. Please contact support.');
            return false;
          case 'invalid_phone':
            Alert.alert('Error', 'The phone number on your profile looks invalid.');
            return false;
          case 'sms_failed':
          default:
            Alert.alert('Error', 'Could not send OTP. Please try again.');
            return false;
        }
      }
      if (data.already_verified) { goToPostVerificationScreen(); return true; }
      startResendCooldown(Number(data.expires_in_seconds) || 60);
      return true;
    } catch {
      Alert.alert('Error', 'Could not send OTP. Please try again.');
      return false;
    } finally {
      setSendingOTP(false);
    }
  };

  const verifyOTP = async () => {
    if (otp.length !== 6) { setOtpError('Please enter the 6-digit code.'); return; }
    setVerifyingOTP(true);
    setOtpError('');
    try {
      const { data, error } = await supabase.functions.invoke('otp-verify', { body: { code: otp } });
      if (error || !data) { setOtpError('Verification failed. Please try again.'); return; }
      if (data.error) {
        switch (data.error) {
          case 'wrong_code': {
            const left = data.attempts_left;
            setOtpError(typeof left === 'number'
              ? `Wrong code — ${left} attempt${left === 1 ? '' : 's'} left.`
              : 'Wrong code. Please try again.');
            return;
          }
          case 'code_expired': setOtpError('Code expired, tap Resend.'); return;
          case 'no_pending_code': setOtpError('No pending code. Tap Resend to get a new one.'); return;
          case 'too_many_attempts': setOtpError('Too many attempts. Tap Resend for a new code.'); return;
          case 'invalid_code_format': setOtpError('Please enter the 6-digit code.'); return;
          default: setOtpError('Verification failed. Please try again.'); return;
        }
      }
      if (data.ok) { goToPostVerificationScreen(); return; }
      setOtpError('Verification failed. Please try again.');
    } finally {
      setVerifyingOTP(false);
    }
  };

  const goToPostVerificationScreen = () => {
    if (role === 'driver') router.replace('/auth/verify-driver' as any);
    else router.replace('/rider/home' as any);
  };

  const resendOTP = async () => {
    if (resendCooldown > 0) return;
    setOtp('');
    setOtpError('');
    await sendOtpCode();
  };

  // ---------------- RENDER ----------------
  if (checkingTerms) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        <View style={styles.loadingGate}>
          <ActivityIndicator color={theme.green} />
        </View>
      </SafeAreaView>
    );
  }

  const pwRules = passwordRules(password);
  const pwScore = passwordScore(password);
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === password;

  // OTP screen
  if (showOTPScreen) {
    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
            <ScrollView
              contentContainerStyle={styles.otpScroll}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.headerSection}>
                <Image source={require('@/assets/images/icon.png')} style={styles.logo} resizeMode="contain" />
                <Text style={[styles.title, { color: theme.text }]}>Verify your number</Text>
                <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                  Enter the 6-digit code sent to{'\n'}{registeredPhone}
                </Text>
              </View>

              <TextInput
                style={[styles.otpInput, { backgroundColor: theme.input, borderColor: theme.inputBorder, color: theme.text }]}
                value={otp}
                onChangeText={v => { setOtp(v.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
                keyboardType="number-pad"
                maxLength={6}
                placeholder="------"
                placeholderTextColor={theme.placeholder}
                textAlign="center"
                autoFocus
                editable={!verifyingOTP}
                returnKeyType="done"
                onSubmitEditing={verifyOTP}
              />

              {otpError ? (
                <Text style={{ color: theme.red, fontSize: 13, textAlign: 'center', marginBottom: 12 }}>
                  {otpError}
                </Text>
              ) : null}

              <Pressable
                style={({ pressed }) => [
                  styles.primaryBtn,
                  { backgroundColor: theme.green },
                  (verifyingOTP || sendingOTP) && styles.btnDisabled,
                  pressed && styles.btnPressed,
                ]}
                onPress={verifyOTP}
                disabled={verifyingOTP || sendingOTP}
              >
                {verifyingOTP ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Verify</Text>}
              </Pressable>

              <TouchableOpacity
                style={styles.linkBtn}
                onPress={resendOTP}
                disabled={sendingOTP || verifyingOTP || resendCooldown > 0}
              >
                {sendingOTP ? (
                  <ActivityIndicator color={theme.green} size="small" />
                ) : (
                  <Text style={[
                    { fontSize: 14, fontWeight: '600', color: theme.green },
                    (resendCooldown > 0 || verifyingOTP) && { color: theme.textMuted },
                  ]}>
                    {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </SafeAreaView>
    );
  }

  // Main sign-up screen
  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.background }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            <TouchableOpacity
              style={[styles.backBtn, { backgroundColor: theme.input }]}
              onPress={() => router.replace('/')}
              disabled={loading}
            >
              <Feather name="arrow-left" size={20} color={theme.text} />
            </TouchableOpacity>

            <View style={styles.headerSection}>
              <Image source={require('@/assets/images/icon.png')} style={styles.logo} resizeMode="contain" />
              <Text style={[styles.title, { color: theme.text }]}>Create your account</Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>Join PragyaGo in a few seconds</Text>
            </View>

            {/* Role segmented control */}
            <View style={[styles.segment, { backgroundColor: theme.input, borderColor: theme.inputBorder }]}>
              {(['rider', 'driver'] as const).map((r) => (
                <Pressable
                  key={r}
                  onPress={() => setRole(r)}
                  disabled={loading}
                  style={[
                    styles.segmentItem,
                    role === r && { backgroundColor: theme.green },
                  ]}
                >
                  <Text style={[
                    styles.segmentText,
                    { color: role === r ? '#fff' : theme.textSecondary },
                  ]}>
                    {r === 'rider' ? '👤 Rider' : '🛺 Driver'}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* Full name */}
            <FieldLabel theme={theme}>Full name</FieldLabel>
            <InputRow theme={theme} icon="user">
              <TextInput
                style={[styles.input, { color: theme.text }]}
                placeholder="First and last name"
                placeholderTextColor={theme.placeholder}
                value={fullName}
                onChangeText={setFullName}
                onBlur={() => markTouched('name')}
                editable={!loading}
                returnKeyType="next"
                onSubmitEditing={() => emailRef.current?.focus()}
                autoCapitalize="words"
              />
            </InputRow>
            <ErrorLine theme={theme} msg={showErr('name', nameError())} />

            {/* Email */}
            <FieldLabel theme={theme}>Email</FieldLabel>
            <InputRow theme={theme} icon="mail">
              <TextInput
                ref={emailRef}
                style={[styles.input, { color: theme.text }]}
                placeholder="you@example.com"
                placeholderTextColor={theme.placeholder}
                value={email}
                onChangeText={setEmail}
                onBlur={() => markTouched('email')}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                editable={!loading}
                returnKeyType="next"
                onSubmitEditing={() => phoneRef.current?.focus()}
              />
            </InputRow>
            <ErrorLine theme={theme} msg={showErr('email', emailError())} />

            {/* Phone */}
            <FieldLabel theme={theme}>Phone number</FieldLabel>
            <InputRow theme={theme} icon="phone">
              <TextInput
                ref={phoneRef}
                style={[styles.input, { color: theme.text }]}
                placeholder="024 123 4567"
                placeholderTextColor={theme.placeholder}
                value={formatGhPhone(phoneDigits)}
                onChangeText={v => setPhoneDigits(v.replace(/\D/g, '').slice(0, 10))}
                onBlur={() => markTouched('phone')}
                keyboardType="phone-pad"
                editable={!loading}
                returnKeyType="next"
                onSubmitEditing={() => role === 'driver' ? ghanaCardRef.current?.focus() : passwordRef.current?.focus()}
              />
            </InputRow>
            <ErrorLine theme={theme} msg={showErr('phone', phoneError())} />

            {/* Driver block */}
            {role === 'driver' ? (
              <View style={[styles.driverSection, { backgroundColor: theme.blueLight, borderColor: theme.blue + '33' }]}>
                <Text style={[styles.driverSectionTitle, { color: theme.blue }]}>🛺 Your Pragya</Text>

                <FieldLabel theme={theme}>Ghana Card ID</FieldLabel>
                <InputRow theme={theme} icon="credit-card">
                  <TextInput
                    ref={ghanaCardRef}
                    style={[styles.input, { color: theme.text }]}
                    placeholder="GHA-XXXXXXXXX-X"
                    placeholderTextColor={theme.placeholder}
                    value={ghanaCardId}
                    onChangeText={setGhanaCardId}
                    onBlur={() => markTouched('ghanaCard')}
                    autoCapitalize="characters"
                    editable={!loading}
                    returnKeyType="next"
                    onSubmitEditing={() => plateRef.current?.focus()}
                  />
                </InputRow>
                <ErrorLine theme={theme} msg={showErr('ghanaCard', driverGhanaCardError())} />

                <FieldLabel theme={theme}>Plate number</FieldLabel>
                <InputRow theme={theme} icon="hash">
                  <TextInput
                    ref={plateRef}
                    style={[styles.input, { color: theme.text }]}
                    placeholder="M-21-AW 5615"
                    placeholderTextColor={theme.placeholder}
                    value={plateNumber}
                    onChangeText={(t) => setPlateNumber(t.toUpperCase())}
                    onBlur={() => markTouched('plate')}
                    autoCapitalize="characters"
                    editable={!loading}
                    returnKeyType="next"
                    onSubmitEditing={() => passwordRef.current?.focus()}
                  />
                </InputRow>
                <ErrorLine theme={theme} msg={showErr('plate', driverPlateError())} />

                <FieldLabel theme={theme}>Pragya colour</FieldLabel>
                <View style={styles.colorGrid}>
                  {PRAGYA_COLORS.map((color) => {
                    const active = pragyaColor === color;
                    return (
                      <TouchableOpacity
                        key={color}
                        style={[
                          styles.colorChip,
                          { borderColor: theme.inputBorder, backgroundColor: theme.input },
                          active && { borderColor: COLOR_HEX[color], backgroundColor: theme.greenLight },
                        ]}
                        onPress={() => { setPragyaColor(color); markTouched('color'); }}
                        disabled={loading}
                      >
                        <View style={[
                          styles.colorDot,
                          { backgroundColor: COLOR_HEX[color] },
                          color === 'White' && { borderWidth: 1, borderColor: theme.border },
                        ]} />
                        <Text style={[
                          { fontSize: 12, color: theme.textSecondary },
                          active && { color: COLOR_HEX[color], fontWeight: '700' },
                        ]}>{color}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <ErrorLine theme={theme} msg={showErr('color', driverColorError())} />

                <View style={[styles.driverNote, { backgroundColor: theme.blueLight }]}>
                  <Text style={{ fontSize: 12, color: theme.blue, lineHeight: 18 }}>
                    🔒 These details will be locked after registration. Visit any PragyaGo office to make changes.
                  </Text>
                </View>
              </View>
            ) : null}

            {/* Password */}
            <FieldLabel theme={theme}>Password</FieldLabel>
            <InputRow theme={theme} icon="lock">
              <TextInput
                ref={passwordRef}
                style={[styles.input, { color: theme.text, flex: 1 }]}
                placeholder="At least 8 characters"
                placeholderTextColor={theme.placeholder}
                value={password}
                onChangeText={setPassword}
                onBlur={() => markTouched('password')}
                secureTextEntry={!showPassword}
                editable={!loading}
                returnKeyType="next"
                onSubmitEditing={() => confirmRef.current?.focus()}
              />
              <TouchableOpacity onPress={() => setShowPassword(v => !v)} hitSlop={10}>
                <Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            </InputRow>

            {password.length > 0 ? (
              <View style={{ marginTop: 8, marginBottom: 4 }}>
                <View style={styles.strengthRow}>
                  {[0, 1, 2].map(i => (
                    <View
                      key={i}
                      style={[
                        styles.strengthBar,
                        {
                          backgroundColor:
                            pwScore.score > i
                              ? pwScore.label === 'Strong' ? theme.green : pwScore.label === 'Fair' ? theme.amber : theme.red
                              : theme.inputBorder,
                        },
                      ]}
                    />
                  ))}
                  <Text style={{ marginLeft: 8, fontSize: 12, color: theme.textSecondary }}>
                    {pwScore.label}
                  </Text>
                </View>
                <View style={{ marginTop: 6, gap: 2 }}>
                  <RuleRow theme={theme} ok={pwRules.length} label="At least 8 characters" />
                  <RuleRow theme={theme} ok={pwRules.upper} label="One uppercase letter" />
                  <RuleRow theme={theme} ok={pwRules.lower} label="One lowercase letter" />
                  <RuleRow theme={theme} ok={pwRules.digit} label="One number" />
                  <RuleRow theme={theme} ok={pwRules.symbol} label="One symbol (optional)" optional />
                </View>
              </View>
            ) : null}
            <ErrorLine theme={theme} msg={showErr('password', passwordError())} />

            {/* Confirm password */}
            <FieldLabel theme={theme}>Confirm password</FieldLabel>
            <InputRow theme={theme} icon="lock">
              <TextInput
                ref={confirmRef}
                style={[styles.input, { color: theme.text, flex: 1 }]}
                placeholder="Re-enter your password"
                placeholderTextColor={theme.placeholder}
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                onBlur={() => markTouched('confirm')}
                secureTextEntry={!showConfirm}
                editable={!loading}
                returnKeyType="done"
                onSubmitEditing={handleRegister}
              />
              <TouchableOpacity onPress={() => setShowConfirm(v => !v)} hitSlop={10}>
                <Feather name={showConfirm ? 'eye-off' : 'eye'} size={18} color={theme.textSecondary} />
              </TouchableOpacity>
            </InputRow>
            {confirmPassword.length > 0 ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <Feather
                  name={passwordsMatch ? 'check-circle' : 'x-circle'}
                  size={14}
                  color={passwordsMatch ? theme.green : theme.red}
                />
                <Text style={{ fontSize: 12, color: passwordsMatch ? theme.green : theme.red }}>
                  {passwordsMatch ? 'Passwords match' : 'Passwords do not match'}
                </Text>
              </View>
            ) : null}
            <ErrorLine theme={theme} msg={showErr('confirm', confirmError())} />

            {/* Submit */}
            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                { backgroundColor: theme.green },
                (!formValid || loading) && styles.btnDisabled,
                pressed && styles.btnPressed,
                { marginTop: 24 },
              ]}
              onPress={handleRegister}
              disabled={loading}
            >
              {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.primaryBtnText}>Create account</Text>}
            </Pressable>

            <View style={styles.signInRow}>
              <Text style={{ fontSize: 14, color: theme.textSecondary }}>Already have an account? </Text>
              <TouchableOpacity onPress={() => router.push('/auth/login')} disabled={loading}>
                <Text style={{ fontSize: 14, fontWeight: '700', color: theme.green }}>Log in</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---- small presentational helpers (closed-over theme passed as prop) ----

function FieldLabel({ children, theme }: { children: React.ReactNode; theme: ReturnType<typeof useTheme> }) {
  return <Text style={{ fontSize: 13, fontWeight: '600', color: theme.textSecondary, marginTop: 14, marginBottom: 6 }}>{children}</Text>;
}

function InputRow({ children, theme, icon }: { children: React.ReactNode; theme: ReturnType<typeof useTheme>; icon: React.ComponentProps<typeof Feather>['name'] }) {
  return (
    <View style={[styles.inputRow, { backgroundColor: theme.input, borderColor: theme.inputBorder }]}>
      <Feather name={icon} size={16} color={theme.textSecondary} style={{ marginRight: 10 }} />
      {children}
    </View>
  );
}

function ErrorLine({ msg, theme }: { msg: string | null; theme: ReturnType<typeof useTheme> }) {
  if (!msg) return null;
  return <Text style={{ fontSize: 12, color: theme.red, marginTop: 4 }}>{msg}</Text>;
}

function RuleRow({ ok, label, theme, optional }: { ok: boolean; label: string; theme: ReturnType<typeof useTheme>; optional?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Feather name={ok ? 'check-circle' : optional ? 'circle' : 'circle'} size={12} color={ok ? theme.green : theme.textMuted} />
      <Text style={{ fontSize: 12, color: ok ? theme.green : theme.textSecondary }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 40 },
  otpScroll: { paddingHorizontal: 24, paddingBottom: 48, paddingTop: 24, flexGrow: 1 },

  backBtn: {
    marginTop: 12, marginBottom: 16, width: 40, height: 40,
    borderRadius: 20, justifyContent: 'center', alignItems: 'center',
  },

  headerSection: { alignItems: 'center', marginBottom: 24 },
  logo: { width: 48, height: 48, borderRadius: 12, marginBottom: 12 },
  title: { fontSize: 26, fontWeight: '900', letterSpacing: -0.5, marginBottom: 6 },
  subtitle: { fontSize: 14, textAlign: 'center' },

  segment: {
    flexDirection: 'row',
    borderRadius: 12,
    borderWidth: 1,
    padding: 4,
    marginBottom: 8,
  },
  segmentItem: {
    flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10,
  },
  segmentText: { fontSize: 14, fontWeight: '700' },

  inputRow: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 14 : 10,
  },
  input: { flex: 1, fontSize: 15 },

  driverSection: {
    borderWidth: 1, borderRadius: 12,
    padding: 14, marginTop: 12, marginBottom: 4,
  },
  driverSectionTitle: { fontSize: 14, fontWeight: '700', marginBottom: 10 },
  colorGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  colorChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1.5, borderRadius: 20, paddingVertical: 6, paddingHorizontal: 10,
  },
  colorDot: { width: 14, height: 14, borderRadius: 7 },
  driverNote: { borderRadius: 8, padding: 10, marginTop: 10 },

  strengthRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },

  primaryBtn: {
    borderRadius: 14, paddingVertical: 16, alignItems: 'center',
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.3, shadowRadius: 10, elevation: 5,
  },
  primaryBtnText: { fontSize: 16, fontWeight: '700', color: '#FFFFFF', letterSpacing: 0.3 },
  btnDisabled: { opacity: 0.6 },
  btnPressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },

  linkBtn: { alignItems: 'center', marginTop: 14, paddingVertical: 10 },

  signInRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20 },

  otpInput: {
    borderWidth: 1, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 16,
    fontSize: 30, fontWeight: '700', letterSpacing: 8,
    marginBottom: 16,
  },

  loadingGate: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
