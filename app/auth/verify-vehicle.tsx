// Run in Supabase SQL:
// ALTER TABLE drivers ADD COLUMN IF NOT EXISTS license_url TEXT;
// ALTER TABLE drivers ADD COLUMN IF NOT EXISTS insurance_url TEXT;
// ALTER TABLE drivers ADD COLUMN IF NOT EXISTS roadworthy_url TEXT;
// ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_verified BOOLEAN DEFAULT false;
// ALTER TABLE drivers ADD COLUMN IF NOT EXISTS vehicle_verification_status TEXT DEFAULT 'pending';

import { supabase } from '@/lib/supabase';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface DocSlot {
  key: 'license' | 'insurance' | 'roadworthy';
  title: string;
  description: string;
}

const SLOTS: DocSlot[] = [
  {
    key: 'license',
    title: "Driver's License",
    description: 'Upload a clear photo of your valid Ghana driver\'s license',
  },
  {
    key: 'insurance',
    title: 'Insurance Certificate',
    description: 'Third-party or comprehensive insurance policy',
  },
  {
    key: 'roadworthy',
    title: 'Roadworthy Certificate',
    description: 'Valid roadworthiness certificate for your Pragya',
  },
];

export default function VerifyVehicleScreen() {
  const router = useRouter();
  const [images, setImages] = useState<Record<string, string | null>>({
    license: null,
    insurance: null,
    roadworthy: null,
  });
  const [uploading, setUploading] = useState(false);

  const pickImage = async (slot: DocSlot) => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission needed', 'Please allow access to your photos');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      allowsEditing: true,
    });
    if (!result.canceled && result.assets[0]) {
      setImages(prev => ({ ...prev, [slot.key]: result.assets[0].uri }));
    }
  };

  const uploadImage = async (uri: string, fileName: string): Promise<string> => {
    const response = await fetch(uri);
    const blob = await response.blob();
    const arrayBuffer = await new Response(blob).arrayBuffer();
    const { error } = await supabase.storage
      .from('verification-docs')
      .upload(fileName, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('verification-docs').getPublicUrl(fileName);
    return data.publicUrl;
  };

  const handleSubmit = async () => {
    if (!images.license || !images.insurance || !images.roadworthy) return;

    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { Alert.alert('Error', 'Please log in again.'); return; }

      const timestamp = Date.now();
      const [licenseUrl, insuranceUrl, roadworthyUrl] = await Promise.all([
        uploadImage(images.license!, `license-${user.id}-${timestamp}.jpg`),
        uploadImage(images.insurance!, `insurance-${user.id}-${timestamp}.jpg`),
        uploadImage(images.roadworthy!, `roadworthy-${user.id}-${timestamp}.jpg`),
      ]);

      const { error } = await supabase.from('drivers').update({
        license_url: licenseUrl,
        insurance_url: insuranceUrl,
        roadworthy_url: roadworthyUrl,
        vehicle_verification_status: 'pending',
      }).eq('profile_id', user.id);

      if (error) throw error;

      router.replace('/auth/vehicle-pending' as any);
    } catch (err: any) {
      console.error('Upload error:', err);
      Alert.alert('Upload Failed', err?.message || 'Failed to upload documents. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const allUploaded = images.license && images.insurance && images.roadworthy;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.bgCircleTop} />
      <View style={styles.bgCircleBottom} />

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Header */}
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={22} color="#FFFFFF" />
        </TouchableOpacity>

        <View style={styles.headerSection}>
          <Image source={require('@/assets/images/icon.png')} style={styles.logo} resizeMode="contain" />
          <Text style={styles.title}>Vehicle Verification</Text>
          <Text style={styles.subtitle}>Upload your vehicle documents to start receiving rides</Text>
        </View>

        {/* Progress indicator */}
        <View style={styles.progressRow}>
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, styles.progressDotDone]}>
              <Feather name="check" size={14} color="#FFFFFF" />
            </View>
            <Text style={styles.progressLabel}>Identity</Text>
          </View>
          <View style={styles.progressLine} />
          <View style={styles.progressStep}>
            <View style={[styles.progressDot, styles.progressDotCurrent]}>
              <Feather name="clock" size={14} color="#FFFFFF" />
            </View>
            <Text style={[styles.progressLabel, styles.progressLabelCurrent]}>Vehicle</Text>
          </View>
        </View>

        {SLOTS.map((slot) => {
          const uri = images[slot.key];
          return (
            <View key={slot.key} style={styles.card}>
              <View style={styles.cardHeader}>
                <View style={styles.cardTitleGroup}>
                  <Text style={styles.cardTitle}>{slot.title}</Text>
                  <Text style={styles.cardDesc}>{slot.description}</Text>
                </View>
                {uri && (
                  <View style={styles.checkCircle}>
                    <Feather name="check" size={14} color="#FFFFFF" />
                  </View>
                )}
              </View>

              {uri ? (
                <TouchableOpacity onPress={() => pickImage(slot)} disabled={uploading}>
                  <Image source={{ uri }} style={styles.preview} resizeMode="cover" />
                  <Text style={styles.retakeText}>Tap to replace</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.uploadButton, uploading && styles.buttonDisabled]}
                  onPress={() => pickImage(slot)}
                  disabled={uploading}
                >
                  <Feather name="upload" size={18} color="#1D9E75" />
                  <Text style={styles.uploadButtonText}>Upload Photo</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        <TouchableOpacity
          style={[styles.submitButton, (!allUploaded || uploading) && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={!allUploaded || uploading}
        >
          {uploading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.submitButtonText}>Submit for Verification</Text>
          )}
        </TouchableOpacity>

        {!allUploaded && (
          <Text style={styles.hintText}>Please upload all 3 documents to continue</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#0D1F2D' },
  content: { padding: 24, paddingBottom: 40 },

  bgCircleTop: {
    position: 'absolute', width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(29,158,117,0.06)', top: -80, right: -60,
  },
  bgCircleBottom: {
    position: 'absolute', width: 220, height: 220, borderRadius: 110,
    backgroundColor: 'rgba(24,95,165,0.07)', bottom: 40, left: -60,
  },

  backBtn: { width: 40, height: 40, justifyContent: 'center', marginBottom: 4 },

  headerSection: { alignItems: 'center', marginBottom: 24 },
  logo: { width: 50, height: 50, borderRadius: 12, marginBottom: 12 },
  title: { fontSize: 24, fontWeight: '900', color: '#FFFFFF', letterSpacing: -0.5, marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 14, color: 'rgba(255,255,255,0.5)', textAlign: 'center', lineHeight: 20, paddingHorizontal: 12 },

  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  progressStep: { alignItems: 'center' },
  progressDot: { width: 32, height: 32, borderRadius: 16, justifyContent: 'center', alignItems: 'center', marginBottom: 6 },
  progressDotDone: { backgroundColor: '#1D9E75' },
  progressDotCurrent: { backgroundColor: '#185FA5' },
  progressLabel: { fontSize: 12, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },
  progressLabelCurrent: { color: '#FFFFFF' },
  progressLine: { width: 40, height: 2, backgroundColor: 'rgba(255,255,255,0.15)', marginHorizontal: 8, marginBottom: 20 },

  card: {
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 14, padding: 16, marginBottom: 16,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  cardTitleGroup: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#FFFFFF', marginBottom: 3 },
  cardDesc: { fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 17 },
  checkCircle: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#1D9E75', justifyContent: 'center', alignItems: 'center' },
  preview: { width: '100%', height: 160, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.08)' },
  retakeText: { fontSize: 12, color: '#1D9E75', textAlign: 'center', marginTop: 8, fontWeight: '600' },
  uploadButton: {
    flexDirection: 'row', gap: 8, backgroundColor: 'rgba(29,158,117,0.12)', borderWidth: 1.5,
    borderColor: '#1D9E75', borderStyle: 'dashed', borderRadius: 10, paddingVertical: 18,
    justifyContent: 'center', alignItems: 'center',
  },
  uploadButtonText: { color: '#1D9E75', fontSize: 14, fontWeight: '600' },
  submitButton: { backgroundColor: '#1D9E75', paddingVertical: 16, borderRadius: 14, alignItems: 'center', marginTop: 8 },
  submitButtonText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  buttonDisabled: { opacity: 0.5 },
  hintText: { fontSize: 12, color: 'rgba(255,255,255,0.4)', textAlign: 'center', marginTop: 10 },
});
