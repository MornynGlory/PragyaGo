import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function DriverSettingsScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [totalRides, setTotalRides] = useState(0);

  useEffect(() => { fetchProfile(); }, []);

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('id', user.id)
        .single();
      if (profile) {
        setFullName(profile.full_name || '');
        setPhone(profile.phone || '');
      }
      const { data: driver } = await supabase
        .from('drivers')
        .select('photo_url, rating, total_rides')
        .eq('profile_id', user.id)
        .single();
      if (driver) {
        setPhotoUrl(driver.photo_url || null);
        setRating(driver.rating || 0);
        setTotalRides(driver.total_rides || 0);
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace('/' as any);
        },
      },
    ]);
  };

  const initials = fullName.split(' ').map(n => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Profile header */}
        <View style={styles.header}>
          {photoUrl ? (
            <Image source={{ uri: photoUrl }} style={styles.avatar} />
          ) : (
            <View style={styles.avatarPlaceholder}>
              <Text style={styles.initials}>{initials}</Text>
            </View>
          )}
          <Text style={styles.name}>{fullName || 'Driver'}</Text>
          {!!phone && <Text style={styles.phone}>{phone}</Text>}
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>★ {rating.toFixed(1)}</Text>
              <Text style={styles.statLabel}>Rating</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{totalRides}</Text>
              <Text style={styles.statLabel}>Rides</Text>
            </View>
          </View>
        </View>

        {/* Main menu */}
        <View style={styles.section}>
          <MenuItem icon="user" label="My Profile" onPress={() => router.push('/driver/edit-profile' as any)} styles={styles} theme={theme} />
          <MenuItem icon="dollar-sign" label="My Wallet" onPress={() => router.push('/driver/wallet' as any)} styles={styles} theme={theme} />
          <MenuItem icon="bar-chart-2" label="Daily Report" onPress={() => router.push('/driver/earnings' as any)} styles={styles} theme={theme} />
          <MenuItem icon="bell" label="Notifications" onPress={() => router.push('/notifications' as any)} styles={styles} theme={theme} />
          <MenuItem icon="headphones" label="Support" onPress={() => router.push('/support' as any)} styles={styles} theme={theme} last />
        </View>

        {/* Switch mode */}
        <View style={styles.section}>
          <MenuItem icon="refresh-cw" label="Switch to Rider Mode" onPress={() => router.replace('/rider/home' as any)} styles={styles} theme={theme} last />
        </View>

        {/* Logout */}
        <View style={styles.section}>
          <MenuItem icon="log-out" label="Log Out" onPress={handleLogout} styles={styles} theme={theme} destructive last />
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function MenuItem({ icon, label, onPress, styles, theme, destructive, last }: {
  icon: string;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  theme: ReturnType<typeof useTheme>;
  destructive?: boolean;
  last?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.menuItem, last && styles.menuItemLast]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.menuIconBox, destructive && styles.menuIconBoxRed]}>
        <Feather name={icon as any} size={18} color={destructive ? theme.red : theme.green} />
      </View>
      <Text style={[styles.menuLabel, destructive && { color: theme.red }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={theme.textMuted} />
    </TouchableOpacity>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background2 },
    header: { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 24, backgroundColor: '#1D9E75' },
    avatar: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, borderColor: '#fff', marginBottom: 12 },
    avatarPlaceholder: { width: 88, height: 88, borderRadius: 44, backgroundColor: 'rgba(255,255,255,0.25)', justifyContent: 'center', alignItems: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.6)', marginBottom: 12 },
    initials: { fontSize: 30, fontWeight: '700', color: '#fff' },
    name: { fontSize: 20, fontWeight: '700', color: '#fff', marginBottom: 4 },
    phone: { fontSize: 13, color: '#d4f5e9', marginBottom: 16 },
    statsRow: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12, paddingVertical: 10, paddingHorizontal: 24, marginTop: 8 },
    statItem: { flex: 1, alignItems: 'center' },
    statValue: { fontSize: 18, fontWeight: '700', color: '#fff' },
    statLabel: { fontSize: 11, color: '#d4f5e9', marginTop: 2 },
    statDivider: { width: 1, backgroundColor: 'rgba(255,255,255,0.3)', marginHorizontal: 16 },
    section: { backgroundColor: c.card, marginHorizontal: 16, marginTop: 16, borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder },
    menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    menuItemLast: { borderBottomWidth: 0 },
    menuIconBox: { width: 34, height: 34, borderRadius: 8, backgroundColor: c.greenLight, justifyContent: 'center', alignItems: 'center' },
    menuIconBoxRed: { backgroundColor: c.redLight },
    menuLabel: { flex: 1, fontSize: 15, fontWeight: '500', color: c.text },
  });
}
