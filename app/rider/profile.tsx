import { supabase } from '@/lib/supabase'
import { useTheme } from '@/lib/theme'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useEffect, useState } from 'react'
import { Alert, Linking, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

export default function RiderProfileScreen() {
  const theme = useTheme()
  const styles = makeStyles(theme)
  const router = useRouter()

  const [fullName, setFullName] = useState('')
  const [phone, setPhone] = useState('')
  const [totalRides, setTotalRides] = useState(0)
  const [rating, setRating] = useState<number | null>(null)
  const [goCashBalance, setGoCashBalance] = useState(0)
  const [isDriver, setIsDriver] = useState(false)

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
