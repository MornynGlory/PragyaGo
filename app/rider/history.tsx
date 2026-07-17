import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { Feather } from '@expo/vector-icons'
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const formatDate = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' })
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

export default function RiderHistoryScreen() {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const [rides, setRides] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchRides() }, [])

  const fetchRides = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data } = await supabase
        .from('rides')
        .select('*, driver:profiles!rides_driver_id_fkey(full_name)')
        .eq('rider_id', user.id)
        .order('created_at', { ascending: false })
      setRides(data ?? [])
    } catch (e) {
      console.error('fetchRides error:', e)
    } finally {
      setLoading(false)
    }
  }

  const renderRide = ({ item }: { item: any }) => {
    const driverName = item.driver?.full_name ?? 'Unknown Driver'
    const isCompleted = item.status === 'completed'
    const isCancelled = item.status === 'cancelled'
    const fare = item.discounted_fare ?? item.final_fare_ghs ?? item.fare_ghs ?? 0

    return (
      <View style={styles.rideCard}>
        {/* Left avatar */}
        <View style={styles.rideAvatar}>
          <Text style={styles.rideAvatarEmoji}>🛺</Text>
        </View>

        {/* Middle */}
        <View style={styles.rideMiddle}>
          <View style={styles.rideTopRow}>
            <Text style={styles.driverName} numberOfLines={1}>{driverName}</Text>
            <Text style={styles.rideDate}>{formatDate(item.created_at)}</Text>
          </View>
          <Text style={styles.rideRoute} numberOfLines={1}>
            {item.pickup_address ?? 'Pickup'} → {item.dropoff_address ?? 'Dropoff'}
          </Text>
        </View>

        {/* Right */}
        <View style={styles.rideRight}>
          <Text style={styles.rideFare}>GHS {Number(fare).toFixed(2)}</Text>
          {isCompleted && (
            <View style={[styles.statusBadge, styles.statusBadgeGreen]}>
              <Text style={[styles.statusText, { color: theme.green }]}>Completed</Text>
            </View>
          )}
          {isCancelled && (
            <View style={[styles.statusBadge, styles.statusBadgeRed]}>
              <Text style={[styles.statusText, { color: theme.red }]}>Cancelled</Text>
            </View>
          )}
          {!isCompleted && !isCancelled && (
            <View style={[styles.statusBadge, { backgroundColor: theme.background2 }]}>
              <Text style={[styles.statusText, { color: theme.textMuted }]}>{item.status}</Text>
            </View>
          )}
        </View>
      </View>
    )
  }

  const EmptyState = () => (
    <View style={styles.emptyState}>
      <Feather name="clock" size={48} color={theme.textMuted} />
      <Text style={styles.emptyTitle}>No rides yet</Text>
      <Text style={styles.emptySubtitle}>Your completed rides will appear here</Text>
    </View>
  )

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Ride History</Text>
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
          ListEmptyComponent={EmptyState}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={rides.length === 0 ? styles.emptyContainer : undefined}
        />
      )}
    </SafeAreaView>
  )
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    header: { paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: c.border, backgroundColor: c.background },
    headerTitle: { fontSize: 18, fontWeight: '700', color: c.text },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    rideCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: c.border, backgroundColor: c.card },
    rideAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.green, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    rideAvatarEmoji: { fontSize: 22 },
    rideMiddle: { flex: 1, marginRight: 12 },
    rideTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    driverName: { fontSize: 15, fontWeight: '600', color: c.text, flex: 1, marginRight: 8 },
    rideDate: { fontSize: 12, color: c.textMuted },
    rideRoute: { fontSize: 13, color: c.textSecondary },
    rideRight: { alignItems: 'flex-end', gap: 4 },
    rideFare: { fontSize: 14, fontWeight: '700', color: c.green },
    statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
    statusBadgeGreen: { backgroundColor: c.greenLight },
    statusBadgeRed: { backgroundColor: c.redLight },
    statusText: { fontSize: 11, fontWeight: '600' },
    emptyContainer: { flexGrow: 1 },
    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12, paddingHorizontal: 32 },
    emptyTitle: { fontSize: 18, fontWeight: '600', color: c.textMuted, marginTop: 8 },
    emptySubtitle: { fontSize: 14, color: c.textMuted, textAlign: 'center' },
  })
}
