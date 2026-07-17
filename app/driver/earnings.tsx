import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const COMMISSION_RATE = 0.15;
const COMMISSION_PCT = 15;

type Filter = 'today' | 'week' | 'month';
type Tab = 'earnings' | 'reports';

interface EarningsRide {
  id: string;
  pickup_location: string;
  dropoff_location: string;
  final_fare: number;
  completed_at: string;
  riderName: string;
}

interface Stats {
  totalEarned: number;
  commissionOwed: number;
  netEarnings: number;
  rideCount: number;
}

function getDateRange(filter: Filter): string {
  const now = new Date();
  if (filter === 'today') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  }
  if (filter === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    start.setHours(0, 0, 0, 0);
    return start.toISOString();
  }
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export default function DriverEarningsScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>('earnings');
  const [driverId, setDriverId] = useState<string | null>(null);

  // Earnings state
  const [filter, setFilter] = useState<Filter>('today');
  const [rides, setRides] = useState<EarningsRide[]>([]);
  const [stats, setStats] = useState<Stats>({ totalEarned: 0, commissionOwed: 0, netEarnings: 0, rideCount: 0 });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Daily Reports state
  const [reportLoading, setReportLoading] = useState(true);
  const [todayRides, setTodayRides] = useState<any[]>([]);
  const [cashRides, setCashRides] = useState(0);
  const [cashCollected, setCashCollected] = useState(0);
  const [goCashRides, setGoCashRides] = useState(0);
  const [goCashEarned, setGoCashEarned] = useState(0);
  const [reportCommission, setReportCommission] = useState(0);
  const [notes, setNotes] = useState('');
  const [previousReports, setPreviousReports] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // Fetch driver ID once on mount
  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: d } = await supabase.from('drivers').select('id').eq('profile_id', user.id).single();
      if (d) setDriverId(d.id);
    })();
  }, []);

  // Fetch earnings when driverId or filter changes
  const fetchEarnings = useCallback(async () => {
    if (!driverId) return;
    try {
      const { data } = await supabase
        .from('rides')
        .select('id, pickup_location, dropoff_location, final_fare, completed_at, rider:rider_id(full_name)')
        .eq('driver_id', driverId)
        .eq('status', 'completed')
        .gte('completed_at', getDateRange(filter))
        .order('completed_at', { ascending: false });

      const mapped: EarningsRide[] = (data ?? []).map((r: any) => ({
        id: r.id,
        pickup_location: r.pickup_location ?? 'Unknown pickup',
        dropoff_location: r.dropoff_location ?? 'Unknown dropoff',
        final_fare: r.final_fare ?? 0,
        completed_at: r.completed_at,
        riderName: r.rider?.full_name ?? 'Passenger',
      }));

      const totalEarned = mapped.reduce((s, r) => s + r.final_fare, 0);
      const commOwed = totalEarned * COMMISSION_RATE;
      setRides(mapped);
      setStats({ totalEarned, commissionOwed: commOwed, netEarnings: totalEarned - commOwed, rideCount: mapped.length });
    } catch (err) {
      console.error('Earnings fetch error:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [driverId, filter]);

  useEffect(() => {
    if (driverId) { setLoading(true); fetchEarnings(); }
  }, [fetchEarnings, driverId]);

  // Fetch report data when driverId changes
  const fetchReportData = useCallback(async () => {
    if (!driverId) return;
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data: rideData } = await supabase
        .from('rides').select('*').eq('driver_id', driverId)
        .eq('status', 'completed').gte('completed_at', today.toISOString());

      if (rideData) {
        setTodayRides(rideData);
        const cash = rideData.filter((r: any) => r.payment_method === 'cash');
        const goCash = rideData.filter((r: any) => r.payment_method === 'momo' || r.payment_method === 'go_cash');
        const cashTotal = cash.reduce((sum: number, r: any) => sum + (r.fare_ghs || 0), 0);
        const goCashTotal = goCash.reduce((sum: number, r: any) => sum + (r.fare_ghs || 0), 0);
        setCashRides(cash.length);
        setCashCollected(cashTotal);
        setGoCashRides(goCash.length);
        setGoCashEarned(goCashTotal);
        setReportCommission((cashTotal + goCashTotal) * COMMISSION_PCT / 100);
      }

      const { data: reports } = await supabase
        .from('driver_daily_reports').select('*').eq('driver_id', driverId)
        .order('report_date', { ascending: false }).limit(7);
      if (reports) setPreviousReports(reports);
    } catch (error) {
      console.error('Report fetch error:', error);
    } finally {
      setReportLoading(false);
    }
  }, [driverId]);

  useEffect(() => {
    if (driverId) fetchReportData();
  }, [fetchReportData, driverId]);

  const submitDailyReport = async () => {
    if (!driverId) return;
    setSubmitting(true);
    try {
      const today = new Date().toISOString().split('T')[0];
      const { error } = await supabase.from('driver_daily_reports').upsert({
        driver_id: driverId,
        report_date: today,
        total_cash_rides: cashRides,
        total_cash_collected: cashCollected,
        total_go_cash_rides: goCashRides,
        total_go_cash_earned: goCashEarned,
        commission_owed: reportCommission,
        notes,
      }, { onConflict: 'driver_id,report_date' });
      if (error) throw error;
      Alert.alert('Report Submitted', "Today's daily report has been saved.");
      fetchReportData();
    } catch (error) {
      console.error('Submit error:', error);
      Alert.alert('Error', 'Failed to submit report. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const onRefresh = () => { setRefreshing(true); fetchEarnings(); };

  const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });

  const filterLabels: { key: Filter; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This Week' },
    { key: 'month', label: 'This Month' },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Earnings</Text>
        <View style={styles.headerBtn} />
      </View>

      {/* Top Tab Switcher */}
      <View style={styles.tabBar}>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'earnings' && styles.tabItemActive]}
          onPress={() => setActiveTab('earnings')}
        >
          <Text style={[styles.tabText, activeTab === 'earnings' && styles.tabTextActive]}>Earnings</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tabItem, activeTab === 'reports' && styles.tabItemActive]}
          onPress={() => setActiveTab('reports')}
        >
          <Text style={[styles.tabText, activeTab === 'reports' && styles.tabTextActive]}>Daily Reports</Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'earnings' ? (
        <>
          {/* Period Filter */}
          <View style={styles.filterRow}>
            {filterLabels.map(({ key, label }) => (
              <TouchableOpacity
                key={key}
                style={[styles.filterTab, filter === key && styles.filterTabActive]}
                onPress={() => setFilter(key)}
              >
                <Text style={[styles.filterTabText, filter === key && styles.filterTabTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={theme.green} />
            </View>
          ) : (
            <FlatList
              data={rides}
              keyExtractor={(item) => item.id}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.green} />}
              showsVerticalScrollIndicator={false}
              ListHeaderComponent={
                <View style={styles.statsContainer}>
                  <View style={styles.statsRow}>
                    <View style={[styles.statCard, { borderTopColor: theme.green }]}>
                      <Text style={[styles.statAmount, { color: theme.green }]}>GH₵{stats.totalEarned.toFixed(2)}</Text>
                      <Text style={styles.statName}>Total Earned</Text>
                      <Text style={styles.statSub}>{stats.rideCount} rides</Text>
                    </View>
                    <View style={[styles.statCard, { borderTopColor: theme.red }]}>
                      <Text style={[styles.statAmount, { color: theme.red }]}>GH₵{stats.commissionOwed.toFixed(2)}</Text>
                      <Text style={styles.statName}>Commission (15%)</Text>
                      <Text style={styles.statSub}>Owed to PragyaGo</Text>
                    </View>
                  </View>
                  <View style={[styles.netCard, { borderColor: theme.blue + '40' }]}>
                    <View>
                      <Text style={styles.netLabel}>Net Earnings</Text>
                      <Text style={styles.netSub}>After 15% commission</Text>
                    </View>
                    <Text style={[styles.netAmount, { color: theme.blue }]}>GH₵{stats.netEarnings.toFixed(2)}</Text>
                  </View>
                  {rides.length > 0 && (
                    <Text style={styles.listHeader}>Completed Rides</Text>
                  )}
                </View>
              }
              renderItem={({ item }) => (
                <View style={styles.rideCard}>
                  <View style={styles.rideTop}>
                    <View style={styles.riderRow}>
                      <View style={[styles.riderAvatar, { backgroundColor: theme.blueLight }]}>
                        <Feather name="user" size={14} color={theme.blue} />
                      </View>
                      <Text style={styles.riderName}>{item.riderName}</Text>
                    </View>
                    <View style={styles.timeBox}>
                      <Text style={styles.rideDate}>{formatDate(item.completed_at)}</Text>
                      <Text style={styles.rideTime}>{formatTime(item.completed_at)}</Text>
                    </View>
                  </View>
                  <View style={styles.routeBox}>
                    <View style={styles.routeRow}>
                      <Feather name="map-pin" size={13} color={theme.green} />
                      <Text style={styles.routeText} numberOfLines={1}>{item.pickup_location}</Text>
                    </View>
                    <View style={[styles.routeLine, { backgroundColor: theme.border }]} />
                    <View style={styles.routeRow}>
                      <Feather name="flag" size={13} color={theme.red} />
                      <Text style={styles.routeText} numberOfLines={1}>{item.dropoff_location}</Text>
                    </View>
                  </View>
                  <View style={styles.fareRow}>
                    <View style={styles.fareBreakdown}>
                      <Text style={styles.fareLabel}>Fare</Text>
                      <Text style={styles.fareValue}>GH₵{item.final_fare.toFixed(2)}</Text>
                    </View>
                    <Feather name="minus" size={12} color={theme.textMuted} />
                    <View style={styles.fareBreakdown}>
                      <Text style={styles.fareLabel}>Commission</Text>
                      <Text style={[styles.fareValue, { color: theme.red }]}>
                        GH₵{(item.final_fare * COMMISSION_RATE).toFixed(2)}
                      </Text>
                    </View>
                    <Feather name="arrow-right" size={12} color={theme.textMuted} />
                    <View style={styles.fareBreakdown}>
                      <Text style={styles.fareLabel}>Net</Text>
                      <Text style={[styles.fareValue, { color: theme.green }]}>
                        GH₵{(item.final_fare * (1 - COMMISSION_RATE)).toFixed(2)}
                      </Text>
                    </View>
                  </View>
                </View>
              )}
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Feather name="trending-up" size={52} color={theme.textMuted} />
                  <Text style={styles.emptyTitle}>No rides yet</Text>
                  <Text style={styles.emptyText}>
                    Completed rides for{' '}
                    {filter === 'today' ? 'today' : filter === 'week' ? 'this week' : 'this month'}{' '}
                    will appear here.
                  </Text>
                </View>
              }
              contentContainerStyle={styles.listContent}
            />
          )}
        </>
      ) : reportLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.green} />
        </View>
      ) : (
        <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
          <View style={styles.reportDateRow}>
            <Text style={styles.reportDateLabel}>{new Date().toDateString()}</Text>
          </View>

          {/* Today's Summary */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Today's Summary</Text>
            <View style={styles.summaryGrid}>
              <View style={[styles.summaryCard, { backgroundColor: theme.blueLight }]}>
                <Text style={styles.summaryValue}>{cashRides}</Text>
                <Text style={styles.summaryLabel}>Cash Rides</Text>
                <Text style={styles.summaryAmount}>GHS {cashCollected.toFixed(2)}</Text>
              </View>
              <View style={[styles.summaryCard, { backgroundColor: theme.greenLight }]}>
                <Text style={styles.summaryValue}>{goCashRides}</Text>
                <Text style={styles.summaryLabel}>Go Cash Rides</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                  <Text style={[styles.summaryAmount, { color: theme.green }]}>GHS {goCashEarned.toFixed(2)}</Text>
                  <Feather name="lock" size={12} color={theme.green} />
                </View>
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
              <Text style={styles.commissionLabel}>Commission Owed ({COMMISSION_PCT}%)</Text>
              <Text style={styles.commissionValue}>GHS {reportCommission.toFixed(2)}</Text>
            </View>
          </View>

          {/* Go Cash Info */}
          <View style={[styles.section, { backgroundColor: theme.greenLight, borderColor: theme.green + '30' }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 }}>
              <Feather name="lock" size={14} color={theme.green} />
              <Text style={styles.goCashTitle}>Go Cash Earnings</Text>
            </View>
            <Text style={styles.goCashText}>
              GHS {goCashEarned.toFixed(2)} from Go Cash rides is held by PragyaGo.
              You will receive your share (GHS {(goCashEarned * (100 - COMMISSION_PCT) / 100).toFixed(2)}) after commission is settled.
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
              placeholderTextColor={theme.placeholder}
            />
          </View>

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, submitting && { opacity: 0.7 }]}
            onPress={submitDailyReport}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Feather name="check-circle" size={16} color="#fff" />
                <Text style={styles.submitBtnText}>Submit Daily Report</Text>
              </>
            )}
          </TouchableOpacity>

          {/* Previous Reports */}
          {previousReports.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Previous Reports</Text>
              {previousReports.map((report) => (
                <View key={report.id} style={styles.reportRow}>
                  <View>
                    <Text style={styles.reportDate}>{report.report_date}</Text>
                    <Text style={styles.reportRides}>{report.total_cash_rides + report.total_go_cash_rides} rides</Text>
                  </View>
                  <View style={styles.reportRight}>
                    <Text style={styles.reportEarnings}>
                      GHS {(report.total_cash_collected + report.total_go_cash_earned).toFixed(2)}
                    </Text>
                    <View style={[styles.commissionBadge, report.commission_paid ? styles.paidBadge : styles.unpaidBadge]}>
                      <Text style={[styles.commissionBadgeText, { color: report.commission_paid ? theme.green : theme.red }]}>
                        {report.commission_paid ? 'Paid' : `GHS ${report.commission_owed?.toFixed(2)} owed`}
                      </Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          <View style={{ height: 32 }} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.background },
    container: { flex: 1, backgroundColor: theme.background },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

    // Header
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 8, paddingTop: 16, paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
    },
    headerBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 22, fontWeight: '700', color: theme.text },

    // Tab switcher
    tabBar: {
      flexDirection: 'row',
      backgroundColor: theme.background,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.border,
    },
    tabItem: {
      flex: 1, height: 44,
      justifyContent: 'center', alignItems: 'center',
      borderBottomWidth: 2, borderBottomColor: 'transparent',
    },
    tabItemActive: { borderBottomColor: '#1D9E75' },
    tabText: { fontSize: 14, fontWeight: '500', color: theme.textSecondary },
    tabTextActive: { color: '#1D9E75', fontWeight: '700' },

    // Period filter (earnings tab)
    filterRow: {
      flexDirection: 'row', gap: 8,
      paddingHorizontal: 16, paddingVertical: 12,
      backgroundColor: theme.background,
    },
    filterTab: {
      flex: 1, paddingVertical: 8, borderRadius: 20,
      backgroundColor: theme.input, alignItems: 'center',
      borderWidth: 1, borderColor: theme.inputBorder,
    },
    filterTabActive: { backgroundColor: theme.green, borderColor: theme.green },
    filterTabText: { fontSize: 13, fontWeight: '500', color: theme.textSecondary },
    filterTabTextActive: { color: '#fff', fontWeight: '600' },

    // Earnings stats
    listContent: { paddingBottom: 32 },
    statsContainer: { paddingHorizontal: 16 },
    statsRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
    statCard: {
      flex: 1, backgroundColor: theme.card, borderRadius: 14,
      padding: 14, borderTopWidth: 3,
      borderWidth: 1, borderColor: theme.cardBorder,
      shadowColor: theme.shadow, shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 1, shadowRadius: 4, elevation: 1,
    },
    statAmount: { fontSize: 20, fontWeight: '700', marginBottom: 2 },
    statName: { fontSize: 12, color: theme.textSecondary, fontWeight: '500' },
    statSub: { fontSize: 11, color: theme.textMuted, marginTop: 2 },
    netCard: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      backgroundColor: theme.card, borderRadius: 14, padding: 16, marginBottom: 16,
      borderWidth: 1, borderColor: theme.cardBorder,
    },
    netLabel: { fontSize: 16, fontWeight: '600', color: theme.text },
    netSub: { fontSize: 12, color: theme.textSecondary, marginTop: 2 },
    netAmount: { fontSize: 24, fontWeight: '700' },
    listHeader: {
      fontSize: 11, fontWeight: '700', color: theme.textSecondary,
      textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 8,
    },
    rideCard: {
      backgroundColor: theme.card, borderRadius: 14, marginHorizontal: 16, marginBottom: 10,
      padding: 14, borderWidth: 1, borderColor: theme.cardBorder,
    },
    rideTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
    riderRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    riderAvatar: { width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center' },
    riderName: { fontSize: 14, fontWeight: '600', color: theme.text },
    timeBox: { alignItems: 'flex-end' },
    rideDate: { fontSize: 12, color: theme.textSecondary },
    rideTime: { fontSize: 12, color: theme.textMuted, marginTop: 1 },
    routeBox: { backgroundColor: theme.background2, borderRadius: 10, padding: 10, marginBottom: 10 },
    routeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    routeLine: { width: 1, height: 12, marginLeft: 6, marginVertical: 2 },
    routeText: { flex: 1, fontSize: 13, color: theme.text },
    fareRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.border,
    },
    fareBreakdown: { alignItems: 'center' },
    fareLabel: { fontSize: 10, color: theme.textMuted, marginBottom: 2 },
    fareValue: { fontSize: 13, fontWeight: '600', color: theme.text },
    emptyState: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 32, gap: 12 },
    emptyTitle: { fontSize: 18, fontWeight: '600', color: theme.text },
    emptyText: { fontSize: 14, color: theme.textSecondary, textAlign: 'center', lineHeight: 22 },

    // Daily Reports
    reportDateRow: { paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 },
    reportDateLabel: { fontSize: 13, fontWeight: '600', color: theme.textSecondary },
    section: {
      backgroundColor: theme.card, marginHorizontal: 16, marginBottom: 12,
      borderRadius: 12, padding: 16, borderWidth: 1, borderColor: theme.cardBorder,
    },
    sectionTitle: { fontSize: 16, fontWeight: '600', color: theme.text, marginBottom: 12 },
    summaryGrid: { flexDirection: 'row', gap: 10, marginBottom: 16 },
    summaryCard: { flex: 1, borderRadius: 10, padding: 12, alignItems: 'center' },
    summaryValue: { fontSize: 28, fontWeight: 'bold', color: theme.text },
    summaryLabel: { fontSize: 12, color: theme.textSecondary, marginVertical: 4 },
    summaryAmount: { fontSize: 14, fontWeight: '600', color: theme.blue },
    totalRow: {
      flexDirection: 'row', justifyContent: 'space-between',
      paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
    },
    totalLabel: { fontSize: 14, color: theme.textSecondary },
    totalValue: { fontSize: 14, fontWeight: '600', color: theme.text },
    commissionRow: { borderBottomWidth: 0, marginTop: 4 },
    commissionLabel: { fontSize: 15, fontWeight: '600', color: theme.red },
    commissionValue: { fontSize: 15, fontWeight: 'bold', color: theme.red },
    goCashTitle: { fontSize: 15, fontWeight: '600', color: theme.green },
    goCashText: { fontSize: 13, color: theme.green, lineHeight: 20 },
    notesInput: {
      borderWidth: 1, borderColor: theme.inputBorder, borderRadius: 8,
      padding: 12, fontSize: 14, color: theme.text,
      backgroundColor: theme.input, textAlignVertical: 'top',
    },
    submitBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: theme.green, borderRadius: 12,
      marginHorizontal: 16, marginBottom: 12, paddingVertical: 14,
    },
    submitBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
    reportRow: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
    },
    reportDate: { fontSize: 14, fontWeight: '600', color: theme.text },
    reportRides: { fontSize: 12, color: theme.textMuted, marginTop: 2 },
    reportRight: { alignItems: 'flex-end' },
    reportEarnings: { fontSize: 14, fontWeight: '600', color: theme.text, marginBottom: 4 },
    commissionBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
    paidBadge: { backgroundColor: theme.greenLight },
    unpaidBadge: { backgroundColor: theme.redLight },
    commissionBadgeText: { fontSize: 11, fontWeight: '600' },
  });
}
