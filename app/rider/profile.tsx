import * as Sentry from '@sentry/react-native';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function RiderProfileScreen() {
  const theme = useTheme();
  const router = useRouter();
  const styles = makeStyles(theme);

  const [loading, setLoading] = useState(true);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [totalRides, setTotalRides] = useState(0);
  const [avgRating, setAvgRating] = useState<number | null>(null);
  const [goCashBalance, setGoCashBalance] = useState(0);
  const [isDriver, setIsDriver] = useState(false);

  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone, go_cash_balance, role')
        .eq('id', user.id)
        .single();

      if (profile) {
        setFullName(profile.full_name || '');
        setPhone(profile.phone || '');
        setGoCashBalance(profile.go_cash_balance ?? 0);
        if (profile.role === 'driver') setIsDriver(true);
      }

      const { count } = await supabase
        .from('rides')
        .select('*', { count: 'exact', head: true })
        .eq('rider_id', user.id)
        .eq('status', 'completed');
      setTotalRides(count ?? 0);

      const { data: ratings } = await supabase
        .from('ratings')
        .select('score')
        .eq('rated_user', user.id);
      if (ratings && ratings.length > 0) {
        const avg = ratings.reduce((s: number, r: { score: number }) => s + r.score, 0) / ratings.length;
        setAvgRating(Math.round(avg * 10) / 10);
      }
    } catch (err) {
      console.error('Error fetching rider profile:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    Alert.alert('Logout', 'Are you sure you want to logout?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Logout',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
          Sentry.setUser(null);
          router.replace('/');
        },
      },
    ]);
  };

  const initials = fullName
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase() || '?';

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.green} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials}</Text>
          </View>
          <Text style={styles.name}>{fullName || 'Rider'}</Text>
          {!!phone && <Text style={styles.phone}>{phone}</Text>}
        </View>

        {/* Stats */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{totalRides}</Text>
            <Text style={styles.statLabel}>Total Rides</Text>
          </View>
          <View style={[styles.statCard, styles.statCardBorder]}>
            <Text style={styles.statValue}>{avgRating != null ? avgRating.toFixed(1) : '—'}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>GHS {goCashBalance.toFixed(2)}</Text>
            <Text style={styles.statLabel}>Go Cash</Text>
          </View>
        </View>

        {/* Menu */}
        <View style={styles.menuSection}>
          <MenuItem
            icon="dollar-sign"
            iconBg={theme.greenLight}
            iconColor={theme.green}
            label="My Wallet"
            onPress={() => router.push('/rider/gocash')}
            theme={theme}
          />
          <MenuItem
            icon="clock"
            iconBg={theme.blueLight}
            iconColor={theme.blue}
            label="Ride History"
            onPress={() => router.push('/rider/history' as any)}
            theme={theme}
          />
          <MenuItem
            icon="headphones"
            iconBg="rgba(153,53,86,0.12)"
            iconColor="#993556"
            label="Support"
            onPress={() => router.push('/support' as any)}
            theme={theme}
          />
          <MenuItem
            icon="bell"
            iconBg={theme.amberLight}
            iconColor={theme.amber}
            label="Notifications"
            onPress={() => router.push('/rider/notifications' as any)}
            theme={theme}
          />
        </View>

        <View style={[styles.menuSection, { marginTop: 12 }]}>
          <MenuItem
            icon="shield"
            iconBg={theme.input}
            iconColor={theme.textSecondary}
            label="Privacy Policy"
            onPress={() => Linking.openURL('https://www.pragyago.com/privacy-policy')}
            theme={theme}
          />
          <MenuItem
            icon="file-text"
            iconBg={theme.input}
            iconColor={theme.textSecondary}
            label="Terms of Service"
            onPress={() => Linking.openURL('https://www.pragyago.com/terms')}
            theme={theme}
          />
        </View>

        {isDriver && (
          <View style={[styles.menuSection, { marginTop: 12 }]}>
            <MenuItem
              icon="truck"
              iconBg={theme.blueLight}
              iconColor={theme.blue}
              label="Switch to Driver Mode"
              onPress={() => router.replace('/driver/home' as any)}
              theme={theme}
            />
          </View>
        )}

        <View style={[styles.menuSection, { marginTop: 12, marginBottom: 32 }]}>
          <MenuItem
            icon="log-out"
            iconBg={theme.redLight}
            iconColor={theme.red}
            label="Logout"
            onPress={handleLogout}
            theme={theme}
            danger
          />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function MenuItem({
  icon,
  iconBg,
  iconColor,
  label,
  onPress,
  theme,
  danger,
}: {
  icon: string;
  iconBg: string;
  iconColor: string;
  label: string;
  onPress: () => void;
  theme: ReturnType<typeof useTheme>;
  danger?: boolean;
}) {
  return (
    <TouchableOpacity style={[menuStyles.row, { borderBottomColor: theme.border }]} onPress={onPress} activeOpacity={0.7}>
      <View style={[menuStyles.iconWrap, { backgroundColor: iconBg }]}>
        <Feather name={icon as any} size={18} color={iconColor} />
      </View>
      <Text style={[menuStyles.label, { color: danger ? theme.red : theme.text }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={theme.textMuted} />
    </TouchableOpacity>
  );
}

const menuStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: 0.5,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  label: { flex: 1, fontSize: 15, fontWeight: '500' },
});

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    scroll: { flex: 1 },
    loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    header: {
      alignItems: 'center',
      paddingTop: 28,
      paddingBottom: 24,
      paddingHorizontal: 24,
      backgroundColor: c.background,
    },
    avatar: {
      width: 80,
      height: 80,
      borderRadius: 40,
      backgroundColor: c.green,
      justifyContent: 'center',
      alignItems: 'center',
      marginBottom: 14,
    },
    avatarText: { fontSize: 28, fontWeight: 'bold', color: '#fff' },
    name: { fontSize: 22, fontWeight: 'bold', color: c.text, marginBottom: 4, textAlign: 'center' },
    phone: { fontSize: 14, color: c.textSecondary, textAlign: 'center' },
    statsRow: {
      flexDirection: 'row',
      marginHorizontal: 16,
      marginBottom: 20,
      backgroundColor: c.card,
      borderRadius: 16,
      borderWidth: 0.5,
      borderColor: c.cardBorder,
      overflow: 'hidden',
    },
    statCard: { flex: 1, alignItems: 'center', paddingVertical: 16 },
    statCardBorder: {
      borderLeftWidth: 0.5,
      borderRightWidth: 0.5,
      borderColor: c.cardBorder,
    },
    statValue: { fontSize: 16, fontWeight: 'bold', color: c.text, marginBottom: 4 },
    statLabel: { fontSize: 11, color: c.textSecondary },
    menuSection: {
      marginHorizontal: 16,
      backgroundColor: c.card,
      borderRadius: 16,
      borderWidth: 0.5,
      borderColor: c.cardBorder,
      overflow: 'hidden',
    },
  });
}
