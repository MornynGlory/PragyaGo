import { supabase } from '@/lib/supabase'
import { MoMoProvider, PROVIDER_COLORS, PROVIDER_LABELS } from '@/lib/paystack'
import { useTheme } from '@/lib/theme'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React, { useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { PaystackProvider, usePaystack } from 'react-native-paystack-webview'

const PAYSTACK_PUBLIC_KEY = process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY ?? ''
const PROVIDERS: MoMoProvider[] = ['mtn', 'tel', 'atl']

function PaystackAutoCheckout({ params }: { params: any }) {
  const { popup } = usePaystack()
  const triggered = useRef(false)
  useEffect(() => {
    if (triggered.current) return
    triggered.current = true
    popup.checkout(params)
  }, [])
  return null
}

export default function GoCashScreen() {
  const theme = useTheme()
  const insets = useSafeAreaInsets()
  const styles = makeStyles(theme)
  const router = useRouter()

  const [balance, setBalance] = useState(0)
  const [transactions, setTransactions] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState(false)
  const [showPaystack, setShowPaystack] = useState(false)
  const [paystackParams, setPaystackParams] = useState<any>(null)

  const [topUpAmount, setTopUpAmount] = useState('')
  const [momoPhone, setMomoPhone] = useState('')
  const [provider, setProvider] = useState<MoMoProvider>('mtn')

  const userIdRef = useRef('')
  const userEmailRef = useRef('')
  const balanceRef = useRef(0)

  useEffect(() => { init() }, [])

  const init = async () => {
    await fetchWallet()
    await sweepPendingTopUps()
  }

  const fetchWallet = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      userIdRef.current = user.id
      userEmailRef.current = user.email ?? ''

      const { data: profile } = await supabase
        .from('profiles')
        .select('go_cash_balance, phone')
        .eq('id', user.id)
        .single()
      if (profile) {
        const bal = profile.go_cash_balance ?? 0
        setBalance(bal)
        balanceRef.current = bal
        if (profile.phone && !momoPhone) setMomoPhone(profile.phone)
      }

      const { data: txns } = await supabase
        .from('go_cash_transactions')
        .select('*')
        .eq('rider_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20)
      if (txns) setTransactions(txns)
    } catch (error) {
      console.error('Error fetching wallet:', error)
    } finally {
      setLoading(false)
    }
  }

  const sweepPendingTopUps = async () => {
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: pending } = await supabase
        .from('wallet_topups')
        .select('reference')
        .eq('status', 'pending')
        .gte('created_at', since)
      if (!pending || pending.length === 0) return
      let credited = false
      for (const row of pending) {
        if (!row?.reference) continue
        const { data } = await supabase.functions.invoke('topup-verify', {
          body: { reference: row.reference },
        })
        if (data?.success) credited = true
      }
      if (credited) await fetchWallet()
    } catch (err) {
      console.log('sweepPendingTopUps error:', err)
    }
  }

  const verifyWithRetry = async (reference: string): Promise<
    | { ok: true; amount: number }
    | { ok: false; status: 'retry_exhausted' | 'failed' }
  > => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await supabase.functions.invoke('topup-verify', {
        body: { reference },
      })
      if (!error && data?.success) {
        return { ok: true, amount: Number(data.amount) || 0 }
      }
      const status = data?.status
      if (status === 'failed' || status === 'abandoned' || status === 'mismatch') {
        return { ok: false, status: 'failed' }
      }
      if (attempt < 4) await new Promise(r => setTimeout(r, 3000))
    }
    return { ok: false, status: 'retry_exhausted' }
  }

  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount)
    if (!amount || amount < 1) { Alert.alert('Invalid Amount', 'Please enter at least GH₵ 1.'); return }
    if (!momoPhone.trim() || momoPhone.trim().length < 9) { Alert.alert('Phone Required', 'Please enter your Mobile Money number (at least 9 digits).'); return }
    if (!userEmailRef.current) { Alert.alert('Error', 'Could not get your email. Please log in again.'); return }

    const capturedProvider = provider
    const capturedPhone = momoPhone.trim()

    setProcessing(true)
    try {
      const { data: initData, error: initError } = await supabase.functions.invoke('topup-init', {
        body: { kind: 'go_cash', amount },
      })
      if (initError || !initData?.reference) {
        Alert.alert('Error', 'Could not start the top-up. Please try again.')
        return
      }

      const reference: string = initData.reference
      const serverAmount: number = Number(initData.amount) || amount
      const email: string = initData.email || userEmailRef.current

      setPaystackParams({
        email,
        amount: serverAmount,
        reference,
        metadata: { mobile_money_phone: capturedPhone, mobile_money_provider: capturedProvider },
        onSuccess: async () => {
          setShowPaystack(false)
          setProcessing(true)
          try {
            const result = await verifyWithRetry(reference)
            if (result.ok) {
              setTopUpAmount('')
              Alert.alert('Top Up Successful!', `GH₵ ${result.amount.toFixed(2)} added to your Go Cash wallet.`)
              await fetchWallet()
            } else if (result.status === 'retry_exhausted') {
              Alert.alert('Payment received', 'It will appear shortly.')
            } else {
              Alert.alert('Payment not completed')
            }
          } finally {
            setProcessing(false)
          }
        },
        onCancel: () => setShowPaystack(false),
      })
      setShowPaystack(true)
    } catch {
      Alert.alert('Error', 'Could not start the top-up. Please try again.')
    } finally {
      setProcessing(false)
    }
  }

  const txnIconAndColor = (type: string) => {
    if (type === 'topup') return { icon: 'arrow-down-circle' as const, color: theme.green }
    if (type === 'payment') return { icon: 'arrow-up-circle' as const, color: theme.red }
    return { icon: 'refresh-cw' as const, color: theme.blue }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <Feather name="arrow-left" size={22} color={theme.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Go Cash Wallet</Text>
          <View style={styles.headerBtn} />
        </View>
        <View style={styles.center}>
          <ActivityIndicator size="large" color={theme.green} />
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn} activeOpacity={0.7}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Go Cash Wallet</Text>
        <View style={styles.headerBtn} />
      </View>

      <ScrollView
        style={styles.container}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: Math.max(insets.bottom + 16, 32) }}
      >
        {/* Balance Card */}
        <View style={styles.walletCard}>
          <Feather name="dollar-sign" size={28} color="rgba(255,255,255,0.8)" style={{ marginBottom: 8 }} />
          <Text style={styles.walletLabel}>Go Cash Balance</Text>
          <Text style={styles.walletBalance}>GH₵ {balance.toFixed(2)}</Text>
          <Text style={styles.walletSub}>Available for rides</Text>
        </View>

        {/* Top Up Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Up Go Cash</Text>
          <Text style={styles.topUpNote}>
            Top-ups can be paid with Mobile Money (MTN MoMo, Telecel Cash, AirtelTigo Money) or card, via Paystack.
          </Text>

          <Text style={styles.fieldLabel}>Network</Text>
          <View style={styles.networkRow}>
            {PROVIDERS.map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.networkBtn, provider === p && { backgroundColor: PROVIDER_COLORS[p], borderColor: PROVIDER_COLORS[p] }]}
                onPress={() => setProvider(p)}
              >
                <Text style={[styles.networkBtnText, provider === p && styles.networkBtnTextActive]}>
                  {PROVIDER_LABELS[p]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.fieldLabel}>Mobile Money Number</Text>
          <TextInput
            style={styles.input}
            placeholder="e.g. 024XXXXXXX"
            value={momoPhone}
            onChangeText={setMomoPhone}
            keyboardType="phone-pad"
            placeholderTextColor={theme.placeholder}
          />

          <Text style={styles.fieldLabel}>Amount (GH₵)</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter amount"
            value={topUpAmount}
            onChangeText={setTopUpAmount}
            keyboardType="numeric"
            placeholderTextColor={theme.placeholder}
          />

          {[['1', '2', '5'], ['10', '20', '50', '100']].map((row, ri) => (
            <View key={ri} style={[styles.quickAmounts, ri === 0 && { marginBottom: 8 }]}>
              {row.map((amt) => (
                <TouchableOpacity key={amt} style={styles.quickAmount} onPress={() => setTopUpAmount(amt)}>
                  <Text style={styles.quickAmountText}>GH₵ {amt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}

          <TouchableOpacity
            style={[styles.payButton, processing && styles.buttonDisabled]}
            onPress={handleTopUp}
            disabled={processing}
            activeOpacity={0.85}
          >
            {processing
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.payButtonText}>Pay GH₵ {parseFloat(topUpAmount || '0').toFixed(2)} via {PROVIDER_LABELS[provider]}</Text>
            }
          </TouchableOpacity>
          <Text style={styles.paystackNote}>Secured by Paystack</Text>
        </View>

        {/* Transaction History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Transaction History</Text>
          {transactions.length === 0 ? (
            <View style={styles.emptyTxn}>
              <Feather name="inbox" size={32} color={theme.textMuted} />
              <Text style={styles.emptyText}>No transactions yet</Text>
            </View>
          ) : (
            transactions.map((txn) => {
              const { icon, color } = txnIconAndColor(txn.type)
              return (
                <View key={txn.id} style={styles.txnRow}>
                  <View style={[styles.txnIcon, { backgroundColor: txn.type === 'topup' ? theme.greenLight : txn.type === 'payment' ? theme.redLight : theme.blueLight }]}>
                    <Feather name={icon} size={18} color={color} />
                  </View>
                  <View style={styles.txnDetails}>
                    <Text style={styles.txnDescription}>{txn.description}</Text>
                    <Text style={styles.txnDate}>
                      {new Date(txn.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </Text>
                  </View>
                  <Text style={[styles.txnAmount, { color }]}>
                    {txn.type === 'payment' ? '-' : '+'}GH₵ {Math.abs(txn.amount).toFixed(2)}
                  </Text>
                </View>
              )
            })
          )}
        </View>

        <View style={{ height: 32 }} />
      </ScrollView>
      </KeyboardAvoidingView>

      {/* Paystack modal */}
      <Modal visible={showPaystack} animationType="slide" transparent={false}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.card }} edges={['top']}>
          <TouchableOpacity onPress={() => setShowPaystack(false)} style={styles.modalClose} activeOpacity={0.7}>
            <Feather name="x" size={20} color={theme.text} />
            <Text style={styles.modalCloseText}>Close</Text>
          </TouchableOpacity>
          {showPaystack && paystackParams && (
            <PaystackProvider publicKey={PAYSTACK_PUBLIC_KEY} currency="GHS" defaultChannels={['mobile_money']}>
              <PaystackAutoCheckout params={paystackParams} />
            </PaystackProvider>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  )
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: c.border, backgroundColor: c.background },
    headerBtn: { width: 48, height: 40, justifyContent: 'center', alignItems: 'center' },
    headerTitle: { fontSize: 18, fontWeight: '700', color: c.text },
    container: { flex: 1 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
    walletCard: { backgroundColor: c.green, margin: 16, borderRadius: 16, padding: 24, alignItems: 'center' },
    walletLabel: { fontSize: 14, color: 'rgba(255,255,255,0.75)', marginBottom: 8 },
    walletBalance: { fontSize: 42, fontWeight: '700', color: '#fff', marginBottom: 4 },
    walletSub: { fontSize: 13, color: 'rgba(255,255,255,0.75)' },
    section: { backgroundColor: c.card, margin: 16, marginTop: 0, borderRadius: 12, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: c.cardBorder },
    sectionTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 8 },
    topUpNote: { fontSize: 13, color: c.textSecondary, lineHeight: 18, marginBottom: 14 },
    fieldLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
    networkRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    networkBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', backgroundColor: c.card },
    networkBtnText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
    networkBtnTextActive: { color: '#fff' },
    input: { borderWidth: 1, borderColor: c.inputBorder, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: c.text, backgroundColor: c.input, marginBottom: 14 },
    quickAmounts: { flexDirection: 'row', gap: 8, marginBottom: 14 },
    quickAmount: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: c.green, alignItems: 'center' },
    quickAmountText: { color: c.green, fontWeight: '600', fontSize: 13 },
    payButton: { backgroundColor: c.green, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
    buttonDisabled: { opacity: 0.6 },
    payButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
    paystackNote: { textAlign: 'center', color: c.textMuted, fontSize: 11, marginTop: 10 },
    emptyTxn: { alignItems: 'center', paddingVertical: 24, gap: 8 },
    emptyText: { color: c.textMuted, fontSize: 14 },
    txnRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: c.border, gap: 12 },
    txnIcon: { width: 38, height: 38, borderRadius: 19, justifyContent: 'center', alignItems: 'center' },
    txnDetails: { flex: 1 },
    txnDescription: { fontSize: 14, color: c.text, fontWeight: '500' },
    txnDate: { fontSize: 12, color: c.textMuted, marginTop: 2 },
    txnAmount: { fontSize: 15, fontWeight: '700' },
    modalClose: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16, borderBottomWidth: 0.5, borderBottomColor: c.border },
    modalCloseText: { fontSize: 16, color: c.text, fontWeight: '600' },
  })
}
