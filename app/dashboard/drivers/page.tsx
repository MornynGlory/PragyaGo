import { getDriverToken, sendPushNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Feather } from '@expo/vector-icons';
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

interface DriverRow {
  id: string;
  profile_id: string;
  plate_number: string | null;
  pragya_color: string | null;
  license_url: string | null;
  insurance_url: string | null;
  roadworthy_url: string | null;
  vehicle_verified: boolean | null;
  vehicle_verification_status: string | null;
  profiles: { full_name: string; phone: string } | null;
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  pending: { bg: '#FEF3C7', text: '#92400E' },
  approved: { bg: '#D1FAE5', text: '#065F46' },
  rejected: { bg: '#FEE2E2', text: '#991B1B' },
};

export default function DriversAdminPage() {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [drivers, setDrivers] = useState<DriverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState<string | null>(null);

  useEffect(() => {
    fetchDrivers();
  }, []);

  const fetchDrivers = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('drivers')
        .select('id, profile_id, plate_number, pragya_color, license_url, insurance_url, roadworthy_url, vehicle_verified, vehicle_verification_status, profiles(full_name, phone)')
        .not('license_url', 'is', null);
      if (error) throw error;
      const rows = (data ?? []) as unknown as DriverRow[];
      // Pending reviews first, then rejected, then approved
      const rank: Record<string, number> = { pending: 0, rejected: 1, approved: 2 };
      rows.sort((a, b) => (rank[a.vehicle_verification_status ?? 'pending'] ?? 0) - (rank[b.vehicle_verification_status ?? 'pending'] ?? 0));
      setDrivers(rows);
    } catch (error) {
      console.error('Error fetching drivers:', error);
      Alert.alert('Error', 'Failed to load drivers.');
    } finally {
      setLoading(false);
    }
  };

  const decideVehicle = async (driver: DriverRow, approve: boolean) => {
    setUpdating(driver.id);
    try {
      const { error } = await supabase
        .from('drivers')
        .update({
          vehicle_verified: approve,
          vehicle_verification_status: approve ? 'approved' : 'rejected',
        })
        .eq('id', driver.id);
      if (error) throw error;

      const token = await getDriverToken(driver.id);
      if (approve) {
        await sendPushNotification(
          token,
          '🚗 Vehicle Approved!',
          'Your vehicle documents have been approved! You can now go online and receive rides.'
        );
      } else {
        await sendPushNotification(
          token,
          'Vehicle Documents Rejected',
          'Your vehicle documents were not approved. Please re-submit clear photos of your license, insurance, and roadworthy certificate.'
        );
      }

      setDrivers(prev => prev.map(d =>
        d.id === driver.id
          ? { ...d, vehicle_verified: approve, vehicle_verification_status: approve ? 'approved' : 'rejected' }
          : d
      ));
    } catch (error) {
      console.error('Error updating vehicle verification:', error);
      Alert.alert('Error', 'Failed to update driver.');
    } finally {
      setUpdating(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.pageTitle}>Driver Vehicle Verification</Text>

        {loading ? (
          <ActivityIndicator color="#1D9E75" style={{ marginTop: 30 }} />
        ) : drivers.length === 0 ? (
          <Text style={styles.emptyText}>No vehicle document submissions yet.</Text>
        ) : (
          drivers.map((driver) => {
            const status = driver.vehicle_verification_status ?? 'pending';
            const statusColors = STATUS_COLORS[status] ?? STATUS_COLORS.pending;
            const isUpdating = updating === driver.id;
            return (
              <View key={driver.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.driverName}>{driver.profiles?.full_name ?? 'Unknown Driver'}</Text>
                    <Text style={styles.driverMeta}>{driver.profiles?.phone ?? 'No phone'}</Text>
                    <Text style={styles.driverMeta}>
                      {driver.plate_number ?? 'No plate'} · {driver.pragya_color ?? 'Unknown color'}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: statusColors.bg }]}>
                    <Text style={[styles.statusBadgeText, { color: statusColors.text }]}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </Text>
                  </View>
                </View>

                <View style={styles.docsSection}>
                  {[
                    { label: 'License', url: driver.license_url },
                    { label: 'Insurance', url: driver.insurance_url },
                    { label: 'Roadworthy', url: driver.roadworthy_url },
                  ].map((doc) => (
                    <View key={doc.label} style={styles.docBlock}>
                      <Text style={styles.docLabel}>{doc.label}</Text>
                      {doc.url ? (
                        <Image source={{ uri: doc.url }} style={styles.docImage} resizeMode="cover" />
                      ) : (
                        <View style={[styles.docImage, styles.docImageEmpty]}>
                          <Text style={styles.docImageEmptyText}>Not uploaded</Text>
                        </View>
                      )}
                    </View>
                  ))}
                </View>

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.approveBtn, (status === 'approved' || isUpdating) && styles.btnDisabled]}
                    onPress={() => decideVehicle(driver, true)}
                    disabled={status === 'approved' || isUpdating}
                  >
                    {isUpdating ? <ActivityIndicator color="#fff" size="small" /> : (
                      <>
                        <Feather name="check-circle" size={16} color="#fff" />
                        <Text style={styles.actionBtnText}>Approve Vehicle</Text>
                      </>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.rejectBtn, (status === 'rejected' || isUpdating) && styles.btnDisabled]}
                    onPress={() => decideVehicle(driver, false)}
                    disabled={status === 'rejected' || isUpdating}
                  >
                    <Feather name="x-circle" size={16} color="#fff" />
                    <Text style={styles.actionBtnText}>Reject Vehicle</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 40 },
    pageTitle: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 16 },
    emptyText: { fontSize: 14, color: c.textSecondary, textAlign: 'center', marginTop: 30 },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: c.cardBorder },
    cardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
    driverName: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 2 },
    driverMeta: { fontSize: 12, color: c.textSecondary, marginTop: 1 },
    statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 4 },
    statusBadgeText: { fontSize: 11, fontWeight: '700' },
    docsSection: { gap: 12, marginBottom: 14 },
    docBlock: {},
    docLabel: { fontSize: 12, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
    docImage: { width: '100%', height: 160, borderRadius: 8, backgroundColor: c.background2 },
    docImageEmpty: { justifyContent: 'center', alignItems: 'center' },
    docImageEmptyText: { fontSize: 12, color: c.textMuted },
    actionsRow: { flexDirection: 'row', gap: 10 },
    actionBtn: { flex: 1, flexDirection: 'row', gap: 6, justifyContent: 'center', alignItems: 'center', paddingVertical: 11, borderRadius: 8 },
    approveBtn: { backgroundColor: '#1D9E75' },
    rejectBtn: { backgroundColor: '#DC2626' },
    btnDisabled: { opacity: 0.5 },
    actionBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  });
}
