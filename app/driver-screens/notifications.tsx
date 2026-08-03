import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

const formatTime = (dateStr: string) => {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (days === 1) return 'Yesterday'
  if (days < 7) return date.toLocaleDateString([], { weekday: 'short' })
  return date.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

type NotificationType = 'ride_update' | 'payment' | 'admin_alert' | string

function getIconConfig(type: NotificationType, theme: any) {
  if (type === 'ride_update') return { icon: 'map-pin', bg: theme.green }
  if (type === 'payment') return { icon: 'dollar-sign', bg: theme.blue }
  if (type === 'admin_alert') return { icon: 'alert-circle', bg: theme.amber }
  return { icon: 'bell', bg: theme.green }
}

export default function DriverNotificationsScreen() {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const router = useRouter()
  const [notifications, setNotifications] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)

  useEffect(() => { fetchNotifications() }, [])

  const fetchNotifications = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      setUserId(user.id)

      const { data } = await supabase
        .from('user_notifications')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      setNotifications(data ?? [])

      // Mark all as read after fetching
      await supabase
        .from('user_notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false)
    } catch (e) {
      console.error('fetchNotifications error:', e)
    } finally {
      setLoading(false)
    }
  }

  const markAllRead = async () => {
    if (!userId) return
    await supabase
      .from('user_notifications')
      .update({ is_read: true })
      .eq('user_id', userId)
      .eq('is_read', false)
    setNotifications(prev => prev.map(n => ({ ...n, is_read: true })))
  }

  const renderNotification = ({ item }: { item: any }) => {
    const { icon, bg } = getIconConfig(item.type, theme)
    const isUnread = !item.is_read

    return (
      <View style={[styles.notifCard, isUnread ? styles.notifCardUnread : styles.notifCardRead]}>
        <View style={[styles.iconCircle, { backgroundColor: bg }]}>
          <Feather name={icon as any} size={20} color="#fff" />
        </View>
        <View style={styles.notifMiddle}>
          <Text style={styles.notifTitle} numberOfLines={1}>{item.title ?? 'Notification'}</Text>
          <Text style={styles.notifMessage} numberOfLines={2}>{item.message ?? ''}</Text>
          <Text style={styles.notifTime}>{formatTime(item.created_at)}</Text>
        </View>
        {isUnread && <View style={styles.unreadDot} />}
      </View>
    )
  }

  const EmptyState = () => (
    <View style={styles.emptyState}>
      <Feather name="bell-off" size={48} color={theme.textMuted} />
      <Text style={styles.emptyText}>No notifications yet</Text>
    </View>
  )

  const hasUnread = notifications.some(n => !n.is_read)

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Notifications</Text>
        {hasUnread ? (
          <TouchableOpacity onPress={markAllRead} activeOpacity={0.7} style={styles.headerBtn}>
            <Text style={styles.markAllText}>Mark all</Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.headerBtn} />
        )}
      </View>

      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.green} />
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item.id}
          renderItem={renderNotification}
          ListEmptyComponent={EmptyState}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={notifications.length === 0 ? styles.emptyContainer : undefined}
        />
      )}
    </SafeAreaView>
  )
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: c.border, backgroundColor: c.background },
    headerBtn: { minWidth: 48, height: 40, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '700', color: c.text },
    markAllText: { fontSize: 13, color: c.green, fontWeight: '600' },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    notifCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 0.5, borderBottomColor: c.border },
    notifCardUnread: { backgroundColor: c.greenLight },
    notifCardRead: { backgroundColor: c.background },
    iconCircle: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
    notifMiddle: { flex: 1, marginRight: 8 },
    notifTitle: { fontSize: 14, fontWeight: '700', color: c.text, marginBottom: 3 },
    notifMessage: { fontSize: 13, color: c.textSecondary, lineHeight: 18 },
    notifTime: { fontSize: 11, color: c.textMuted, marginTop: 4 },
    unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.green },
    emptyContainer: { flexGrow: 1 },
    emptyState: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
    emptyText: { fontSize: 16, color: c.textMuted, fontWeight: '500' },
  })
}
