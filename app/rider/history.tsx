import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const STATUS_LABEL: Record<string, string> = {
  completed: 'Completed',
  cancelled: 'Cancelled',
  requested: 'Requested',
  accepted: 'Accepted',
  in_progress: 'In Progress',
  payment_pending: 'Payment Pending',
};

const STATUS_COLOR: Record<string, string> = {
  completed: '#1D9E75',
  cancelled: '#DC2626',
  in_progress: '#185FA5',
  payment_pending: '#B45309',
};

function formatDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return (
    d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    '  ·  ' +
    d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  );
}

export default function RiderHistoryScreen() {
  const theme = useTheme();
  const router = useRouter();
  const styles = makeStyles(theme);

  const [rides, setRides] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchRides = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('rides')
        .select('*, drivers(profiles(full_name), rating, photo_url)')
        .eq('rider_id', user.id)
        .order('created_at', { ascending: false })
        .limit(50);

      if (data) setRides(data);
    } catch (err) {
      console.error('Error fetching ride history:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchRides();
  }, [fetchRides]);

  const renderRide = ({ item }: { item: any }) => {
    const driverName = (item.drivers?.profiles as any)?.full_name ?? 'Driver';
    const statusColor = STATUS_COLOR[item.status] ?? theme.textSecondary;
    const fare = item.final_fare_ghs ?? item.discounted_fare ?? item.fare_ghs ?? 0;

    return (
      <View style={styles.card}>
        {/* Top row */}
        <View style={styles.cardTop}>
          <View style={styles.cardTopLeft}>
            <Text style={styles.tricycle}>🛺</Text>
            <Text style={styles.driverName} numberOfLines={1}>{driverName}</Text>
          </View>
          <Text style={styles.dateText}>{formatDate(item.created_at)}</Text>
        </View>

        {/* Route */}
        <View style={styles.routeRow}>
          <Feather name="map-pin" size={13} color={theme.green} style={styles.routeIcon} />
          <Text style={styles.routeText} numberOfLines={1}>{item.pickup_address || 'Pickup'}</Text>
        </View>
        <View style={[styles.routeRow, { marginBottom: 0 }]}>
          <Feather name="flag" size={13} color={theme.blue} style={styles.routeIcon} />
          <Text style={styles.routeText} numberOfLines={1}>{item.dropoff_address || 'Destination'}</Text>
        </View>

        {/* Bottom row */}
        <View style={styles.cardBottom}>
          <Text style={styles.fareText}>GHS {Number(fare).toFixed(2)}</Text>
          <View style={[styles.statusBadge, { backgroundColor: statusColor + '20' }]}>
            <Text style={[styles.statusText, { color: statusColor }]}>
              {STATUS_LABEL[item.status] ?? item.status}
            </Text>
          </View>
          {item.payment_method && (
            <View style={styles.paymentBadge}>
              <Text style={styles.paymentText}>
                {item.payment_method === 'cash' ? 'Cash' : 'Go Cash'}
              </Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  const EmptyState = () => (
    <View style={styles.emptyContainer}>
      <Feather name="map" size={56} color={theme.textMuted} />
      <Text style={styles.emptyTitle}>No rides yet</Text>
      <Text style={styles.emptySubtitle}>Your ride history will appear here</Text>
      <TouchableOpacity style={styles.emptyButton} onPress={() => router.push('/rider/home' as any)}>
        <Text style={styles.emptyButtonText}>Book your first ride</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>My Rides</Text>
        {rides.length > 0 && (
          <Text style={styles.headerCount}>{rides.length} ride{rides.length !== 1 ? 's' : ''}</Text>
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.green} />
        </View>
      ) : (
        <FlatList
          data={rides}
          keyExtractor={(item) => item.id}
          renderItem={renderRide}
          contentContainerStyle={[
            styles.listContent,
            rides.length === 0 && { flex: 1 },
          ]}
          ListEmptyComponent={EmptyState}
          refreshing={refreshing}
          onRefresh={() => fetchRides(true)}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 0.5,
      borderBottomColor: c.border,
      backgroundColor: c.background,
    },
    headerTitle: { fontSize: 20, fontWeight: 'bold', color: c.text },
    headerCount: { fontSize: 13, color: c.textSecondary },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    listContent: { padding: 16, gap: 12 },
    card: {
      backgroundColor: c.card,
      borderRadius: 16,
      padding: 16,
      borderWidth: 0.5,
      borderColor: c.cardBorder,
    },
    cardTop: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    cardTopLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
    tricycle: { fontSize: 18 },
    driverName: { fontSize: 14, fontWeight: '600', color: c.text, flex: 1 },
    dateText: { fontSize: 11, color: c.textMuted, flexShrink: 0, marginLeft: 8 },
    routeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 6,
    },
    routeIcon: { marginRight: 8, width: 16 },
    routeText: { fontSize: 13, color: c.textSecondary, flex: 1 },
    cardBottom: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 12,
      paddingTop: 10,
      borderTopWidth: 0.5,
      borderTopColor: c.border,
    },
    fareText: { fontSize: 16, fontWeight: 'bold', color: c.green, marginRight: 4 },
    statusBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 20,
    },
    statusText: { fontSize: 11, fontWeight: '600' },
    paymentBadge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 20,
      backgroundColor: c.input,
      marginLeft: 'auto',
    },
    paymentText: { fontSize: 11, color: c.textSecondary, fontWeight: '500' },
    emptyContainer: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingHorizontal: 32,
      gap: 12,
    },
    emptyTitle: { fontSize: 20, fontWeight: 'bold', color: c.text },
    emptySubtitle: { fontSize: 14, color: c.textSecondary, textAlign: 'center' },
    emptyButton: {
      marginTop: 8,
      backgroundColor: c.green,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 10,
    },
    emptyButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  });
}
