// Run in Supabase SQL:
// ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN DEFAULT false;
// ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ;
// ALTER TABLE profiles ADD COLUMN IF NOT EXISTS deletion_reason TEXT;
// CREATE TABLE IF NOT EXISTS account_deletions (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
//   role TEXT NOT NULL,
//   reason TEXT,
//   go_cash_balance NUMERIC(10,2) DEFAULT 0,
//   refund_eligible BOOLEAN DEFAULT false,
//   refund_amount NUMERIC(10,2) DEFAULT 0,
//   refund_status TEXT DEFAULT 'not_applicable',
//   deletion_requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
//   grace_period_ends_at TIMESTAMPTZ NOT NULL,
//   status TEXT NOT NULL DEFAULT 'pending',
//   cancelled_at TIMESTAMPTZ,
//   created_at TIMESTAMPTZ NOT NULL DEFAULT now()
// );

import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const userRole = 'driver' as const;

export default function DriverSettingsScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [totalRides, setTotalRides] = useState(0);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletionReason, setDeletionReason] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);

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

  const handleDeleteAccount = async () => {
    if (!deletePassword) return;
    setDeletingAccount(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Verify password first
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email!,
        password: deletePassword
      });

      if (signInError) {
        Alert.alert('Incorrect Password', 'Please enter your correct password.');
        setDeletingAccount(false);
        return;
      }

      // drivers.id (not the profile/auth id) is what rides.driver_id and
      // drivers.commission_owed are keyed on — resolve it once, reuse for both checks below.
      const { data: driver } = await supabase
        .from('drivers')
        .select('id, commission_owed, wallet_balance')
        .eq('profile_id', user.id)
        .single();

      if (driver && driver.commission_owed > 0) {
        Alert.alert('Cannot Delete', `You have unpaid commission of GH₵${driver.commission_owed}. Please settle before deleting your account.`);
        setDeletingAccount(false);
        return;
      }

      // Check for active ride
      if (driver) {
        const { data: activeRide } = await supabase
          .from('rides')
          .select('id')
          .eq('driver_id', driver.id)
          .in('status', ['accepted', 'rider_boarding', 'in_progress', 'arrived_destination', 'payment_pending'])
          .maybeSingle();

        if (activeRide) {
          Alert.alert('Cannot Delete', 'You have an active ride. Please complete or cancel it first.');
          setDeletingAccount(false);
          return;
        }
      }

      // Go Cash is a rider-side wallet in this app — drivers don't accrue a refundable balance here.
      const goCashBalance = 0;
      const refundEligible = false;
      const refundAmount = 0;

      // Calculate grace period end date (30 days from now)
      const gracePeriodEnds = new Date();
      gracePeriodEnds.setDate(gracePeriodEnds.getDate() + 30);

      // Create deletion record
      await supabase.from('account_deletions').insert({
        user_id: user.id,
        role: userRole,
        reason: deletionReason,
        go_cash_balance: goCashBalance,
        refund_eligible: refundEligible,
        refund_amount: refundAmount,
        refund_status: refundEligible ? 'pending' : 'not_applicable',
        deletion_requested_at: new Date().toISOString(),
        grace_period_ends_at: gracePeriodEnds.toISOString(),
        status: 'pending'
      });

      // Mark profile as deleted
      await supabase.from('profiles').update({
        is_deleted: true,
        deletion_requested_at: new Date().toISOString(),
        deletion_reason: deletionReason,
      }).eq('id', user.id);

      // Sign out
      await supabase.auth.signOut();

      // Show farewell message
      Alert.alert(
        'Account Deletion Requested',
        'Your account has been deactivated. You have 30 days to change your mind by logging back in. After 30 days your account will be permanently deleted.',
        [{ text: 'OK', onPress: () => router.replace('/' as any) }]
      );

    } catch (e) {
      Alert.alert('Error', 'Could not delete account. Please try again.');
    } finally {
      setDeletingAccount(false);
    }
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

        {/* Privacy */}
        <View style={styles.section}>
          <MenuItem icon="trash-2" label="Delete Account" onPress={() => setShowDeleteModal(true)} styles={styles} theme={theme} destructive last />
        </View>

        {/* Logout */}
        <View style={styles.section}>
          <MenuItem icon="log-out" label="Log Out" onPress={handleLogout} styles={styles} theme={theme} destructive last />
        </View>

      </ScrollView>

      <Modal visible={showDeleteModal} transparent animationType="slide">
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.5)',
          justifyContent: 'flex-end',
        }}>
          <ScrollView
            style={{
              backgroundColor: theme.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
            }}
            contentContainerStyle={{ padding: 24 }}
            showsVerticalScrollIndicator={false}
          >
            <View style={{
              width: 64, height: 64, borderRadius: 32,
              backgroundColor: theme.redLight,
              justifyContent: 'center', alignItems: 'center',
              alignSelf: 'center',
              marginBottom: 16,
            }}>
              <Feather name="trash-2" size={32} color={theme.red} />
            </View>

            <Text style={{ fontSize: 20, fontWeight: '800', color: theme.text, textAlign: 'center', marginBottom: 12 }}>
              Delete Account
            </Text>

            <Text style={{ fontSize: 14, color: theme.textSecondary, textAlign: 'center', lineHeight: 22, marginBottom: 20 }}>
              Are you sure you want to delete your account? This action cannot be undone after 30 days.
            </Text>

            {/* What will be deleted */}
            <View style={{
              backgroundColor: theme.redLight,
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
            }}>
              <Text style={{ color: theme.red, fontWeight: '700', marginBottom: 8 }}>
                What will be deleted:
              </Text>
              <Text style={{ color: theme.red, fontSize: 13, lineHeight: 22 }}>
                • Your profile and personal information{'\n'}
                • Your ride history visibility{'\n'}
                • Your saved preferences
              </Text>
            </View>

            {/* What is kept */}
            <View style={{
              backgroundColor: theme.greenLight,
              borderRadius: 12,
              padding: 16,
              marginBottom: 20,
            }}>
              <Text style={{ color: theme.green, fontWeight: '700', marginBottom: 8 }}>
                What is retained (legal requirement):
              </Text>
              <Text style={{ color: theme.green, fontSize: 13, lineHeight: 22 }}>
                • Payment records (7 years){'\n'}
                • Ride records anonymized (2 years)
              </Text>
            </View>

            {/* Reason picker */}
            <Text style={{ color: theme.text, fontWeight: '600', marginBottom: 8 }}>
              Why are you leaving? (optional)
            </Text>

            {[
              'I no longer need the service',
              'Privacy concerns',
              'Switching to another service',
              'Too many issues with the app',
              'Other'
            ].map((reason) => (
              <TouchableOpacity
                key={reason}
                onPress={() => setDeletionReason(reason)}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 10,
                  borderBottomWidth: 0.5,
                  borderBottomColor: theme.border,
                }}
              >
                <View style={{
                  width: 20, height: 20, borderRadius: 10,
                  borderWidth: 2,
                  borderColor: deletionReason === reason ? theme.red : theme.border,
                  backgroundColor: deletionReason === reason ? theme.red : 'transparent',
                  marginRight: 12,
                }} />
                <Text style={{ color: theme.text, fontSize: 14 }}>{reason}</Text>
              </TouchableOpacity>
            ))}

            {/* Password confirmation */}
            <TextInput
              placeholder="Enter your password to confirm"
              placeholderTextColor={theme.placeholder}
              secureTextEntry
              value={deletePassword}
              onChangeText={setDeletePassword}
              style={{
                backgroundColor: theme.input,
                borderRadius: 10,
                padding: 14,
                color: theme.text,
                marginTop: 16,
                marginBottom: 20,
              }}
            />

            {/* Delete button */}
            <TouchableOpacity
              onPress={handleDeleteAccount}
              disabled={!deletePassword || deletingAccount}
              style={{
                backgroundColor: !deletePassword ? theme.border : theme.red,
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: 'center',
                marginBottom: 12,
              }}
            >
              {deletingAccount ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={{ color: 'white', fontSize: 16, fontWeight: '700' }}>
                  Delete My Account
                </Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => {
                setShowDeleteModal(false);
                setDeletionReason('');
                setDeletePassword('');
              }}
              style={{ paddingVertical: 12, alignItems: 'center' }}
              disabled={deletingAccount}
            >
              <Text style={{ color: theme.textSecondary, fontSize: 15 }}>Cancel</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
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
