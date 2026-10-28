import { MoMoProvider, PROVIDER_COLORS, PROVIDER_LABELS } from '@/lib/paystack';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
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
} from 'react-native';
import { PaystackProvider, usePaystack } from 'react-native-paystack-webview';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const PAYSTACK_PUBLIC_KEY = process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY ?? '';
const PROVIDERS: MoMoProvider[] = ['mtn', 'tel', 'atl'];

type TabName = 'wallet' | 'gocash' | 'history';

// Auto-triggers popup.checkout() once when mounted inside PaystackProvider
function PaystackAutoCheckout({ params }: { params: any }) {
  const { popup } = usePaystack();
  const triggered = useRef(false);
  useEffect(() => {
    if (triggered.current) return;
    triggered.current = true;
    popup.checkout(params);
  }, []);
  return null;
}

export default function DriverWalletScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = makeStyles(theme);
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<TabName>('wallet');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showPaystack, setShowPaystack] = useState(false);
  const [paystackParams, setPaystackParams] = useState<any>(null);

  const [driverId, setDriverId] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [commissionOwed, setCommissionOwed] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [goCashEarnings, setGoCashEarnings] = useState(0);
  const [goCashLocked, setGoCashLocked] = useState(false);

  const [userEmail, setUserEmail] = useState('');
  const userIdRef = useRef('');

  const [topUpAmount, setTopUpAmount] = useState('');
  const [topUpPhone, setTopUpPhone] = useState('');
  const [topUpProvider, setTopUpProvider] = useState<MoMoProvider>('mtn');

  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState('');
  const [withdrawNetwork, setWithdrawNetwork] = useState<MoMoProvider>('mtn');

  const [transactions, setTransactions] = useState<any[]>([]);

  useEffect(() => {
    (async () => {
      await loadData();
      await sweepPendingTopUps();
    })();
  }, []);

  const sweepPendingTopUps = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const { data: pending } = await supabase
        .from('wallet_topups')
        .select('reference')
        .eq('status', 'pending')
        .gte('created_at', since);
      if (!pending || pending.length === 0) return;
      let credited = false;
      for (const row of pending) {
        if (!row?.reference) continue;
        const { data } = await supabase.functions.invoke('topup-verify', {
          body: { reference: row.reference },
        });
        if (data?.success) credited = true;
      }
      if (credited) await loadData();
    } catch (err) {
      console.log('sweepPendingTopUps error:', err);
    }
  };

  const verifyWithRetry = async (reference: string): Promise<
    | { ok: true; amount: number }
    | { ok: false; status: 'retry_exhausted' | 'failed' }
  > => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data, error } = await supabase.functions.invoke('topup-verify', {
        body: { reference },
      });
      if (!error && data?.success) {
        return { ok: true, amount: Number(data.amount) || 0 };
      }
      const status = data?.status;
      if (status === 'failed' || status === 'abandoned' || status === 'mismatch') {
        return { ok: false, status: 'failed' };
      }
      if (attempt < 4) await new Promise(r => setTimeout(r, 3000));
    }
    return { ok: false, status: 'retry_exhausted' };
  };

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      userIdRef.current = user.id;
      setUserEmail(user.email ?? '');

      const { data: profile } = await supabase
        .from('profiles')
        .select('phone')
        .eq('id', user.id)
        .single();
      if (profile?.phone) {
        setTopUpPhone(prev => prev || profile.phone);
        setWithdrawPhone(prev => prev || profile.phone);
      }

      const { data: driver } = await supabase
        .from('drivers')
        .select('*')
        .eq('profile_id', user.id)
        .single();

      if (!driver) return;

      setDriverId(driver.id);
      setWalletBalance(driver.wallet_balance || 0);
      setGoCashEarnings(driver.go_cash_earnings || 0);
      setGoCashLocked(driver.go_cash_locked || false);

      setCommissionOwed(driver.commission_owed ?? 0);
      setIsLocked(driver.is_locked || false);

      const { data: txns } = await supabase
        .from('driver_wallet_transactions')
        .select('*')
        .eq('driver_id', driver.id)
        .order('created_at', { ascending: false });

      if (txns) setTransactions(txns);
    } catch (error) {
      console.error('Error loading wallet data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (!amount || amount < 1) {
      Alert.alert('Invalid Amount', 'Minimum top up is GH₵ 1.');
      return;
    }
    if (!topUpPhone.trim() || topUpPhone.trim().length < 9) {
      Alert.alert('Phone Required', 'Please enter your Mobile Money phone number.');
      return;
    }
    if (!driverId || !userEmail) return;

    const capturedProvider = topUpProvider;
    const capturedPhone = topUpPhone.trim();

    setSubmitting(true);
    try {
      const { data: initData, error: initError } = await supabase.functions.invoke('topup-init', {
        body: { kind: 'driver_wallet', amount },
      });
      if (initError || !initData?.reference) {
        Alert.alert('Error', 'Could not start the top-up. Please try again.');
        return;
      }

      const reference: string = initData.reference;
      const serverAmount: number = Number(initData.amount) || amount;
      const email: string = initData.email || userEmail;

      setPaystackParams({
        email,
        amount: serverAmount, // GH₵ — Paystack GH₵ uses cedis, not pesewas
        reference,
        metadata: {
          mobile_money_phone: capturedPhone,
          mobile_money_provider: capturedProvider,
        },
        onSuccess: async () => {
          setShowPaystack(false);
          setSubmitting(true);
          try {
            const result = await verifyWithRetry(reference);
            if (result.ok) {
              setTopUpAmount('');
              Alert.alert('Top Up Successful!', `GH₵ ${result.amount.toFixed(2)} added to your wallet.`);
              await loadData();
            } else if (result.status === 'retry_exhausted') {
              Alert.alert('Payment received', 'It will appear shortly.');
            } else {
              Alert.alert('Payment not completed');
            }
          } finally {
            setSubmitting(false);
          }
        },
        onCancel: () => setShowPaystack(false),
      });

      setShowPaystack(true);
    } catch {
      Alert.alert('Error', 'Could not start the top-up. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) { Alert.alert('Invalid Amount', 'Please enter a valid amount.'); return; }
    if (!withdrawPhone.trim()) { Alert.alert('Phone Required', 'Please enter your Mobile Money number.'); return; }
    if (!driverId) return;

    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('request_withdrawal', {
        p_amount: amount,
        p_network: PROVIDER_LABELS[withdrawNetwork],
        p_number: withdrawPhone.trim(),
      });

      if (error) {
        Alert.alert('Error', 'Withdrawal failed. Please try again.');
        return;
      }

      if (!data?.success) {
        const code = data?.error;
        switch (code) {
          case 'commission_owed':
            Alert.alert('Pay your commission before withdrawing');
            break;
          case 'insufficient_balance':
            Alert.alert('Insufficient balance');
            break;
          case 'invalid_number':
            Alert.alert('Invalid Mobile Money number');
            break;
          case 'withdrawal_already_pending':
            Alert.alert('You already have a withdrawal being processed');
            break;
          case 'minimum_is_1':
            Alert.alert('Minimum withdrawal is GH₵ 1');
            break;
          case 'account_not_allowed':
            Alert.alert('Your account is not allowed to withdraw');
            break;
          default:
            Alert.alert('Error', 'Withdrawal failed. Please try again.');
        }
        return;
      }

      setWithdrawAmount('');
      Alert.alert(
        'Withdrawal Submitted',
        `GH₵ ${amount.toFixed(2)} withdrawal to ${withdrawPhone} (${PROVIDER_LABELS[withdrawNetwork]}) submitted. Will be processed within 24 hours.`,
      );
      await loadData();
    } catch {
      Alert.alert('Error', 'Withdrawal failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const txnIcon = (type: string) => {
    if (type === 'topup') return '⬆️';
    if (type === 'commission_deduction') return '💸';
    return '↩️';
  };

  const txnColor = (type: string) => {
    if (type === 'topup') return theme.green;
    if (type === 'commission_deduction') return '#FF3B30';
    return '#185FA5';
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return (
      d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' +
      d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    );
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
            <Feather name="arrow-left" size={22} color={theme.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Wallet</Text>
          <View style={styles.headerBtn} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={theme.green} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
      >
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBtn}>
          <Feather name="arrow-left" size={22} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Wallet</Text>
        <View style={styles.headerBtn} />
      </View>
      <View style={styles.tabs}>
        {(['wallet', 'gocash', 'history'] as TabName[]).map((tab) => (
          <TouchableOpacity
            key={tab}
            style={[styles.tab, activeTab === tab && styles.tabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
              {tab === 'wallet' ? 'Wallet' : tab === 'gocash' ? 'Go Cash' : 'History'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* WALLET TAB */}
      {activeTab === 'wallet' && (
        <ScrollView
          style={styles.content}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingBottom: Math.max(insets.bottom + 16, 32) }}
        >
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Wallet Balance</Text>
            <Text style={styles.balanceAmount}>GH₵ {walletBalance.toFixed(2)}</Text>
            {isLocked && commissionOwed > 0 && (
              <View style={styles.lockedBadge}>
                <Text style={styles.lockedText}>🔒 App locked — pay commission to unlock</Text>
              </View>
            )}
          </View>

          {commissionOwed > 0 && (
            <View style={styles.commissionCard}>
              <Text style={styles.commissionLabel}>Commission Owed</Text>
              <Text style={styles.commissionAmount}>GH₵ {commissionOwed.toFixed(2)}</Text>
              <Text style={styles.commissionNote}>Top up your wallet to auto-settle commission and unlock your account.</Text>
            </View>
          )}

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Top Up via Mobile Money</Text>

            <Text style={styles.fieldLabel}>Select Network</Text>
            <View style={styles.networkRow}>
              {PROVIDERS.map((p) => (
                <TouchableOpacity
                  key={p}
                  style={[
                    styles.networkBtn,
                    topUpProvider === p && { backgroundColor: PROVIDER_COLORS[p], borderColor: PROVIDER_COLORS[p] },
                  ]}
                  onPress={() => setTopUpProvider(p)}
                >
                  <Text style={[styles.networkBtnText, topUpProvider === p && styles.networkBtnTextActive]}>
                    {PROVIDER_LABELS[p]}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <Text style={styles.fieldLabel}>Mobile Money Number</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 024XXXXXXX"
              keyboardType="phone-pad"
              value={topUpPhone}
              onChangeText={setTopUpPhone}
              placeholderTextColor={theme.placeholder}
            />

            <Text style={styles.fieldLabel}>Amount (GH₵)</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter amount"
              keyboardType="numeric"
              value={topUpAmount}
              onChangeText={setTopUpAmount}
              placeholderTextColor={theme.placeholder}
            />
            {[[1, 2, 5], [10, 20, 50, 100]].map((row, ri) => (
              <View key={ri} style={[styles.quickAmounts, ri === 0 && { marginBottom: 8 }]}>
                {row.map((amt) => (
                  <TouchableOpacity key={amt} style={styles.quickBtn} onPress={() => setTopUpAmount(String(amt))}>
                    <Text style={styles.quickBtnText}>GH₵ {amt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
            <TouchableOpacity
              style={[styles.actionButton, styles.walletButton, submitting && styles.buttonDisabled]}
              onPress={handleTopUp}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.actionButtonText}>
                  Pay GH₵ {parseFloat(topUpAmount || '0').toFixed(2)} via {PROVIDER_LABELS[topUpProvider]}
                </Text>
              )}
            </TouchableOpacity>
            <Text style={styles.paystackNote}>Secured by Paystack</Text>
          </View>
        </ScrollView>
      )}

      {/* GO CASH TAB */}
      {activeTab === 'gocash' && (
        <ScrollView
          style={styles.content}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingBottom: Math.max(insets.bottom + 16, 32) }}
        >
          <View style={[styles.balanceCard, { backgroundColor: '#185FA5' }]}>
            <Text style={styles.balanceLabel}>Go Cash Earnings</Text>
            <Text style={styles.balanceAmount}>GH₵ {goCashEarnings.toFixed(2)}</Text>
            {goCashLocked && (
              <View style={styles.lockedBadge}>
                <Text style={styles.lockedText}>🔒 Go Cash locked — settle commission first</Text>
              </View>
            )}
          </View>

          {goCashLocked || commissionOwed > 0 ? (
            <View style={styles.section}>
              <Text style={styles.warningText}>
                Your Go Cash earnings are locked. Please settle your commission of GH₵ {commissionOwed.toFixed(2)} via the Wallet tab to unlock withdrawals.
              </Text>
            </View>
          ) : (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Withdraw to Mobile Money</Text>
              <View style={styles.networkRow}>
                {PROVIDERS.map((p) => (
                  <TouchableOpacity
                    key={p}
                    style={[
                      styles.networkBtn,
                      withdrawNetwork === p && { backgroundColor: PROVIDER_COLORS[p], borderColor: PROVIDER_COLORS[p] },
                    ]}
                    onPress={() => setWithdrawNetwork(p)}
                  >
                    <Text style={[styles.networkBtnText, withdrawNetwork === p && styles.networkBtnTextActive]}>
                      {PROVIDER_LABELS[p]}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TextInput
                style={styles.input}
                placeholder="Phone number (e.g. 024XXXXXXX)"
                keyboardType="phone-pad"
                value={withdrawPhone}
                onChangeText={setWithdrawPhone}
                placeholderTextColor={theme.placeholder}
              />
              <TextInput
                style={styles.input}
                placeholder="Enter amount (GH₵)"
                keyboardType="numeric"
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                placeholderTextColor={theme.placeholder}
              />
              <View style={styles.quickAmounts}>
                {[20, 50, 100, 200].map((amt) => (
                  <TouchableOpacity
                    key={amt}
                    style={[styles.quickBtn, { borderColor: '#185FA5' }]}
                    onPress={() => setWithdrawAmount(String(Math.min(amt, goCashEarnings)))}
                  >
                    <Text style={[styles.quickBtnText, { color: '#185FA5' }]}>GH₵ {amt}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={[styles.actionButton, styles.goCashButton, submitting && styles.buttonDisabled]}
                onPress={handleWithdraw}
                disabled={submitting}
              >
                {submitting ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.actionButtonText}>Withdraw Go Cash</Text>
                )}
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>
      )}

      {/* HISTORY TAB */}
      {activeTab === 'history' && (
        <ScrollView
          style={styles.content}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ flexGrow: 1, paddingBottom: Math.max(insets.bottom + 16, 32) }}
        >
          {transactions.length === 0 ? (
            <Text style={styles.emptyText}>No transactions yet.</Text>
          ) : (
            transactions.map((txn) => (
              <View key={txn.id} style={styles.txnRow}>
                <Text style={styles.txnIcon}>{txnIcon(txn.type)}</Text>
                <View style={styles.txnDetails}>
                  <Text style={styles.txnDescription}>{txn.description || txn.type}</Text>
                  <Text style={styles.txnDate}>{formatDate(txn.created_at)}</Text>
                </View>
                <Text style={[styles.txnAmount, { color: txnColor(txn.type) }]}>
                  {txn.type === 'topup' || txn.type === 'refund' || txn.type === 'earning' ? '+' : '-'}GH₵ {(txn.amount || 0).toFixed(2)}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      )}
      </KeyboardAvoidingView>

      {/* Paystack payment modal — PaystackProvider lives here so the WebView stays in-app */}
      <Modal visible={showPaystack} animationType="slide" transparent={false}>
        <SafeAreaView style={{ flex: 1, backgroundColor: '#fff' }}>
          <TouchableOpacity onPress={() => setShowPaystack(false)} style={styles.modalClose}>
            <Text style={styles.modalCloseText}>✕ Close</Text>
          </TouchableOpacity>
          {showPaystack && paystackParams && (
            <PaystackProvider
              publicKey={PAYSTACK_PUBLIC_KEY}
              currency="GHS"
              defaultChannels={['mobile_money']}
            >
              <PaystackAutoCheckout params={paystackParams} />
            </PaystackProvider>
          )}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: c.background },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 8, paddingVertical: 12, borderBottomWidth: 0.5, borderBottomColor: c.border, backgroundColor: c.card },
  headerBtn: { width: 48, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerTitle: { fontSize: 18, fontWeight: '700', color: c.text },
  tabs: { flexDirection: 'row', backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: c.green },
  tabText: { fontSize: 14, fontWeight: '600', color: c.textSecondary },
  tabTextActive: { color: c.green },
  content: { flex: 1 },
  balanceCard: { backgroundColor: c.green, margin: 16, borderRadius: 16, padding: 24, alignItems: 'center' },
  balanceLabel: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginBottom: 8 },
  balanceAmount: { fontSize: 36, fontWeight: 'bold', color: '#fff' },
  lockedBadge: { marginTop: 12, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  lockedText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  commissionCard: { backgroundColor: '#FFE5E5', margin: 16, marginTop: 0, borderRadius: 12, padding: 16, borderLeftWidth: 4, borderLeftColor: '#FF3B30' },
  commissionLabel: { fontSize: 13, color: '#FF3B30', fontWeight: '600', marginBottom: 4 },
  commissionAmount: { fontSize: 24, fontWeight: 'bold', color: '#FF3B30', marginBottom: 6 },
  commissionNote: { fontSize: 12, color: '#CC2200', lineHeight: 18 },
  section: { backgroundColor: c.card, margin: 16, marginTop: 0, borderRadius: 12, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: c.text, marginBottom: 14 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: c.text, backgroundColor: c.input, marginBottom: 12 },
  quickAmounts: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  quickBtn: { flex: 1, borderWidth: 1, borderColor: c.green, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  quickBtnText: { fontSize: 13, fontWeight: '600', color: c.green },
  actionButton: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  walletButton: { backgroundColor: c.green },
  goCashButton: { backgroundColor: '#185FA5' },
  buttonDisabled: { opacity: 0.6 },
  actionButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  networkRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 8 },
  networkBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: c.border, alignItems: 'center', backgroundColor: c.card },
  networkBtnText: { fontSize: 13, fontWeight: '600', color: c.textSecondary },
  networkBtnTextActive: { color: '#fff' },
  paystackNote: { textAlign: 'center', color: c.textSecondary, fontSize: 11, marginTop: 10 },
  warningText: { fontSize: 14, color: c.textSecondary, lineHeight: 22, textAlign: 'center', padding: 8 },
  emptyText: { textAlign: 'center', color: c.textSecondary, fontSize: 14, marginTop: 40 },
  txnRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, marginHorizontal: 16, marginTop: 8, borderRadius: 10, padding: 14 },
  txnIcon: { fontSize: 22, marginRight: 12 },
  txnDetails: { flex: 1 },
  txnDescription: { fontSize: 14, fontWeight: '600', color: c.text, marginBottom: 3 },
  txnDate: { fontSize: 12, color: c.textSecondary },
  txnAmount: { fontSize: 15, fontWeight: 'bold' },
  modalClose: { padding: 16, borderBottomWidth: 1, borderBottomColor: c.border },
  modalCloseText: { fontSize: 16, color: c.text, fontWeight: '600' },
  });
}
