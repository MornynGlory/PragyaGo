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
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface DocSlot {
  key: 'ghana_card_front' | 'ghana_card_back' | 'selfie';
  title: string;
  icon: string;
  description: string;
  camera: 'front' | 'back';
}

const SLOTS: DocSlot[] = [
  {
    key: 'ghana_card_front',
    title: 'Front of Ghana Card',
    icon: '🪪',
    description: 'Take a clear photo of the front of your Ghana Card',
    camera: 'back',
  },
  {
    key: 'ghana_card_back',
    title: 'Back of Ghana Card',
    icon: '🪪',
    description: 'Take a clear photo of the back of your Ghana Card',
    camera: 'back',
  },
  {
    key: 'selfie',
    title: 'Selfie with Ghana Card',
    icon: '🤳',
    description: 'Take a selfie while holding your Ghana Card next to your face',
    camera: 'front',
  },
];

export default function VerifyDriverScreen() {
  const router = useRouter();
  const [images, setImages] = useState<Record<string, string | null>>({
    ghana_card_front: null,
    ghana_card_back: null,
    selfie: null,
  });
  const [uploading, setUploading] = useState(false);
  const [driverId, setDriverId] = useState<string | null>(null);

  useEffect(() => {
    fetchDriverId();
  }, []);

  const fetchDriverId = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data } = await supabase.from('drivers').select('id').eq('profile_id', user.id).single();
    if (data) setDriverId(data.id);
  };

  const pickImage = async (slot: DocSlot) => {
    Alert.alert(slot.title, 'Choose how to add your photo', [
      {
        text: 'Take Photo',
        onPress: async () => {
          const { status } = await ImagePicker.requestCameraPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Permission needed', 'Camera permission is required.'); return; }
          const result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.8,
            allowsEditing: true,
            aspect: slot.camera === 'front' ? [1, 1] : [4, 3],
            cameraType: slot.camera === 'front'
              ? ImagePicker.CameraType.front
              : ImagePicker.CameraType.back,
          });
          if (!result.canceled && result.assets[0]) {
            setImages(prev => ({ ...prev, [slot.key]: result.assets[0].uri }));
          }
        },
      },
      {
        text: 'Choose from Gallery',
        onPress: async () => {
          const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (status !== 'granted') { Alert.alert('Permission needed', 'Gallery permission is required.'); return; }
          const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.8,
            allowsEditing: true,
          });
          if (!result.canceled && result.assets[0]) {
            setImages(prev => ({ ...prev, [slot.key]: result.assets[0].uri }));
          }
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const uploadImage = async (uri: string, path: string): Promise<string> => {
    const response = await fetch(uri);
    const blob = await response.blob();
    const arrayBuffer = await new Response(blob).arrayBuffer();
    const { error } = await supabase.storage
      .from('verification-docs')
      .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: true });
    if (error) throw error;
    const { data } = supabase.storage.from('verification-docs').getPublicUrl(path);
    return data.publicUrl;
  };

  const handleSubmit = async () => {
    if (!driverId) { Alert.alert('Error', 'Driver profile not found. Please try again.'); return; }
    if (!images.ghana_card_front || !images.ghana_card_back || !images.selfie) return;

    setUploading(true);
    try {
      const basePath = `drivers/${driverId}`;
      const [frontUrl, backUrl, selfieUrl] = await Promise.all([
        uploadImage(images.ghana_card_front!, `${basePath}/ghana_card_front.jpg`),
        uploadImage(images.ghana_card_back!, `${basePath}/ghana_card_back.jpg`),
        uploadImage(images.selfie!, `${basePath}/selfie.jpg`),
      ]);

      const { error } = await supabase.from('drivers').update({
        ghana_card_front_url: frontUrl,
        ghana_card_back_url: backUrl,
        selfie_url: selfieUrl,
        verification_status: 'pending',
      }).eq('id', driverId);

      if (error) throw error;

      Alert.alert(
        'Documents Submitted!',
        'We will review your application and notify you shortly.',
        [{ text: 'OK', onPress: () => router.replace('/auth/pending' as any) }]
      );
    } catch (err: any) {
      console.error('Upload error:', err);
      Alert.alert('Upload Failed', err?.message || 'Failed to upload documents. Please try again.');
    } finally {
      setUploading(false);
    }
  };

  const allSelected = images.ghana_card_front && images.ghana_card_back && images.selfie;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Identity Verification</Text>
        <Text style={styles.subtitle}>Upload the following documents to verify your account</Text>

        {SLOTS.map((slot) => {
          const uri = images[slot.key];
          return (
            <View key={slot.key} style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardIcon}>{slot.icon}</Text>
                <View style={styles.cardTitleGroup}>
                  <Text style={styles.cardTitle}>{slot.title}</Text>
                  <Text style={styles.cardDesc}>{slot.description}</Text>
                </View>
                {uri && <Text style={styles.checkmark}>✅</Text>}
              </View>

              {uri ? (
                <TouchableOpacity onPress={() => pickImage(slot)} disabled={uploading}>
                  <Image source={{ uri }} style={styles.preview} resizeMode="cover" />
                  <Text style={styles.retakeText}>Tap to retake</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.uploadButton, uploading && styles.buttonDisabled]}
                  onPress={() => pickImage(slot)}
                  disabled={uploading}
                >
                  <Text style={styles.uploadButtonText}>📷 Upload Photo</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}

        <TouchableOpacity
          style={[styles.submitButton, (!allSelected || uploading) && styles.buttonDisabled]}
          onPress={handleSubmit}
          disabled={!allSelected || uploading}
        >
          {uploading ? (
            <View style={styles.uploadingRow}>
              <ActivityIndicator color="#fff" />
              <Text style={styles.submitButtonText}>  Uploading...</Text>
            </View>
          ) : (
            <Text style={styles.submitButtonText}>Submit for Verification</Text>
          )}
        </TouchableOpacity>

        {!allSelected && (
          <Text style={styles.hintText}>Please upload all 3 documents to continue</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f5f5' },
  content: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#1D9E75', marginBottom: 8, marginTop: 8 },
  subtitle: { fontSize: 14, color: '#666', marginBottom: 24, lineHeight: 20 },
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  cardIcon: { fontSize: 28, marginRight: 12, marginTop: 2 },
  cardTitleGroup: { flex: 1 },
  cardTitle: { fontSize: 15, fontWeight: '700', color: '#222', marginBottom: 3 },
  cardDesc: { fontSize: 12, color: '#888', lineHeight: 17 },
  checkmark: { fontSize: 18 },
  preview: { width: '100%', height: 180, borderRadius: 8, backgroundColor: '#f0f0f0' },
  retakeText: { fontSize: 12, color: '#1D9E75', textAlign: 'center', marginTop: 8, fontWeight: '600' },
  uploadButton: { backgroundColor: '#E8F5EF', borderWidth: 1.5, borderColor: '#1D9E75', borderStyle: 'dashed', borderRadius: 8, paddingVertical: 20, alignItems: 'center' },
  uploadButtonText: { color: '#1D9E75', fontSize: 14, fontWeight: '600' },
  submitButton: { backgroundColor: '#1D9E75', paddingVertical: 16, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  uploadingRow: { flexDirection: 'row', alignItems: 'center' },
  buttonDisabled: { opacity: 0.5 },
  hintText: { fontSize: 12, color: '#999', textAlign: 'center', marginTop: 10 },
});
