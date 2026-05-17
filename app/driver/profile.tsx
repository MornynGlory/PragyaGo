import { supabase } from '@/lib/supabase';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';

const PRAGYA_COLORS = [
  { label: 'Red', value: 'red', color: '#FF3B30' },
  { label: 'Blue', value: 'blue', color: '#2563eb' },
  { label: 'Yellow', value: 'yellow', color: '#FFD60A' },
  { label: 'Green', value: 'green', color: '#1D9E75' },
  { label: 'White', value: 'white', color: '#F2F2F7' },
  { label: 'Black', value: 'black', color: '#1C1C1E' },
  { label: 'Orange', value: 'orange', color: '#FF9500' },
  { label: 'Silver', value: 'silver', color: '#8E8E93' },
];

export default function DriverProfileScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [fullName, setFullName] = useState('');
  const [ghanaCardId, setGhanaCardId] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [pragyaColor, setPragyaColor] = useState('');
  const [isProfileLocked, setIsProfileLocked] = useState(false);
  const [newPlateNumber, setNewPlateNumber] = useState('');
  const [newPragyaColor, setNewPragyaColor] = useState('');
  const [phone, setPhone] = useState('');
  const [rating, setRating] = useState(0);
  const [totalRides, setTotalRides] = useState(0);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('id', user.id)
        .single();
      if (profile) {
        setFullName(profile.full_name || '');
        setPhone(profile.phone || '');
      }
      const { data: driver } = await supabase
        .from('drivers')
        .select('*')
        .eq('profile_id', user.id)
        .single();
      if (driver) {
        setGhanaCardId(driver.vehicle_number || '');
        setPlateNumber(driver.plate_number || '');
        setPragyaColor(driver.pragya_color || '');
        setPhotoUrl(driver.photo_url || null);
        setRating(driver.rating || 0);
        setTotalRides(driver.total_rides || 0);
        if (driver.plate_number && driver.photo_url && driver.pragya_color) {
          setIsProfileLocked(true);
        }
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setLoading(false);
    }
  };

  const pickPhoto = async () => {
    if (photoUrl) {
      Alert.alert(
        'Photo Locked',
        'Your profile photo cannot be changed. Visit any PragyaGo office or station near you to update it.'
      );
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission needed', 'Please allow access to your photos.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.7,
    });
    if (!result.canceled && result.assets[0]) {
      uploadPhoto(result.assets[0].uri);
    }
  };

  const uploadPhoto = async (uri: string) => {
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const response = await fetch(uri);
      const blob = await response.blob();
      const arrayBuffer = await new Response(blob).arrayBuffer();
      const fileName = `driver-${user.id}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('driver-photos')
        .upload(fileName, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
      if (uploadError) { Alert.alert('Upload Error', uploadError.message); return; }
      const { data: { publicUrl } } = supabase.storage
        .from('driver-photos')
        .getPublicUrl(fileName);
      setPhotoUrl(publicUrl);
      Alert.alert('Success', 'Photo uploaded! It will be locked after saving.');
    } catch (error) {
      Alert.alert('Error', 'Could not upload photo.');
    } finally {
      setUploading(false);
    }
  };

  const saveProfile = async () => {
    if (!isProfileLocked) {
      if (!newPlateNumber.trim()) {
        Alert.alert('Required', 'Please enter your Pragya plate number.');
        return;
      }
      if (!newPragyaColor) {
        Alert.alert('Required', 'Please select your Pragya color.');
        return;
      }
      if (!photoUrl) {
        Alert.alert('Required', 'Please upload your profile photo.');
        return;
      }
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('profiles').update({ phone: phone }).eq('id', user.id);
      if (!isProfileLocked) {
        await supabase.from('drivers').update({
          plate_number: newPlateNumber.trim().toUpperCase(),
          pragya_color: newPragyaColor,
          photo_url: photoUrl,
        }).eq('profile_id', user.id);
        setPlateNumber(newPlateNumber.trim().toUpperCase());
        setPragyaColor(newPragyaColor);
        setIsProfileLocked(true);
        Alert.alert('Profile Saved!', 'Your profile is now locked. Visit any PragyaGo office to make changes.');
      } else {
        Alert.alert('Saved!', 'Your phone number has been updated.');
      }
    } catch (error) {
      Alert.alert('Error', 'Could not save profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1D9E75" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {/* Profile Photo */}
      <View style={styles.photoSection}>
        <TouchableOpacity onPress={pickPhoto} disabled={uploading}>
          {photoUrl ? (
            <View>
              <Image source={{ uri: photoUrl }} style={styles.photo} />
              {isProfileLocked && (
                <View style={styles.photoLockBadge}>
                  <Text style={styles.photoLockIcon}>🔒</Text>
                </View>
              )}
            </View>
          ) : (
            <View style={styles.photoPlaceholder}>
              <Text style={styles.photoPlaceholderText}>📷</Text>
              <Text style={styles.photoPlaceholderLabel}>Add Photo</Text>
            </View>
          )}
          {uploading && (
            <View style={styles.uploadingOverlay}>
              <ActivityIndicator color="#fff" />
            </View>
          )}
        </TouchableOpacity>
        <Text style={styles.photoHint}>
          {photoUrl && isProfileLocked ? 'Photo locked — visit office to change' : 'Tap to add photo'}
        </Text>
        <View style={styles.statsRow}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>★ {rating.toFixed(1)}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{totalRides}</Text>
            <Text style={styles.statLabel}>Total Rides</Text>
          </View>
        </View>
      </View>

      {/* Locked Banner */}
      {isProfileLocked && (
        <View style={styles.lockedBanner}>
          <Text style={styles.lockedBannerText}>
            🔒 Identity details are locked. Visit any PragyaGo office to make changes.
          </Text>
        </View>
      )}

      {/* Identity */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Identity Information</Text>
        <Text style={styles.label}>Full Name</Text>
        <View style={styles.lockedField}>
          <Text style={styles.lockedFieldText}>{fullName || 'Not set'}</Text>
          <Text style={styles.lockIcon}>🔒</Text>
        </View>
        <Text style={styles.label}>Ghana Card ID</Text>
        <View style={styles.lockedField}>
          <Text style={styles.lockedFieldText}>{ghanaCardId || 'Not set'}</Text>
          <Text style={styles.lockIcon}>🔒</Text>
        </View>
        <Text style={styles.label}>Plate Number</Text>
        {isProfileLocked ? (
          <View style={styles.lockedField}>
            <Text style={styles.lockedFieldText}>{plateNumber}</Text>
            <Text style={styles.lockIcon}>🔒</Text>
          </View>
        ) : (
          <>
            <TextInput
              style={styles.input}
              value={newPlateNumber}
              onChangeText={setNewPlateNumber}
              placeholder="e.g. GR-1234-23"
              autoCapitalize="characters"
              placeholderTextColor="#999"
            />
            <Text style={styles.warningText}>⚠️ Cannot be changed after saving without visiting an office.</Text>
          </>
        )}
        <Text style={styles.label}>Pragya Color</Text>
        {isProfileLocked ? (
          <View style={styles.lockedField}>
            <View style={[styles.colorDot, { backgroundColor: PRAGYA_COLORS.find(c => c.value === pragyaColor)?.color || '#999' }]} />
            <Text style={styles.lockedFieldText}>{PRAGYA_COLORS.find(c => c.value === pragyaColor)?.label || 'Not set'}</Text>
            <Text style={styles.lockIcon}>🔒</Text>
          </View>
        ) : (
          <>
            <View style={styles.colorsGrid}>
              {PRAGYA_COLORS.map((c) => (
                <TouchableOpacity
                  key={c.value}
                  style={[styles.colorOption, { backgroundColor: c.color }, newPragyaColor === c.value && styles.colorSelected]}
                  onPress={() => setNewPragyaColor(c.value)}
                >
                  {newPragyaColor === c.value && <Text style={styles.colorCheck}>✓</Text>}
                </TouchableOpacity>
              ))}
            </View>
            {newPragyaColor && (
              <Text style={styles.colorLabel}>Selected: {PRAGYA_COLORS.find(c => c.value === newPragyaColor)?.label}</Text>
            )}
            <Text style={styles.warningText}>⚠️ Cannot be changed after saving without visiting an office.</Text>
          </>
        )}
      </View>

      {/* Editable */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Contact Details</Text>
        <Text style={styles.editableNote}>Only phone number can be updated.</Text>
        <Text style={styles.label}>Phone Number</Text>
        <TextInput
          style={styles.input}
          value={phone}
          onChangeText={setPhone}
          placeholder="024XXXXXXX"
          keyboardType="phone-pad"
          placeholderTextColor="#999"
        />
      </View>

      {/* Save Button */}
      <TouchableOpacity
        style={[styles.saveButton, saving && styles.buttonDisabled]}
        onPress={saveProfile}
        disabled={saving}
      >
        {saving ? <ActivityIndicator color="#fff" /> : (
          <Text style={styles.saveButtonText}>
            {isProfileLocked ? 'Update Phone Number' : 'Save & Lock Profile'}
          </Text>
        )}
      </TouchableOpacity>

      {/* Office Info */}
      <View style={styles.officeCard}>
        <Text style={styles.officeTitle}>📍 Need to make changes?</Text>
        <Text style={styles.officeText}>
          For any changes to your identity details or to register as a new driver, visit any PragyaGo office or station near you with a valid ID and your Ghana Card.
        </Text>
        <View style={styles.officeHoursBox}>
          <Text style={styles.officeHoursText}>🕐 Open Monday to Friday, 8am - 5pm</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>Back to Home</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  photoSection: { alignItems: 'center', padding: 24, backgroundColor: '#1D9E75' },
  photo: { width: 100, height: 100, borderRadius: 50, borderWidth: 3, borderColor: '#fff' },
  photoPlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(255,255,255,0.3)', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: '#fff', borderStyle: 'dashed' },
  photoPlaceholderText: { fontSize: 28 },
  photoPlaceholderLabel: { fontSize: 11, color: '#fff', marginTop: 2 },
  photoLockBadge: { position: 'absolute', bottom: 0, right: 0, backgroundColor: '#fff', borderRadius: 12, padding: 2 },
  photoLockIcon: { fontSize: 14 },
  uploadingOverlay: { position: 'absolute', width: 100, height: 100, borderRadius: 50, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  photoHint: { color: '#E1F5EE', fontSize: 12, marginTop: 8, textAlign: 'center' },
  statsRow: { flexDirection: 'row', marginTop: 16, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12, padding: 12 },
  statItem: { flex: 1, alignItems: 'center' },
  statValue: { fontSize: 20, fontWeight: 'bold', color: '#fff' },
  statLabel: { fontSize: 12, color: '#E1F5EE', marginTop: 2 },
  statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 10 },
  lockedBanner: { backgroundColor: '#FAEEDA', margin: 16, marginBottom: 0, borderRadius: 10, padding: 12 },
  lockedBannerText: { fontSize: 13, color: '#854F0B', textAlign: 'center' },
  section: { backgroundColor: '#fff', margin: 16, marginTop: 12, borderRadius: 12, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 4 },
  editableNote: { fontSize: 12, color: '#1D9E75', marginBottom: 12 },
  label: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 6, marginTop: 10 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: '#333' },
  lockedField: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f5f5f5', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: '#eee' },
  lockedFieldText: { flex: 1, fontSize: 14, color: '#666' },
  lockIcon: { fontSize: 14 },
  colorDot: { width: 20, height: 20, borderRadius: 10, marginRight: 10, borderWidth: 1, borderColor: '#ddd' },
  warningText: { fontSize: 11, color: '#FF9500', marginTop: 6 },
  colorsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 8 },
  colorOption: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'transparent' },
  colorSelected: { borderColor: '#333', borderWidth: 3 },
  colorCheck: { color: '#fff', fontWeight: 'bold', fontSize: 18, textShadowColor: '#000', textShadowRadius: 2 },
  colorLabel: { fontSize: 13, color: '#666', marginTop: 8 },
  saveButton: { backgroundColor: '#1D9E75', margin: 16, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  saveButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  officeCard: { backgroundColor: '#E1F5EE', margin: 16, marginTop: 0, borderRadius: 12, padding: 16 },
  officeTitle: { fontSize: 15, fontWeight: '600', color: '#085041', marginBottom: 8 },
  officeText: { fontSize: 13, color: '#085041', lineHeight: 20, marginBottom: 12 },
  officeHoursBox: { backgroundColor: '#fff', borderRadius: 8, padding: 10 },
  officeHoursText: { fontSize: 13, color: '#1D9E75', fontWeight: '500' },
  backButton: { margin: 16, marginTop: 0, alignItems: 'center', paddingBottom: 20 },
  backButtonText: { color: '#999', fontSize: 14 },
});
