import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const COMMISSION_RATE = 0.15;

type DateMode = 'today' | 'yesterday' | 'week' | 'custom';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function getRange(mode: DateMode, customDate: Date): { start: Date; end: Date; label: string } {
  const now = new Date();
  if (mode === 'today') {
    return { start: startOfDay(now), end: endOfDay(now), label: now.toDateString() };
  }
  if (mode === 'yesterday') {
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    return { start: startOfDay(y), end: endOfDay(y), label: y.toDateString() };
  }
  if (mode === 'week') {
    const start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    return { start: startOfDay(start), end: endOfDay(now), label: `${start.toDateString()} – ${now.toDateString()}` };
  }
  return { start: startOfDay(customDate), end: endOfDay(customDate), label: customDate.toDateString() };
}

export default function DriverDailyReportsScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();

  const [driverId, setDriverId] = useState<string | null>(null);
  const [dateMode, setDateMode] = useState<DateMode>('today');
  const [customDate, setCustomDate] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [rides, setRides] = useState<any[]>([]);
  const [walletTxns, setWalletTxns] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: driver } = await supabase.from('drivers').select('id').eq('profile_id', user.id).single();
      if (driver) setDriverId(driver.id);
    })();
  }, []);

  const { start, end, label } = getRange(dateMode, customDate);

  const fetchReportData = useCallback(async () => {
    if (!driverId) return;
    setLoading(true);
    try {
      const startIso = start.toISOString();
      const endIso = end.toISOString();

      const { data: rideData } = await supabase
        .from('rides')
        .select('*')
        .eq('driver_id', driverId)
        .in('status', ['completed', 'cancelled'])
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .order('created_at', { ascending: false });

      const { data: txnData } = await supabase
        .from('driver_wallet_transactions')
        .select('*')
        .eq('driver_id', driverId)
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .order('created_at', { ascending: false });

      setRides(rideData ?? []);
      setWalletTxns(txnData ?? []);
    } catch (e) {
      console.log('Daily report fetch error:', e);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [driverId, dateMode, customDate]);

  useEffect(() => {
    fetchReportData();
  }, [fetchReportData]);

  const completedRides = rides.filter((r) => r.status === 'completed');
  const totalTrips = completedRides.length;
  const totalEarned = completedRides.reduce((sum, r) => sum + parseFloat(r.final_fare_ghs || r.fare_ghs || 0), 0);
  const totalCommission = totalEarned * COMMISSION_RATE;
  const netIncome = totalEarned - totalCommission;

  const formatTime = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const txnLabel = (type: string) => {
    if (type === 'topup') return 'Top Up';
    if (type === 'commission_deduction') return 'Commission Deduction';
    if (type === 'withdrawal') return 'Withdrawal';
    return type;
  };
  const txnColor = (type: string) => {
    if (type === 'topup') return theme.green;
    if (type === 'commission_deduction') return theme.red;
    if (type === 'withdrawal') return theme.blue;
    return theme.text;
  };
  const txnSign = (type: string) => (type === 'commission_deduction' || type === 'withdrawal' ? '-' : '+');

  const dateOptions: { key: DateMode; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'week', label: 'This Week' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Daily Reports</Text>
        <View style={styles.headerBtn} />
      </View>

      <View style={styles.dateRow}>
        {dateOptions.map((opt) => (
          <TouchableOpacity
            key={opt.key}
            style={[styles.dateTab, dateMode === opt.key && styles.dateTabActive]}
            onPress={() => setDateMode(opt.key)}
          >
            <Text style={[styles.dateTabText, dateMode === opt.key && styles.dateTabTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.selectedDateRow}>
        {dateMode === 'custom' ? (
          <TouchableOpacity
            onPress={() => {
              const d = new Date(customDate);
              d.setDate(d.getDate() - 1);
              setCustomDate(d);
            }}
          >
            <Feather name="chevron-left" size={20} color={theme.text} />
          </TouchableOpacity>
        ) : null}
        <Text style={styles.selectedDateText}>{label}</Text>
        {dateMode === 'custom' ? (
          <TouchableOpacity
            onPress={() => {
              const d = new Date(customDate);
              d.setDate(d.getDate() + 1);
              setCustomDate(d);
            }}
          >
            <Feather name="chevron-right" size={20} color={theme.text} />
          </TouchableOpacity>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.green} />
        </View>
      ) : (
        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={styles.summaryGrid}>
            <View style={[styles.summaryCard, { borderTopColor: theme.green }]}>
              <Feather name="map" size={18} color={theme.green} />
              <Text style={[styles.summaryValue, { color: theme.green }]}>{totalTrips}</Text>
              <Text style={styles.summaryLabel}>Total Trips</Text>
            </View>
            <View style={[styles.summaryCard, { borderTopColor: theme.green }]}>
              <Feather name="dollar-sign" size={18} color={theme.green} />
              <Text style={[styles.summaryValue, { color: theme.green }]}>GH₵ {totalEarned.toFixed(2)}</Text>
              <Text style={styles.summaryLabel}>Total Earned</Text>
            </View>
            <View style={[styles.summaryCard, { borderTopColor: theme.red }]}>
              <Feather name="percent" size={18} color={theme.red} />
              <Text style={[styles.summaryValue, { color: theme.red }]}>GH₵ {totalCommission.toFixed(2)}</Text>
              <Text style={styles.summaryLabel}>Commission</Text>
            </View>
            <View style={[styles.summaryCard, { borderTopColor: theme.blue }]}>
              <Feather name="trending-up" size={18} color={theme.blue} />
              <Text style={[styles.summaryValue, { color: theme.blue }]}>GH₵ {netIncome.toFixed(2)}</Text>
              <Text style={styles.summaryLabel}>Net Income</Text>
            </View>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Daily Breakdown</Text>
            <FlatList
              data={rides}
              keyExtractor={(item) => item.id}
              scrollEnabled={false}
              ItemSeparatorComponent={() => <View style={styles.rideSeparator} />}
              renderItem={({ item }) => {
                const isCompleted = item.status === 'completed';
                const fare = parseFloat(item.final_fare_ghs || item.fare_ghs || 0);
                const commission = isCompleted ? fare * COMMISSION_RATE : 0;
                const net = fare - commission;
                return (
                  <View style={styles.rideRow}>
                    <View style={styles.rideRowTop}>
                      <Text style={styles.rideTime}>{formatTime(item.created_at)}</Text>
                      <View style={[styles.statusBadge, { backgroundColor: isCompleted ? theme.greenLight : theme.redLight }]}>
                        <Text style={[styles.statusBadgeText, { color: isCompleted ? theme.green : theme.red }]}>
                          {isCompleted ? 'Completed' : 'Cancelled'}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.rideRoute} numberOfLines={1}>
                      {(item.pickup_address || 'Pickup')} → {(item.dropoff_address || 'Dropoff')}
                    </Text>
                    {isCompleted ? (
                      <View style={styles.rideFareRow}>
                        <Text style={styles.rideFareText}>Fare: GH₵ {fare.toFixed(2)}</Text>
                        <Text style={[styles.rideFareText, { color: theme.red }]}>Commission: -GH₵ {commission.toFixed(2)}</Text>
                        <Text style={[styles.rideFareText, { color: theme.green }]}>Net: GH₵ {net.toFixed(2)}</Text>
                      </View>
                    ) : null}
                  </View>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.emptyText}>No rides for this period.</Text>
              }
            />
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Wallet Transactions</Text>
            {walletTxns.length === 0 ? (
              <Text style={styles.emptyText}>No wallet activity for this period.</Text>
            ) : (
              walletTxns.map((txn) => (
                <View key={txn.id} style={styles.txnRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.txnType}>{txn.description || txnLabel(txn.type)}</Text>
                    <Text style={styles.txnTime}>{formatTime(txn.created_at)}</Text>
                  </View>
                  <Text style={[styles.txnAmount, { color: txnColor(txn.type) }]}>
                    {txnSign(txn.type)}GH₵ {(txn.amount || 0).toFixed(2)}
                  </Text>
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.background },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },

    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: 8, paddingTop: 16, paddingBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
    },
    headerBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 20, fontWeight: '700', color: theme.text },

    dateRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 12 },
    dateTab: {
      flex: 1, paddingVertical: 8, borderRadius: 20,
      backgroundColor: theme.input, alignItems: 'center',
      borderWidth: 1, borderColor: theme.inputBorder,
    },
    dateTabActive: { backgroundColor: theme.green, borderColor: theme.green },
    dateTabText: { fontSize: 12, fontWeight: '500', color: theme.textSecondary },
    dateTabTextActive: { color: '#fff', fontWeight: '600' },

    selectedDateRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12,
      paddingVertical: 12,
    },
    selectedDateText: { fontSize: 13, fontWeight: '600', color: theme.textSecondary },

    summaryGrid: {
      flexDirection: 'row', flexWrap: 'wrap', gap: 12,
      paddingHorizontal: 16, marginBottom: 4,
    },
    summaryCard: {
      width: '47%', backgroundColor: theme.card, borderRadius: 14,
      padding: 14, borderTopWidth: 3, gap: 4,
      borderWidth: 1, borderColor: theme.cardBorder,
    },
    summaryValue: { fontSize: 18, fontWeight: '700', marginTop: 2 },
    summaryLabel: { fontSize: 12, color: theme.textSecondary, fontWeight: '500' },

    section: {
      backgroundColor: theme.card, marginHorizontal: 16, marginTop: 16,
      borderRadius: 14, padding: 16, borderWidth: 1, borderColor: theme.cardBorder,
    },
    sectionTitle: { fontSize: 16, fontWeight: '600', color: theme.text, marginBottom: 12 },

    rideSeparator: { height: StyleSheet.hairlineWidth, backgroundColor: theme.border, marginVertical: 10 },
    rideRow: {},
    rideRowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    rideTime: { fontSize: 12, color: theme.textSecondary, fontWeight: '600' },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20 },
    statusBadgeText: { fontSize: 11, fontWeight: '600' },
    rideRoute: { fontSize: 14, color: theme.text, marginBottom: 6 },
    rideFareRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
    rideFareText: { fontSize: 12, color: theme.textSecondary },

    txnRow: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.border,
    },
    txnType: { fontSize: 14, fontWeight: '600', color: theme.text },
    txnTime: { fontSize: 12, color: theme.textMuted, marginTop: 2 },
    txnAmount: { fontSize: 14, fontWeight: '700' },

    emptyText: { fontSize: 13, color: theme.textMuted, textAlign: 'center', paddingVertical: 8 },
  });
}
