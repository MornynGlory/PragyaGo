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

import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'

const userRole = 'rider' as const

export default function RiderProfileScreen() {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const deleteScrollRef = useRef<ScrollView>(null)

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [totalRides, setTotalRides] = useState(0)
  const [rating, setRating] = useState<number | null>(null)
  const [goCashBalance, setGoCashBalance] = useState(0)
  const [isDriver, setIsDriver] = useState(false)

  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [deletionReason, setDeletionReason] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [deletingAccount, setDeletingAccount] = useState(false)

  useEffect(() => { fetchProfile() }, [])

  const fetchProfile = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      if (profile) {
        setFullName(profile.full_name ?? '')
        setPhone(profile.phone ?? '')
        setRating(profile.rating ?? null)
        if (profile.role === 'driver') setIsDriver(true)
      }

      const { count } = await supabase
        .from('rides')
        .select('*', { count: 'exact', head: true })
        .eq('rider_id', user.id)
        .eq('status', 'completed')
      setTotalRides(count ?? 0)

      const { data: wallet } = await supabase
        .from('go_cash_transactions')
        .select('amount')
        .eq('user_id', user.id)
      if (wallet) {
        const balance = wallet.reduce((sum: number, t: { amount: number }) => sum + (t.amount ?? 0), 0)
        setGoCashBalance(Math.round(balance * 100) / 100)
      }
    } catch (e) {
      console.error('fetchProfile error:', e)
    }
  }

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Log Out',
        style: 'destructive',
        onPress: async () => {
          await supabase.auth.signOut()
          router.replace('/' as any)
        },
      },
    ])
  }

  const handleDeleteAccount = async () => {
    if (!deletePassword) return
    setDeletingAccount(true)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Verify password first
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email!,
        password: deletePassword
      })

      if (signInError) {
        Alert.alert('Incorrect Password', 'Please enter your correct password.')
        setDeletingAccount(false)
        return
      }

      // Check for active ride
      const { data: activeRide } = await supabase
        .from('rides')
        .select('id')
        .eq('rider_id', user.id)
        .in('status', ['requested', 'accepted', 'rider_boarding', 'in_progress', 'arrived_destination', 'payment_pending'])
        .maybeSingle()

      if (activeRide) {
        Alert.alert('Cannot Delete', 'You have an active ride. Please complete or cancel it first.')
        setDeletingAccount(false)
        return
      }

      // Check Go Cash balance for refund eligibility — go_cash_transactions.amount is
      // already signed (positive for top-ups, negative for spend), matching fetchProfile above.
      let goCashBalance = 0
      let refundEligible = false
      let refundAmount = 0

      const { data: goCash } = await supabase
        .from('go_cash_transactions')
        .select('amount')
        .eq('user_id', user.id)

      if (goCash) {
        goCashBalance = Math.round(goCash.reduce((sum: number, t: { amount: number }) => sum + (t.amount ?? 0), 0) * 100) / 100

        if (goCashBalance >= 15) {
          refundEligible = true
          refundAmount = goCashBalance
        }
      }

      // Calculate grace period end date (30 days from now)
      const gracePeriodEnds = new Date()
      gracePeriodEnds.setDate(gracePeriodEnds.getDate() + 30)

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
      })

      // Mark profile as deleted
      await supabase.from('profiles').update({
        is_deleted: true,
        deletion_requested_at: new Date().toISOString(),
        deletion_reason: deletionReason,
      }).eq('id', user.id)

      // Sign out
      await supabase.auth.signOut()

      // Show farewell message
      Alert.alert(
        'Account Deletion Requested',
        refundEligible
          ? `Your account has been deactivated. You have 30 days to change your mind by logging back in.\n\nYour Go Cash balance of GH₵${refundAmount.toFixed(2)} will be refunded to your Mobile Money number within 3-5 business days.`
          : 'Your account has been deactivated. You have 30 days to change your mind by logging back in. After 30 days your account will be permanently deleted.',
        [{ text: 'OK', onPress: () => router.replace('/') }]
      )

    } catch (e) {
      Alert.alert('Error', 'Could not delete account. Please try again.')
    } finally {
      setDeletingAccount(false)
    }
  }

  const initials = fullName.split(' ').map(n => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 2) || '?'

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Settings</Text>
        </View>

        {/* Avatar + name + phone */}
        <View style={styles.avatarSection}>
          <View style={styles.avatarCircle}>
            <Text style={styles.initials}>{initials}</Text>
          </View>
          <Text style={styles.fullName}>{fullName || 'Rider'}</Text>
          {!!phone && <Text style={styles.phone}>{phone}</Text>}
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Feather name="map" size={20} color={theme.green} style={styles.statIcon} />
            <Text style={styles.statValue}>{totalRides}</Text>
            <Text style={styles.statLabel}>Rides</Text>
          </View>
          <View style={[styles.statCard, styles.statCardMid]}>
            <Feather name="star" size={20} color={theme.green} style={styles.statIcon} />
            <Text style={styles.statValue}>{rating !== null ? rating.toFixed(1) : '—'}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statCard}>
            <Feather name="dollar-sign" size={20} color={theme.green} style={styles.statIcon} />
            <Text style={styles.statValue}>{goCashBalance.toFixed(2)}</Text>
            <Text style={styles.statLabel}>Go Cash</Text>
          </View>
        </View>

        {/* ACCOUNT */}
        <Text style={styles.sectionTitle}>ACCOUNT</Text>
        <View style={styles.section}>
          <MenuItem
            icon="dollar-sign" iconColor={theme.green} iconBg={theme.greenLight}
            label="My Wallet" onPress={() => router.push('/rider/gocash' as any)}
            styles={styles} theme={theme}
          />
          <MenuItem
            icon="clock" iconColor="#2563eb" iconBg={theme.blueLight}
            label="Ride History" onPress={() => router.push('/rider/history' as any)}
            styles={styles} theme={theme}
          />
          <MenuItem
            icon="edit-2" iconColor={theme.amber} iconBg={theme.amberLight}
            label="Edit Profile" onPress={() => router.push('/rider/edit-profile' as any)}
            styles={styles} theme={theme}
          />
          <MenuItem
            icon="bell" iconColor="#2563eb" iconBg={theme.blueLight}
            label="Notifications" onPress={() => router.push('/rider/notifications' as any)}
            styles={styles} theme={theme} last
          />
        </View>

        <View style={styles.divider} />

        {/* SUPPORT */}
        <Text style={styles.sectionTitle}>SUPPORT</Text>
        <View style={styles.section}>
          <MenuItem
            icon="help-circle" iconColor="#2563eb" iconBg={theme.blueLight}
            label="Help Center" onPress={() => Linking.openURL('https://www.pragyago.com/help')}
            styles={styles} theme={theme}
          />
          <MenuItem
            icon="shield" iconColor={theme.green} iconBg={theme.greenLight}
            label="Safety" onPress={() => Linking.openURL('https://www.pragyago.com/safety')}
            styles={styles} theme={theme}
          />
          <MenuItem
            icon="headphones" iconColor="#7C3AED" iconBg="#EDE9FE"
            label="Support" onPress={() => router.push('/support' as any)}
            styles={styles} theme={theme} last
          />
        </View>

        <View style={styles.divider} />

        {/* LEGAL */}
        <Text style={styles.sectionTitle}>LEGAL</Text>
        <View style={styles.section}>
          <MenuItem
            icon="file-text" iconColor={theme.textMuted} iconBg={theme.background2}
            label="Privacy Policy" onPress={() => Linking.openURL('https://www.pragyago.com/privacy-policy')}
            styles={styles} theme={theme}
          />
          <MenuItem
            icon="file-text" iconColor={theme.textMuted} iconBg={theme.background2}
            label="Terms of Service" onPress={() => Linking.openURL('https://www.pragyago.com/terms')}
            styles={styles} theme={theme} last
          />
        </View>

        <View style={styles.divider} />

        {/* PRIVACY */}
        <Text style={styles.sectionTitle}>PRIVACY</Text>
        <View style={styles.section}>
          <MenuItem
            icon="trash-2" iconColor={theme.red} iconBg={theme.redLight}
            label="Delete Account" onPress={() => setShowDeleteModal(true)}
            styles={styles} theme={theme} destructive last
          />
        </View>

        {isDriver && (
          <>
            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>SWITCH</Text>
            <View style={styles.section}>
              <MenuItem
                icon="truck" iconColor="#2563eb" iconBg={theme.blueLight}
                label="Switch to Driver Mode" onPress={() => router.replace('/driver/home' as any)}
                styles={styles} theme={theme} last
              />
            </View>
          </>
        )}

        <View style={styles.divider} />

        <View style={styles.section}>
          <MenuItem
            icon="log-out" iconColor={theme.red} iconBg={theme.redLight}
            label="Log Out" onPress={handleLogout}
            styles={styles} theme={theme} destructive last
          />
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal visible={showDeleteModal} transparent animationType="slide">
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.5)',
            justifyContent: 'flex-end',
          }}>
            <View style={{
              backgroundColor: theme.card,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingBottom: Math.max(insets.bottom, 16),
              maxHeight: '90%',
            }}>
              <ScrollView
                ref={deleteScrollRef}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ padding: 24 }}
              >
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 20,
                }}>
                  <Text style={{ fontSize: 20, fontWeight: '800', color: theme.text }}>
                    Delete Account
                  </Text>
                  <TouchableOpacity onPress={() => {
                    setShowDeleteModal(false)
                    setDeletionReason('')
                    setDeletePassword('')
                  }}>
                    <Feather name="x" size={24} color={theme.text} />
                  </TouchableOpacity>
                </View>

                <View style={{
                  width: 64, height: 64, borderRadius: 32,
                  backgroundColor: theme.redLight,
                  justifyContent: 'center', alignItems: 'center',
                  alignSelf: 'center',
                  marginBottom: 16,
                }}>
                  <Feather name="trash-2" size={32} color={theme.red} />
                </View>

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
                • Your saved preferences{'\n'}
                • Go Cash balance below GH₵15.00
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
                • Ride records anonymized (2 years){'\n'}
                • Go Cash balance above GH₵15.00 will be refunded
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
              onFocus={() => {
                setTimeout(() => {
                  deleteScrollRef.current?.scrollToEnd({ animated: true })
                }, 300)
              }}
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
                setShowDeleteModal(false)
                setDeletionReason('')
                setDeletePassword('')
              }}
              style={{ paddingVertical: 12, alignItems: 'center' }}
              disabled={deletingAccount}
            >
              <Text style={{ color: theme.textSecondary, fontSize: 15 }}>Cancel</Text>
            </TouchableOpacity>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  )
}

