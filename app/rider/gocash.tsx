import { supabase } from '@/lib/supabase';
import { useRouter } from 'expo-router';
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

export default function GoCashScreen() {
  const router = useRouter();
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [topUpAmount, setTopUpAmount] = useState('');
  const [topping, setTopping] = useState(false);

  useEffect(() => {
    fetchWallet();
  }, []);

  const fetchWallet = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: profile } = await supabase
        .from('profiles')
        .select('go_cash_balance')
        .eq('id', user.id)
        .single();
      if (profile) setBalance(profile.go_cash_balance || 0);
      const { data: txns } = await supabase
        .from('go_cash_transactions')
        .select('*')
        .eq('rider_id', user.id)
        .order('created_at', { ascending: false })
        .limit(20);
      if (txns) setTransactions(txns);
    } catch (error) {
      console.error('Error fetching wallet:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleTopUp = async () => {
    const amount = parseFloat(topUpAmount);
    if (!amount || amount < 1) {
      Alert.alert('Invalid Amount', 'Please enter a valid amount of at least GHS 1.');
      return;
    }
    setTopping(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error: balanceError } = await supabase
        .from('profiles')
        .update({ go_cash_balance: balance + amount })
        .eq('id', user.id);
      if (balanceError) { Alert.alert('Error', balanceError.message); return; }
      await supabase.from('go_cash_transactions').insert([{
        rider_id: user.id,
        amount: amount,
        type: 'topup',
        description: 'Top up via MoMo',
        created_at: new Date().toISOString(),
      }]);
      setBalance(prev => prev + amount);
      setTopUpAmount('');
      Alert.alert('Success!', `GHS ${amount.toFixed(2)} added to your Go Cash wallet!`);
      fetchWallet();
    } catch (error) {
      Alert.alert('Error', 'Could not top up wallet.');
    } finally {
      setTopping(false);
    }
  };

  const getTransactionColor = (type: string) => {
    if (type === 'topup') return '#1D9E75';
    if (type === 'payment') return '#FF3B30';
    return '#185FA5';
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    {loading ? (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#1D9E75" />
      </View>
    ) : (
    <ScrollView style={styles.container}>
      <View style={styles.walletCard}>
        <Text style={styles.walletLabel}>Go Cash Balance</Text>
        <Text style={styles.walletBalance}>GHS {balance.toFixed(2)}</Text>
        <Text style={styles.walletSub}>Available for rides</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Top Up Wallet</Text>
        <View style={styles.topUpRow}>
          <TextInput
            style={styles.topUpInput}
            placeholder="Enter amount (GHS)"
            value={topUpAmount}
            onChangeText={setTopUpAmount}
            keyboardType="numeric"
            placeholderTextColor="#999"
          />
          <TouchableOpacity
            style={[styles.topUpButton, topping && styles.buttonDisabled]}
            onPress={handleTopUp}
            disabled={topping}
          >
            {topping ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Text style={styles.topUpButtonText}>Add</Text>
            )}
          </TouchableOpacity>
        </View>
        <View style={styles.quickAmounts}>
          {['10', '20', '50', '100'].map((amt) => (
            <TouchableOpacity
              key={amt}
              style={styles.quickAmount}
              onPress={() => setTopUpAmount(amt)}
            >
              <Text style={styles.quickAmountText}>GHS {amt}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transaction History</Text>
        {transactions.length === 0 ? (
          <Text style={styles.emptyText}>No transactions yet</Text>
        ) : (
          transactions.map((txn) => (
            <View key={txn.id} style={styles.txnRow}>
              <View style={styles.txnDetails}>
                <Text style={styles.txnDescription}>{txn.description}</Text>
                <Text style={styles.txnDate}>{new Date(txn.created_at).toLocaleDateString()}</Text>
              </View>
              <Text style={[styles.txnAmount, { color: getTransactionColor(txn.type) }]}>
                {txn.type === 'payment' ? '-' : '+'}GHS {Math.abs(txn.amount).toFixed(2)}
              </Text>
            </View>
          ))
        )}
      </View>

      <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
        <Text style={styles.backButtonText}>Back to Home</Text>
      </TouchableOpacity>
    </ScrollView>
    )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#f5f5f5' },
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  walletCard: { backgroundColor: '#1D9E75', margin: 16, borderRadius: 16, padding: 24, alignItems: 'center' },
  walletLabel: { fontSize: 14, color: '#E1F5EE', marginBottom: 8 },
  walletBalance: { fontSize: 42, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  walletSub: { fontSize: 13, color: '#E1F5EE' },
  section: { backgroundColor: '#fff', margin: 16, marginTop: 0, borderRadius: 12, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
  topUpRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  topUpInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, color: '#333' },
  topUpButton: { backgroundColor: '#1D9E75', paddingHorizontal: 20, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  topUpButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  quickAmounts: { flexDirection: 'row', gap: 8 },
  quickAmount: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#1D9E75', alignItems: 'center' },
  quickAmountText: { color: '#1D9E75', fontWeight: '600', fontSize: 13 },
  emptyText: { color: '#999', textAlign: 'center', paddingVertical: 20 },
  txnRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  txnDetails: { flex: 1 },
  txnDescription: { fontSize: 14, color: '#333', fontWeight: '500' },
  txnDate: { fontSize: 12, color: '#999', marginTop: 2 },
  txnAmount: { fontSize: 15, fontWeight: 'bold' },
  backButton: { margin: 16, alignItems: 'center', paddingBottom: 20 },
  backButtonText: { color: '#999', fontSize: 14 },
});
