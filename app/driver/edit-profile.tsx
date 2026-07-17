import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const PRAGYA_COLOR_LABELS: Record<string, string> = {
  red: 'Red', blue: 'Blue', yellow: 'Yellow', green: 'Green',
  white: 'White', black: 'Black', orange: 'Orange', silver: 'Silver',
};

export default function DriverEditProfileScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [ghanaCardId, setGhanaCardId] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [pragyaColor, setPragyaColor] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  useEffect(() => { fetchProfile(); }, []);

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setEmail(user.email ?? '');

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('id', user.id)
        .single();
      if (profile) {
        setFullName(profile.full_name ?? '');
        setPhone(profile.phone ?? '');
      }

      const { data: driver } = await supabase
        .from('drivers')
        .select('vehicle_number, plate_number, pragya_color, photo_url')
        .eq('profile_id', user.id)
        .single();
      if (driver) {
        setGhanaCardId(driver.vehicle_number ?? '');
        setPlateNumber(driver.plate_number ?? '');
        setPragyaColor(driver.pragya_color ?? '');
        setPhotoUrl(driver.photo_url ?? null);
      }
    } catch (e) {
      console.error('fetchProfile error:', e);
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async () => {
    if (!fullName.trim()) {
      Alert.alert('Required', 'Please enter your full name.');
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('profiles')
        .update({ full_name: fullName.trim(), phone: phone.trim() })
        .eq('id', user.id);
      if (error) { Alert.alert('Error', error.message); return; }
      Alert.alert('Saved', 'Your profile has been updated.');
      router.back();
    } catch (e) {
      Alert.alert('Error', 'Could not save profile. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const initials = fullName.split(' ').map(n => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 2) || '?';

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1D9E75" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Header bar */}
      <View style={styles.topBar}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.topBarTitle}>My Profile</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* Avatar */}
        <View style={styles.avatarSection}>
          {photoUrl ? (
            <View style={styles.avatarContainer}>
              <Text style={styles.initials}>{initials}</Text>
            </View>
          ) : (
            <View style={styles.avatarContainer}>
              <Text style={styles.initials}>{initials}</Text>
            </View>
          )}
          <Text style={styles.avatarHint}>Contact support to change your photo</Text>
        </View>

        {/* Editable fields */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Personal Details</Text>

          <Text style={styles.fieldLabel}>Full Name</Text>
          <TextInput
            style={styles.input}
            value={fullName}
            onChangeText={setFullName}
            placeholder="Your full name"
            placeholderTextColor={theme.placeholder}
            autoCapitalize="words"
          />

          <Text style={styles.fieldLabel}>Phone Number</Text>
          <TextInput
            style={styles.input}
            value={phone}
            onChangeText={setPhone}
            placeholder="024XXXXXXX"
            placeholderTextColor={theme.placeholder}
            keyboardType="phone-pad"
          />

          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput
            style={[styles.input, styles.inputLocked]}
            value={email}
            editable={false}
            placeholderTextColor={theme.placeholder}
          />
          <Text style={styles.lockedNote}>Email cannot be changed here</Text>
        </View>

        {/* Read-only fields */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Vehicle & Identity</Text>
          <Text style={styles.lockedBannerText}>🔒 These details are locked. Visit any PragyaGo office to make changes.</Text>

          <Text style={styles.fieldLabel}>Ghana Card ID</Text>
          <View style={styles.lockedField}>
            <Text style={styles.lockedFieldText}>{ghanaCardId || 'Not set'}</Text>
            <Feather name="lock" size={14} color={theme.textMuted} />
          </View>

          <Text style={styles.fieldLabel}>Plate Number</Text>
          <View style={styles.lockedField}>
            <Text style={styles.lockedFieldText}>{plateNumber || 'Not set'}</Text>
            <Feather name="lock" size={14} color={theme.textMuted} />
          </View>

          <Text style={styles.fieldLabel}>Pragya Color</Text>
          <View style={styles.lockedField}>
            <Text style={styles.lockedFieldText}>
              {(PRAGYA_COLOR_LABELS[pragyaColor] ?? pragyaColor) || 'Not set'}
            </Text>
            <Feather name="lock" size={14} color={theme.textMuted} />
          </View>
        </View>

        {/* Save */}
        <TouchableOpacity
          style={[styles.saveButton, saving && styles.saveButtonDisabled]}
          onPress={saveProfile}
          disabled={saving}
          activeOpacity={0.85}
        >
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={styles.saveButtonText}>Save Changes</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border, backgroundColor: c.card },
    backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    topBarTitle: { fontSize: 17, fontWeight: '700', color: c.text },
    scrollContent: { paddingBottom: 40 },
    avatarSection: { alignItems: 'center', paddingVertical: 28, backgroundColor: c.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    avatarContainer: { width: 88, height: 88, borderRadius: 44, backgroundColor: '#1D9E75', justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
    initials: { fontSize: 30, fontWeight: '700', color: '#fff' },
    avatarHint: { fontSize: 12, color: c.textMuted },
    section: { backgroundColor: c.card, marginHorizontal: 16, marginTop: 20, borderRadius: 14, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder },
    sectionTitle: { fontSize: 13, fontWeight: '700', color: c.textSecondary, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
    fieldLabel: { fontSize: 12, fontWeight: '600', color: c.textSecondary, marginBottom: 6, marginTop: 10 },
    input: { borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text, backgroundColor: c.input },
    inputLocked: { color: c.textMuted, backgroundColor: c.background2 },
    lockedNote: { fontSize: 11, color: c.textMuted, marginTop: 4 },
    lockedBannerText: { fontSize: 12, color: '#854F0B', backgroundColor: '#FAEEDA', borderRadius: 8, padding: 10, marginBottom: 4 },
    lockedField: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: c.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: c.background2 },
    lockedFieldText: { flex: 1, fontSize: 15, color: c.textSecondary },
    saveButton: { margin: 16, marginTop: 24, backgroundColor: '#1D9E75', paddingVertical: 15, borderRadius: 12, alignItems: 'center' },
    saveButtonDisabled: { opacity: 0.6 },
    saveButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  });
}