function MenuItem({ icon, iconColor, iconBg, label, onPress, styles, theme, destructive, last }: {
  icon: string
  iconColor: string
  iconBg: string
  label: string
  onPress: () => void
  styles: ReturnType<typeof makeStyles>
  theme: ReturnType<typeof useTheme>
  destructive?: boolean
  last?: boolean
}) {
  return (
    <TouchableOpacity
      style={[styles.menuItem, last && styles.menuItemLast]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.menuIconBox, { backgroundColor: iconBg }]}>
        <Feather name={icon as any} size={18} color={iconColor} />
      </View>
      <Text style={[styles.menuLabel, destructive && { color: theme.red }]}>{label}</Text>
      <Feather name="chevron-right" size={16} color={theme.textMuted} />
    </TouchableOpacity>
  )
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    scrollContent: { paddingBottom: 24 },
    header: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12, backgroundColor: c.background, borderBottomWidth: 0.5, borderBottomColor: c.border },
    headerTitle: { fontSize: 28, fontWeight: '700', color: c.text },
    avatarSection: { alignItems: 'center', paddingVertical: 24, backgroundColor: c.card, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    avatarCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: c.green, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
    initials: { fontSize: 28, fontWeight: '700', color: '#fff' },
    fullName: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 4 },
    phone: { fontSize: 14, color: c.textSecondary },
    statsRow: { flexDirection: 'row', padding: 16, gap: 10, backgroundColor: c.background },
    statCard: { flex: 1, backgroundColor: c.card, borderWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder, borderRadius: 12, padding: 12, alignItems: 'center' },
    statCardMid: { marginHorizontal: 0 },
    statIcon: { marginBottom: 6 },
    statValue: { fontSize: 18, fontWeight: '700', color: c.green, marginBottom: 2 },
    statLabel: { fontSize: 11, color: c.textSecondary, textAlign: 'center' },
    sectionTitle: { fontSize: 12, fontWeight: '700', color: c.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6, backgroundColor: c.background },
    section: { backgroundColor: c.card, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.border },
    menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, gap: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    menuItemLast: { borderBottomWidth: 0 },
    menuIconBox: { width: 36, height: 36, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
    menuLabel: { flex: 1, fontSize: 15, color: c.text },
    divider: { height: 8, backgroundColor: c.background2 },
  })
}
