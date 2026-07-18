import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function VehiclePendingScreen() {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    checkStatus();
    intervalRef.current = setInterval(checkStatus, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const checkStatus = async () => {
    setChecking(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: driver } = await supabase
        .from('drivers')
        .select('vehicle_verified')
        .eq('profile_id', user.id)
        .single();
      if (driver?.vehicle_verified) {
        if (intervalRef.current) clearInterval(intervalRef.current);
        router.replace('/driver/home' as any);
      }
    } catch (err) {
      console.error('Error checking status:', err);
    } finally {
      setChecking(false);
    }
  };

  const handleLogout = async () => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    await supabase.auth.signOut();
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        <View style={styles.iconCircle}>
          <Text style={styles.icon}>⏳</Text>
        </View>

        <Text style={styles.title}>Vehicle Documents Submitted</Text>
        <Text style={styles.message}>
          We are reviewing your vehicle documents. This usually takes 24-48 hours. You will be notified once approved.
        </Text>

        <View style={styles.statusRow}>
          {checking
            ? <ActivityIndicator size="small" color="#1D9E75" />
            : <View style={styles.statusDot} />}
          <Text style={styles.statusText}>
            {checking ? 'Checking status...' : 'Checking every 30 seconds'}
          </Text>
        </View>

        <View style={styles.infoBox}>
          <Text style={styles.infoTitle}>What happens next?</Text>
          <Text style={styles.infoItem}>✅ Our team reviews your vehicle documents</Text>
          <Text style={styles.infoItem}>✅ You receive a notification when approved</Text>
          <Text style={styles.infoItem}>✅ You can then go online and start receiving rides</Text>
        </View>

        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <Text style={styles.logoutButtonText}>Logout</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  iconCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#E8F5EF', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  icon: { fontSize: 48 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#1D9E75', marginBottom: 14, textAlign: 'center' },
  message: { fontSize: 15, color: '#555', textAlign: 'center', lineHeight: 23, marginBottom: 24 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 32 },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1D9E75' },
  statusText: { fontSize: 13, color: '#888' },
  infoBox: { backgroundColor: '#fff', borderRadius: 12, padding: 18, width: '100%', marginBottom: 36, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  infoTitle: { fontSize: 14, fontWeight: '700', color: '#333', marginBottom: 12 },
  infoItem: { fontSize: 13, color: '#555', marginBottom: 8, lineHeight: 20 },
  logoutButton: { borderWidth: 1.5, borderColor: '#FF3B30', borderRadius: 10, paddingVertical: 13, paddingHorizontal: 40 },
  logoutButtonText: { color: '#FF3B30', fontSize: 15, fontWeight: '600' },
});
