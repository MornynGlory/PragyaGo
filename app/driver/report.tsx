import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    TouchableOpacity,
    View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const COMMISSION_RATE = 15; // 15%

export default function DriverReportScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [todayRides, setTodayRides] = useState<any[]>([]);
  const [cashRides, setCashRides] = useState(0);
  const [cashCollected, setCashCollected] = useState(0);
  const [goCashRides, setGoCashRides] = useState(0);
  const [goCashEarned, setGoCashEarned] = useState(0);
  const [commissionOwed, setCommissionOwed] = useState(0);
  const [notes, setNotes] = useState('');
  const [previousReports, setPreviousReports] = useState<any[]>([]);

  useEffect(() => {
    fetchTodayData();
  }, []);

  const fetchTodayData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: driver } = await supabase
        .from('drivers')
        .select('id')
        .eq('profile_id', user.id)
        .single();

      if (!driver) return;

      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Fetch today's completed rides
      const { data: rides } = await supabase
        .from('rides')
        .select('*')
        .eq('driver_id', driver.id)
        .eq('status', 'completed')
        .gte('completed_at', today.toISOString());

      if (rides) {
        setTodayRides(rides);
        const cash = rides.filter(r => r.payment_method === 'cash');
        const goCash = rides.filter(r => r.payment_method === 'momo' || r.payment_method === 'go_cash');
        const cashTotal = cash.reduce((sum, r) => sum + (r.fare_ghs || 0), 0);
        const goCashTotal = goCash.reduce((sum, r) => sum + (r.fare_ghs || 0), 0);
        setCashRides(cash.length);
        setCashCollected(cashTotal);
        setGoCashRides(goCash.length);
        setGoCashEarned(goCashTotal);
        const total = cashTotal + goCashTotal;
        setCommissionOwed(total * COMMISSION_RATE / 100);
      }

      // Fetch previous reports
      const { data: reports } = await supabase
        .from('driver_daily_reports')
        .select('*')
        .eq('driver_id', driver.id)
        .order('report_date', { ascending: false })
        .limit(7);

      if (reports) setPreviousReports(reports);
    } catch (error) {
      console.error('Error fetching report data:', error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    {loading ? (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1D9E75" />
      </View>
    ) : (
    <ScrollView style={styles.container}>
      <Text style={styles.pageTitle}>Daily Report</Text>
      <Text style={styles.pageDate}>{new Date().toDateString()}</Text>

      {/* Today's Summary */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Today's Summary</Text>

        <View style={styles.summaryGrid}>
          <View style={[styles.summaryCard, { backgroundColor: '#E6F1FB' }]}>
            <Text style={styles.summaryValue}>{cashRides}</Text>
            <Text style={styles.summaryLabel}>Cash Rides</Text>
            <Text style={styles.summaryAmount}>GHS {cashCollected.toFixed(2)}</Text>
          </View>
          <View style={[styles.summaryCard, { backgroundColor: '#E1F5EE' }]}>
            <Text style={styles.summaryValue}>{goCashRides}</Text>
            <Text style={styles.summaryLabel}>Go Cash Rides</Text>
            <Text style={[styles.summaryAmount, { color: '#1D9E75' }]}>GHS {goCashEarned.toFixed(2)} 🔒</Text>
          </View>
        </View>

        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total Rides</Text>
          <Text style={styles.totalValue}>{todayRides.length}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.totalLabel}>Total Earned</Text>
          <Text style={styles.totalValue}>GHS {(cashCollected + goCashEarned).toFixed(2)}</Text>
        </View>
        <View style={[styles.totalRow, styles.commissionRow]}>
          <Text style={styles.commissionLabel}>Commission Owed ({COMMISSION_RATE}%)</Text>
          <Text style={styles.commissionValue}>GHS {commissionOwed.toFixed(2)}</Text>
        </View>
      </View>

      {/* Go Cash Info */}
      <View style={[styles.section, { backgroundColor: '#E1F5EE' }]}>
        <Text style={styles.goCashTitle}>🔒 Go Cash Earnings</Text>
        <Text style={styles.goCashText}>
          GHS {goCashEarned.toFixed(2)} from Go Cash rides is held by PragyaGo.
          You will receive your share (GHS {(goCashEarned * (100 - COMMISSION_RATE) / 100).toFixed(2)}) after commission is settled.
        </Text>
      </View>

      {/* Notes */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Notes (optional)</Text>
        <TextInput
          style={styles.notesInput}
          placeholder="Any notes for today..."
          value={notes}
          onChangeText={setNotes}
          multiline
          numberOfLines={3}
          placeholderTextColor="#999"
        />
      </View>

      {/* Previous Reports */}
      {previousReports.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Previous Reports</Text>
          {previousReports.map((report) => (
            <View key={report.id} style={styles.reportRow}>
              <View style={styles.reportDetails}>
                <Text style={styles.reportDate}>{report.report_date}</Text>
                <Text style={styles.reportRides}>{report.total_cash_rides + report.total_go_cash_rides} rides</Text>
              </View>
              <View style={styles.reportRight}>
                <Text style={styles.reportEarnings}>
                  GHS {(report.total_cash_collected + report.total_go_cash_earned).toFixed(2)}
                </Text>
                <View style={[styles.commissionBadge, report.commission_paid ? styles.paidBadge : styles.unpaidBadge]}>
                  <Text style={styles.commissionBadgeText}>
                    {report.commission_paid ? 'Paid' : `GHS ${report.commission_owed?.toFixed(2)} owed`}
                  </Text>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>← Back to Home</Text>
      </TouchableOpacity>
    </ScrollView>
    )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  pageTitle: { fontSize: 24, fontWeight: 'bold', color: '#333', margin: 16, marginBottom: 4 },
  pageDate: { fontSize: 14, color: '#999', marginHorizontal: 16, marginBottom: 16 },
  section: {
    backgroundColor: '#fff',
    margin: 16,
    marginTop: 0,
    borderRadius: 12,
    padding: 16,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
  summaryGrid: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  summaryCard: {
    flex: 1,
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  summaryValue: { fontSize: 28, fontWeight: 'bold', color: '#333' },
  summaryLabel: { fontSize: 12, color: '#666', marginVertical: 4 },
  summaryAmount: { fontSize: 14, fontWeight: '600', color: '#185FA5' },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 0.5,
    borderBottomColor: '#eee',
  },
  totalLabel: { fontSize: 14, color: '#666' },
  totalValue: { fontSize: 14, fontWeight: '600', color: '#333' },
  commissionRow: { borderBottomWidth: 0, marginTop: 4 },
  commissionLabel: { fontSize: 15, fontWeight: '600', color: '#FF3B30' },
  commissionValue: { fontSize: 15, fontWeight: 'bold', color: '#FF3B30' },
  goCashTitle: { fontSize: 15, fontWeight: '600', color: '#085041', marginBottom: 8 },
  goCashText: { fontSize: 13, color: '#085041', lineHeight: 20 },
  notesInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#333',
    textAlignVertical: 'top',
  },
  reportRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 0.5,
    borderBottomColor: '#eee',
  },
  reportDetails: {},
  reportDate: { fontSize: 14, fontWeight: '600', color: '#333' },
  reportRides: { fontSize: 12, color: '#999', marginTop: 2 },
  reportRight: { alignItems: 'flex-end' },
  reportEarnings: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 4 },
  commissionBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  paidBadge: { backgroundColor: '#E1F5EE' },
  unpaidBadge: { backgroundColor: '#FFE5E5' },
  commissionBadgeText: { fontSize: 11, fontWeight: '600', color: '#333' },
  backButton: { margin: 16, alignItems: 'center', paddingBottom: 20 },
  backButtonText: { color: '#999', fontSize: 14 },
}); 