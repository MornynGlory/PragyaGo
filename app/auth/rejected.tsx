import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function RejectedScreen() {
  const router = useRouter();
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchRejectionReason();
  }, []);

  const fetchRejectionReason = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: driver } = await supabase
        .from('drivers')
        .select('rejection_reason')
        .eq('profile_id', user.id)
        .single();
      setRejectionReason(driver?.rejection_reason ?? null);
    } catch (err) {
      console.error('Error fetching rejection reason:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.container}>
        {loading ? (
          <ActivityIndicator size="large" color="#FF3B30" />
        ) : (
          <>
            <View style={styles.iconCircle}>
              <Text style={styles.icon}>❌</Text>
            </View>

            <Text style={styles.title}>Verification Failed</Text>

            {rejectionReason ? (
              <View style={styles.reasonBox}>
                <Text style={styles.reasonLabel}>Reason</Text>
                <Text style={styles.reasonText}>{rejectionReason}</Text>
              </View>
            ) : null}

            <Text style={styles.message}>
              Please visit any PragyaGo office to resolve this issue or contact support.
            </Text>

            <TouchableOpacity
              style={styles.supportButton}
              onPress={() => router.push('/support' as any)}
            >
              <Text style={styles.supportButtonText}>🎧 Contact Support</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 },
  iconCircle: { width: 100, height: 100, borderRadius: 50, backgroundColor: '#FEE2E2', justifyContent: 'center', alignItems: 'center', marginBottom: 24 },
  icon: { fontSize: 48 },
  title: { fontSize: 26, fontWeight: 'bold', color: '#FF3B30', marginBottom: 20, textAlign: 'center' },
  reasonBox: { backgroundColor: '#fff', borderRadius: 12, padding: 16, width: '100%', marginBottom: 20, borderLeftWidth: 4, borderLeftColor: '#FF3B30', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  reasonLabel: { fontSize: 11, fontWeight: '700', color: '#FF3B30', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  reasonText: { fontSize: 14, color: '#333', lineHeight: 20 },
  message: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  supportButton: { backgroundColor: '#1D9E75', borderRadius: 10, paddingVertical: 14, paddingHorizontal: 32, marginBottom: 14, width: '100%', alignItems: 'center' },
  supportButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  logoutButton: { borderWidth: 1.5, borderColor: '#FF3B30', borderRadius: 10, paddingVertical: 13, paddingHorizontal: 40 },
  logoutButtonText: { color: '#FF3B30', fontSize: 15, fontWeight: '600' },
});
