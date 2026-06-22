import { supabase } from '@/lib/supabase';
import { MoMoProvider, PROVIDER_COLORS, PROVIDER_LABELS } from '@/lib/paystack';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PaystackProvider, usePaystack } from 'react-native-paystack-webview';

const COMMISSION_RATE = 0.15;
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
    loadData();
  }, []);

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

      const dbCommission = driver.commission_owed ?? 0;
      const dbLocked = driver.is_locked || false;
      setCommissionOwed(dbCommission);
      // Repair stale is_locked: lock is only valid when commission_owed > 0
      if (dbLocked && dbCommission === 0) {
        await supabase.from('drivers').update({ is_locked: false }).eq('id', driver.id);
        setIsLocked(false);
      } else {
        setIsLocked(dbLocked);
      }

      await checkMidnightLock(driver);

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

  const checkMidnightLock = async (driver: any) => {
    if (!driver.last_commission_date || !(driver.go_cash_earnings > 0)) return;
    const lastDate = new Date(driver.last_commission_date).toISOString().split('T')[0];
    const today = new Date().toISOString().split('T')[0];
    if (lastDate < today && !driver.go_cash_locked) {
      await supabase.from('drivers').update({ go_cash_locked: true }).eq('id', driver.id);
      setGoCashLocked(true);
    }
  };

  const handleTopUp = () => {
    const amount = parseFloat(topUpAmount);
    if (!amount || amount < 1) {
      Alert.alert('Invalid Amount', 'Minimum top up is GHS 1.');
      return;
    }
    if (!topUpPhone.trim() || topUpPhone.trim().length < 9) {
      Alert.alert('Phone Required', 'Please enter your Mobile Money phone number.');
      return;
    }
    if (!driverId || !userEmail) return;

    // Capture all current state values before Paystack opens
    const capturedDriverId = driverId;
    const capturedAmount = amount;
    const capturedProvider = topUpProvider;
    const capturedPhone = topUpPhone.trim();
    const capturedWalletBalance = walletBalance;
    const capturedCommissionOwed = commissionOwed;
    const capturedIsLocked = isLocked;
    const capturedGoCashEarnings = goCashEarnings;
    const reference = `WALLET_${driverId.slice(0, 8)}_${Date.now()}`;

    setPaystackParams({
      email: userEmail,
      amount: capturedAmount, // GHS — Paystack GHS uses cedis, not pesewas
      reference,
      metadata: {
        mobile_money_phone: capturedPhone,
        mobile_money_provider: capturedProvider,
      },
      onSuccess: async (response: any) => {
        const txRef = response.reference ?? reference;
        const newBalance = capturedWalletBalance + capturedAmount;

        setShowPaystack(false);
        setSubmitting(true);
        try {
          await supabase
            .from('drivers')
            .update({ wallet_balance: newBalance })
            .eq('id', capturedDriverId);

          await supabase.from('payments').insert({
            user_id: userIdRef.current,
            reference: txRef,
            amount: capturedAmount,
            provider: PROVIDER_LABELS[capturedProvider],
            phone: capturedPhone,
            type: 'wallet_topup',
            status: 'success',
            created_at: new Date().toISOString(),
          });

          await supabase.from('driver_wallet_transactions').insert({
            driver_id: capturedDriverId,
            type: 'topup',
            amount: capturedAmount,
            description: `${PROVIDER_LABELS[capturedProvider]} MoMo top up of GHS ${capturedAmount.toFixed(2)}`,
            reference: txRef,
            created_at: new Date().toISOString(),
          });

          // Auto-deduct commission if the new balance covers it
          let finalBalance = newBalance;
          let finalCommission = capturedCommissionOwed;
          let finalLocked = capturedIsLocked;

          if (capturedCommissionOwed > 0 && newBalance >= capturedCommissionOwed) {
            const deduction = capturedCommissionOwed;
            let goCashDeduction = 0;
            let walletDeduction = deduction;
            if (capturedGoCashEarnings > 0) {
              goCashDeduction = Math.min(capturedGoCashEarnings, deduction);
              walletDeduction = deduction - goCashDeduction;
            }
            finalBalance -= walletDeduction;
            finalCommission = 0;
            finalLocked = false;

            await supabase.from('driver_wallet_transactions').insert({
              driver_id: capturedDriverId,
              type: 'commission_deduction',
              amount: deduction,
              description: `Commission deducted automatically (${(COMMISSION_RATE * 100).toFixed(0)}%)`,
              created_at: new Date().toISOString(),
            });

            const updates: any = { wallet_balance: finalBalance, commission_owed: 0, is_locked: false };
            if (goCashDeduction > 0) {
              const newGoCash = capturedGoCashEarnings - goCashDeduction;
              updates.go_cash_earnings = newGoCash;
              updates.go_cash_locked = false;
              setGoCashEarnings(newGoCash);
              setGoCashLocked(false);
            }
            await supabase.from('drivers').update(updates).eq('id', capturedDriverId);

            Alert.alert(
              'Top Up Successful!',
              `GHS ${capturedAmount.toFixed(2)} added. Commission of GHS ${deduction.toFixed(2)} auto-deducted. Wallet unlocked!`,
            );
          } else {
            Alert.alert('Top Up Successful!', `GHS ${capturedAmount.toFixed(2)} added to your wallet.`);
          }

          setWalletBalance(finalBalance);
          setCommissionOwed(finalCommission);
          setIsLocked(finalLocked);
          setTopUpAmount('');
          await refreshTransactions(capturedDriverId);
        } catch {
          Alert.alert(
            'Balance Update Error',
            `Payment received (ref: ${txRef}) but balance update failed. Please contact support.`,
          );
        } finally {
          setSubmitting(false);
        }
      },
      onCancel: () => setShowPaystack(false),
    });

    setShowPaystack(true);
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) { Alert.alert('Invalid Amount', 'Please enter a valid amount.'); return; }
    if (amount > goCashEarnings) {
      Alert.alert('Insufficient Balance', `Maximum withdrawal is GHS ${goCashEarnings.toFixed(2)}.`);
      return;
    }
    if (!withdrawPhone.trim()) { Alert.alert('Phone Required', 'Please enter your Mobile Money number.'); return; }
    if (commissionOwed > 0) { Alert.alert('Commission Owed', 'Please settle your commission before withdrawing.'); return; }
    if (!driverId) return;

    setSubmitting(true);
    try {
      await supabase.from('driver_withdrawals').insert([{
        driver_id: driverId,
        amount,
        phone: withdrawPhone.trim(),
        network: PROVIDER_LABELS[withdrawNetwork],
        status: 'pending',
        created_at: new Date().toISOString(),
      }]);

      const newGoCash = goCashEarnings - amount;
      await supabase.from('drivers').update({ go_cash_earnings: newGoCash }).eq('id', driverId);
      setGoCashEarnings(newGoCash);
      setWithdrawAmount('');
      Alert.alert(
        'Withdrawal Submitted',
        `GHS ${amount.toFixed(2)} withdrawal to ${withdrawPhone} (${PROVIDER_LABELS[withdrawNetwork]}) submitted. Will be processed within 24 hours.`,
      );
    } catch {
      Alert.alert('Error', 'Withdrawal failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const refreshTransactions = async (id: string) => {
    const { data: txns } = await supabase
      .from('driver_wallet_transactions')
      .select('*')
      .eq('driver_id', id)
      .order('created_at', { ascending: false });
    if (txns) setTransactions(txns);
  };

  const txnIcon = (type: string) => {
    if (type === 'topup') return '⬆️';
    if (type === 'commission_deduction') return '💸';
    return '↩️';
  };

  const txnColor = (type: string) => {
    if (type === 'topup') return '#1D9E75';
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
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1D9E75" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
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
        <ScrollView style={styles.content}>
          <View style={styles.balanceCard}>
            <Text style={styles.balanceLabel}>Wallet Balance</Text>
            <Text style={styles.balanceAmount}>GHS {walletBalance.toFixed(2)}</Text>
            {isLocked && commissionOwed > 0 && (
              <View style={styles.lockedBadge}>
                <Text style={styles.lockedText}>🔒 App locked — pay commission to unlock</Text>
              </View>
            )}
          </View>

          {commissionOwed > 0 && (
            <View style={styles.commissionCard}>
              <Text style={styles.commissionLabel}>Commission Owed</Text>
              <Text style={styles.commissionAmount}>GHS {commissionOwed.toFixed(2)}</Text>
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
              placeholderTextColor="#999"
            />

            <Text style={styles.fieldLabel}>Amount (GHS)</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter amount"
              keyboardType="numeric"
              value={topUpAmount}
              onChangeText={setTopUpAmount}
              placeholderTextColor="#999"
            />
            {[[1, 2, 5], [10, 20, 50, 100]].map((row, ri) => (
              <View key={ri} style={[styles.quickAmounts, ri === 0 && { marginBottom: 8 }]}>
                {row.map((amt) => (
                  <TouchableOpacity key={amt} style={styles.quickBtn} onPress={() => setTopUpAmount(String(amt))}>
                    <Text style={styles.quickBtnText}>GHS {amt}</Text>
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
                  Pay GHS {parseFloat(topUpAmount || '0').toFixed(2)} via {PROVIDER_LABELS[topUpProvider]}
                </Text>
              )}
            </TouchableOpacity>
            <Text style={styles.paystackNote}>Secured by Paystack</Text>
          </View>
        </ScrollView>
      )}

      {/* GO CASH TAB */}
      {activeTab === 'gocash' && (
        <ScrollView style={styles.content}>
          <View style={[styles.balanceCard, { backgroundColor: '#185FA5' }]}>
            <Text style={styles.balanceLabel}>Go Cash Earnings</Text>
            <Text style={styles.balanceAmount}>GHS {goCashEarnings.toFixed(2)}</Text>
            {goCashLocked && (
              <View style={styles.lockedBadge}>
                <Text style={styles.lockedText}>🔒 Go Cash locked — settle commission first</Text>
              </View>
            )}
          </View>

          {goCashLocked || commissionOwed > 0 ? (
            <View style={styles.section}>
              <Text style={styles.warningText}>
                Your Go Cash earnings are locked. Please settle your commission of GHS {commissionOwed.toFixed(2)} via the Wallet tab to unlock withdrawals.
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
                placeholderTextColor="#999"
              />
              <TextInput
                style={styles.input}
                placeholder="Enter amount (GHS)"
                keyboardType="numeric"
                value={withdrawAmount}
                onChangeText={setWithdrawAmount}
                placeholderTextColor="#999"
              />
              <View style={styles.quickAmounts}>
                {[20, 50, 100, 200].map((amt) => (
                  <TouchableOpacity
                    key={amt}
                    style={[styles.quickBtn, { borderColor: '#185FA5' }]}
                    onPress={() => setWithdrawAmount(String(Math.min(amt, goCashEarnings)))}
                  >
                    <Text style={[styles.quickBtnText, { color: '#185FA5' }]}>GHS {amt}</Text>
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
        <ScrollView style={styles.content}>
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
                  {txn.type === 'topup' || txn.type === 'refund' ? '+' : '-'}GHS {(txn.amount || 0).toFixed(2)}
                </Text>
              </View>
            ))
          )}
        </ScrollView>
      )}

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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f5f5' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  tabs: { flexDirection: 'row', backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#eee' },
  tab: { flex: 1, paddingVertical: 12, alignItems: 'center' },
  tabActive: { borderBottomWidth: 2, borderBottomColor: '#1D9E75' },
  tabText: { fontSize: 14, fontWeight: '600', color: '#999' },
  tabTextActive: { color: '#1D9E75' },
  content: { flex: 1 },
  balanceCard: { backgroundColor: '#1D9E75', margin: 16, borderRadius: 16, padding: 24, alignItems: 'center' },
  balanceLabel: { fontSize: 14, color: 'rgba(255,255,255,0.8)', marginBottom: 8 },
  balanceAmount: { fontSize: 36, fontWeight: 'bold', color: '#fff' },
  lockedBadge: { marginTop: 12, backgroundColor: 'rgba(0,0,0,0.2)', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 6 },
  lockedText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  commissionCard: { backgroundColor: '#FFE5E5', margin: 16, marginTop: 0, borderRadius: 12, padding: 16, borderLeftWidth: 4, borderLeftColor: '#FF3B30' },
  commissionLabel: { fontSize: 13, color: '#FF3B30', fontWeight: '600', marginBottom: 4 },
  commissionAmount: { fontSize: 24, fontWeight: 'bold', color: '#FF3B30', marginBottom: 6 },
  commissionNote: { fontSize: 12, color: '#CC2200', lineHeight: 18 },
  section: { backgroundColor: '#fff', margin: 16, marginTop: 0, borderRadius: 12, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 14 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, color: '#333', backgroundColor: '#f9f9f9', marginBottom: 12 },
  quickAmounts: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  quickBtn: { flex: 1, borderWidth: 1, borderColor: '#1D9E75', borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  quickBtnText: { fontSize: 13, fontWeight: '600', color: '#1D9E75' },
  actionButton: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  walletButton: { backgroundColor: '#1D9E75' },
  goCashButton: { backgroundColor: '#185FA5' },
  buttonDisabled: { opacity: 0.6 },
  actionButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  networkRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 8 },
  networkBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: '#ddd', alignItems: 'center', backgroundColor: '#fff' },
  networkBtnText: { fontSize: 13, fontWeight: '600', color: '#666' },
  networkBtnTextActive: { color: '#fff' },
  paystackNote: { textAlign: 'center', color: '#aaa', fontSize: 11, marginTop: 10 },
  warningText: { fontSize: 14, color: '#666', lineHeight: 22, textAlign: 'center', padding: 8 },
  emptyText: { textAlign: 'center', color: '#999', fontSize: 14, marginTop: 40 },
  txnRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 16, marginTop: 8, borderRadius: 10, padding: 14 },
  txnIcon: { fontSize: 22, marginRight: 12 },
  txnDetails: { flex: 1 },
  txnDescription: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 3 },
  txnDate: { fontSize: 12, color: '#999' },
  txnAmount: { fontSize: 15, fontWeight: 'bold' },
  modalClose: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  modalCloseText: { fontSize: 16, color: '#333', fontWeight: '600' },
});
