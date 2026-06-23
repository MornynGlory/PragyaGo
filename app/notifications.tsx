import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const TYPE_ICON: Record<string, string> = {
  announcement: '📢',
  alert: '⚠️',
  maintenance: '🔧',
  promotion: '🎁',
};

export default function NotificationsScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [loading, setLoading] = useState(true);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [markingAll, setMarkingAll] = useState(false);

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('user_notifications')
        .select('*, broadcasts(title, message, type, sent_at)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (data) setNotifications(data);
    } catch (error) {
      console.error('Error fetching notifications:', error);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id: string) => {
    await supabase.from('user_notifications').update({ is_read: true }).eq('id', id);
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  };

  const markAllAsRead = async () => {
    if (unreadCount === 0) return;
    setMarkingAll(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase
        .from('user_notifications')
        .update({ is_read: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    } catch (error) {
      console.error('Error marking all as read:', error);
    } finally {
      setMarkingAll(false);
    }
  };

  const formatDate = (iso: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' · ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      {loading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1D9E75" />
        </View>
      ) : notifications.length === 0 ? (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyIcon}>🔔</Text>
          <Text style={styles.emptyText}>No notifications yet</Text>
        </View>
      ) : (
        <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
          {unreadCount > 0 && (
            <TouchableOpacity
              onPress={markAllAsRead}
              disabled={markingAll}
              style={styles.markAllRow}
            >
              {markingAll
                ? <ActivityIndicator size="small" color="#1D9E75" />
                : <Text style={styles.markAllText}>Mark all as read</Text>
              }
            </TouchableOpacity>
          )}
          {notifications.map((item) => {
            const broadcast = item.broadcasts;
            const type = broadcast?.type || 'announcement';
            return (
              <TouchableOpacity
                key={item.id}
                style={[styles.card, !item.is_read && styles.cardUnread]}
                onPress={() => !item.is_read && markAsRead(item.id)}
                activeOpacity={item.is_read ? 1 : 0.7}
              >
                {!item.is_read && <View style={styles.unreadDot} />}
                <Text style={styles.typeIcon}>{TYPE_ICON[type] ?? '📢'}</Text>
                <View style={styles.cardContent}>
                  <Text style={styles.cardTitle}>{broadcast?.title ?? 'Notification'}</Text>
                  <Text style={styles.cardMessage}>{broadcast?.message ?? ''}</Text>
                  <Text style={styles.cardDate}>{formatDate(broadcast?.sent_at ?? item.created_at)}</Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    markAllRow: { alignSelf: 'flex-end', paddingVertical: 6, paddingHorizontal: 4, marginBottom: 4 },
    markAllText: { color: '#1D9E75', fontSize: 13, fontWeight: '600' },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
    emptyIcon: { fontSize: 48 },
    emptyText: { fontSize: 16, color: c.subtext },
    list: { flex: 1 },
    listContent: { padding: 12, gap: 8 },
    card: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: c.card, borderRadius: 12, padding: 14, position: 'relative' },
    cardUnread: { backgroundColor: '#EBF5FF' },
    unreadDot: { position: 'absolute', top: 14, right: 14, width: 8, height: 8, borderRadius: 4, backgroundColor: '#2563eb' },
    typeIcon: { fontSize: 26, marginRight: 12, marginTop: 2 },
    cardContent: { flex: 1 },
    cardTitle: { fontSize: 15, fontWeight: '700', color: c.text, marginBottom: 4 },
    cardMessage: { fontSize: 13, color: c.subtext, lineHeight: 19, marginBottom: 6 },
    cardDate: { fontSize: 11, color: c.subtext },
  });
}
