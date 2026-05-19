import { supabase } from '@/lib/supabase';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const COMMISSION_RATE = 0.15;

type TabName = 'wallet' | 'gocash' | 'history';
type Network = 'MTN' | 'Telecel' | 'AirtelTigo';

export default function DriverWalletScreen() {
  const [activeTab, setActiveTab] = useState<TabName>('wallet');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [driverId, setDriverId] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState(0);
  const [commissionOwed, setCommissionOwed] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [goCashEarnings, setGoCashEarnings] = useState(0);
  const [goCashLocked, setGoCashLocked] = useState(false);

  const [topUpAmount, setTopUpAmount] = useState('');
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawPhone, setWithdrawPhone] = useState('');
  const [withdrawNetwork, setWithdrawNetwork] = useState<Network>('MTN');

  const [transactions, setTransactions] = useState<any[]>([]);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: driver } = await supabase
        .from('drivers')
        .select('*')
        .eq('profile_id', user.id)
        .single();

      if (!driver) return;

      setDriverId(driver.id);
      setWalletBalance(driver.wallet_balance || 0);
      setCommissionOwed(driver.commission_owed || 0);
      setIsLocked(driver.is_locked || false);
      setGoCashEarnings(driver.go_cash_earnings || 0);
      setGoCashLocked(driver.go_cash_locked || false);

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

  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (!amount || amount <= 0) { Alert.alert('Invalid Amount', 'Please enter a valid amount.'); return; }
    if (!driverId) return;
    setSubmitting(true);
    try {
      let newBalance = walletBalance + amount;
      let newCommission = commissionOwed;
      let newLocked = isLocked;

      await supabase.from('driver_wallet_transactions').insert([{
        driver_id: driverId,
        type: 'topup',
        amount,
        description: `Mobile Money top up of GHS ${amount.toFixed(2)}`,
        created_at: new Date().toISOString(),
      }]);

      if (newCommission > 0 && newBalance >= newCommission) {
        const deduction = newCommission;

        // Deduct from go_cash_earnings first if applicable
        let goCashDeduction = 0;
        let walletDeduction = deduction;
        if (goCashEarnings > 0) {
          goCashDeduction = Math.min(goCashEarnings, deduction);
          walletDeduction = deduction - goCashDeduction;
        }

        newBalance -= walletDeduction;
        newCommission = 0;
        newLocked = false;

        await supabase.from('driver_wallet_transactions').insert([{
          driver_id: driverId,
          type: 'commission_deduction',
          amount: deduction,
          description: `Commission deducted automatically (${(COMMISSION_RATE * 100).toFixed(0)}%)`,
          created_at: new Date().toISOString(),
        }]);

        const updates: any = {
          wallet_balance: newBalance,
          commission_owed: 0,
          is_locked: false,
        };
        if (goCashDeduction > 0) {
          const newGoCash = goCashEarnings - goCashDeduction;
          updates.go_cash_earnings = newGoCash;
          updates.go_cash_locked = false;
          setGoCashEarnings(newGoCash);
          setGoCashLocked(false);
        }
        await supabase.from('drivers').update(updates).eq('id', driverId);
        Alert.alert('Top Up Successful', `GHS ${amount.toFixed(2)} added. Commission of GHS ${deduction.toFixed(2)} auto-deducted. Wallet unlocked!`);
      } else {
        await supabase.from('drivers').update({ wallet_balance: newBalance }).eq('id', driverId);
        Alert.alert('Top Up Successful', `GHS ${amount.toFixed(2)} added to your wallet.`);
      }

      setWalletBalance(newBalance);
      setCommissionOwed(newCommission);
      setIsLocked(newLocked);
      setTopUpAmount('');
      await refreshTransactions(driverId);
    } catch (error) {
      Alert.alert('Error', 'Top up failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleWithdraw = async () => {
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0) { Alert.alert('Invalid Amount', 'Please enter a valid amount.'); return; }
    if (amount > goCashEarnings) { Alert.alert('Insufficient Balance', `Maximum withdrawal is GHS ${goCashEarnings.toFixed(2)}.`); return; }
    if (!withdrawPhone.trim()) { Alert.alert('Phone Required', 'Please enter your Mobile Money number.'); return; }
    if (commissionOwed > 0) { Alert.alert('Commission Owed', 'Please settle your commission before withdrawing.'); return; }
    if (!driverId) return;
    setSubmitting(true);
    try {
      await supabase.from('driver_withdrawals').insert([{
        driver_id: driverId,
        amount,
        phone: withdrawPhone.trim(),
        network: withdrawNetwork,
        status: 'pending',
        created_at: new Date().toISOString(),
      }]);

      const newGoCash = goCashEarnings - amount;
      await supabase.from('drivers').update({ go_cash_earnings: newGoCash }).eq('id', driverId);
      setGoCashEarnings(newGoCash);
      setWithdrawAmount('');
      setWithdrawPhone('');
      Alert.alert('Withdrawal Submitted', `GHS ${amount.toFixed(2)} withdrawal to ${withdrawPhone} (${withdrawNetwork}) is pending. You will receive it shortly.`);
    } catch (error) {
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
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
      ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
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
            {isLocked && (
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
            <TextInput
              style={styles.input}
              placeholder="Enter amount (GHS)"
              keyboardType="numeric"
              value={topUpAmount}
              onChangeText={setTopUpAmount}
              placeholderTextColor="#999"
            />
            <View style={styles.quickAmounts}>
              {[10, 20, 50, 100].map((amt) => (
                <TouchableOpacity
                  key={amt}
                  style={styles.quickBtn}
                  onPress={() => setTopUpAmount(String(amt))}
                >
                  <Text style={styles.quickBtnText}>GHS {amt}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={[styles.actionButton, styles.walletButton, submitting && styles.buttonDisabled]}
              onPress={handleTopUp}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionButtonText}>Top Up Wallet</Text>}
            </TouchableOpacity>
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
                {(['MTN', 'Telecel', 'AirtelTigo'] as Network[]).map((net) => (
                  <TouchableOpacity
                    key={net}
                    style={[styles.networkBtn, withdrawNetwork === net && styles.networkBtnActive]}
                    onPress={() => setWithdrawNetwork(net)}
                  >
                    <Text style={[styles.networkBtnText, withdrawNetwork === net && styles.networkBtnTextActive]}>{net}</Text>
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
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.actionButtonText}>Withdraw Go Cash</Text>}
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
  networkBtn: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center', backgroundColor: '#fff' },
  networkBtnActive: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  networkBtnText: { fontSize: 13, fontWeight: '600', color: '#666' },
  networkBtnTextActive: { color: '#fff' },
  warningText: { fontSize: 14, color: '#666', lineHeight: 22, textAlign: 'center', padding: 8 },
  emptyText: { textAlign: 'center', color: '#999', fontSize: 14, marginTop: 40 },
  txnRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 16, marginTop: 8, borderRadius: 10, padding: 14 },
  txnIcon: { fontSize: 22, marginRight: 12 },
  txnDetails: { flex: 1 },
  txnDescription: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 3 },
  txnDate: { fontSize: 12, color: '#999' },
  txnAmount: { fontSize: 15, fontWeight: 'bold' },
});
