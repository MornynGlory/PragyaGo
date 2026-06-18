import { supabase } from '@/lib/supabase';
import { MoMoProvider, PROVIDER_COLORS, PROVIDER_LABELS } from '@/lib/paystack';
import { useRouter } from 'expo-router';
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

const PAYSTACK_PUBLIC_KEY = process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY ?? '';
const PROVIDERS: MoMoProvider[] = ['mtn', 'tel', 'atl'];

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

export default function GoCashScreen() {
  const router = useRouter();

  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [showPaystack, setShowPaystack] = useState(false);
  const [paystackParams, setPaystackParams] = useState<any>(null);

  const [topUpAmount, setTopUpAmount] = useState('');
  const [momoPhone, setMomoPhone] = useState('');
  const [provider, setProvider] = useState<MoMoProvider>('mtn');

  // Refs so onSuccess closure always sees latest values
  const userIdRef = useRef('');
  const userEmailRef = useRef('');
  const balanceRef = useRef(0);

  useEffect(() => {
    fetchWallet();
  }, []);

  const fetchWallet = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      userIdRef.current = user.id;
      userEmailRef.current = user.email ?? '';

      const { data: profile } = await supabase
        .from('profiles')
        .select('go_cash_balance, phone')
        .eq('id', user.id)
        .single();

      if (profile) {
        const bal = profile.go_cash_balance ?? 0;
        setBalance(bal);
        balanceRef.current = bal;
        if (profile.phone && !momoPhone) setMomoPhone(profile.phone);
      }

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

  const handleTopUp = () => {
    const amount = parseFloat(topUpAmount);
    if (!amount || amount < 1) {
      Alert.alert('Invalid Amount', 'Please enter at least GHS 1.');
      return;
    }
    if (!momoPhone.trim() || momoPhone.trim().length < 9) {
      Alert.alert('Phone Required', 'Please enter your Mobile Money number (at least 9 digits).');
      return;
    }
    if (!userEmailRef.current) {
      Alert.alert('Error', 'Could not get your email. Please log in again.');
      return;
    }

    // Capture state values at the moment of button press
    const capturedAmount = amount;
    const capturedProvider = provider;
    const capturedPhone = momoPhone.trim();
    const reference = `GOCASH_${userIdRef.current.slice(0, 8)}_${Date.now()}`;

    setPaystackParams({
      email: userEmailRef.current,
      amount: capturedAmount, // GHS — Paystack GHS uses cedis, not pesewas
      reference,
      metadata: {
        mobile_money_phone: capturedPhone,
        mobile_money_provider: capturedProvider,
      },
      onSuccess: async (response: any) => {
        const txRef = response.reference ?? reference;
        const newBalance = balanceRef.current + capturedAmount;

        setShowPaystack(false);
        setProcessing(true);
        try {
          await supabase
            .from('profiles')
            .update({ go_cash_balance: newBalance })
            .eq('id', userIdRef.current);

          await supabase.from('payments').insert({
            user_id: userIdRef.current,
            reference: txRef,
            amount: capturedAmount,
            provider: PROVIDER_LABELS[capturedProvider],
            phone: capturedPhone,
            type: 'go_cash_topup',
            status: 'success',
            created_at: new Date().toISOString(),
          });

          await supabase.from('go_cash_transactions').insert({
            rider_id: userIdRef.current,
            amount: capturedAmount,
            type: 'topup',
            description: `Top up via ${PROVIDER_LABELS[capturedProvider]} MoMo`,
            reference: txRef,
            created_at: new Date().toISOString(),
          });

          balanceRef.current = newBalance;
          setBalance(newBalance);
          setTopUpAmount('');
          Alert.alert('Top Up Successful!', `GHS ${capturedAmount.toFixed(2)} added to your Go Cash wallet.`);
          fetchWallet();
        } catch {
          Alert.alert(
            'Balance Update Error',
            `Payment received (ref: ${txRef}) but balance update failed. Please contact support.`,
          );
        } finally {
          setProcessing(false);
        }
      },
      onCancel: () => setShowPaystack(false),
    });

    setShowPaystack(true);
  };

  const txnColor = (type: string) => {
    if (type === 'topup') return '#1D9E75';
    if (type === 'payment') return '#FF3B30';
    return '#185FA5';
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1D9E75" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <ScrollView style={styles.container}>
        {/* Balance Card */}
        <View style={styles.walletCard}>
          <Text style={styles.walletLabel}>Go Cash Balance</Text>
          <Text style={styles.walletBalance}>GHS {balance.toFixed(2)}</Text>
          <Text style={styles.walletSub}>Available for rides</Text>
        </View>

        {/* Top Up Section */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Top Up via Mobile Money</Text>

          <Text style={styles.fieldLabel}>Network</Text>
          <View style={styles.networkRow}>
            {PROVIDERS.map((p) => (
              <TouchableOpacity
                key={p}
                style={[
                  styles.networkBtn,
                  provider === p && { backgroundColor: PROVIDER_COLORS[p], borderColor: PROVIDER_COLORS[p] },
                ]}
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
            placeholderTextColor="#999"
          />

          <Text style={styles.fieldLabel}>Amount (GHS)</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter amount"
            value={topUpAmount}
            onChangeText={setTopUpAmount}
            keyboardType="numeric"
            placeholderTextColor="#999"
          />
          {[['1', '2', '5'], ['10', '20', '50', '100']].map((row, ri) => (
            <View key={ri} style={[styles.quickAmounts, ri === 0 && { marginBottom: 8 }]}>
              {row.map((amt) => (
                <TouchableOpacity key={amt} style={styles.quickAmount} onPress={() => setTopUpAmount(amt)}>
                  <Text style={styles.quickAmountText}>GHS {amt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          ))}

          <TouchableOpacity
            style={[styles.payButton, processing && styles.buttonDisabled]}
            onPress={handleTopUp}
            disabled={processing}
          >
            {processing ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.payButtonText}>
                Pay GHS {parseFloat(topUpAmount || '0').toFixed(2)} via {PROVIDER_LABELS[provider]}
              </Text>
            )}
          </TouchableOpacity>
          <Text style={styles.paystackNote}>Secured by Paystack</Text>
        </View>

        {/* Transaction History */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Transaction History</Text>
          {transactions.length === 0 ? (
            <Text style={styles.emptyText}>No transactions yet</Text>
          ) : (
            transactions.map((txn) => (
              <View key={txn.id} style={styles.txnRow}>
                <View style={styles.txnDetails}>
                  <Text style={styles.txnDescription}>{txn.description}</Text>
                  <Text style={styles.txnDate}>
                    {new Date(txn.created_at).toLocaleDateString('en-GB', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                    })}
                  </Text>
                </View>
                <Text style={[styles.txnAmount, { color: txnColor(txn.type) }]}>
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
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  walletCard: { backgroundColor: '#1D9E75', margin: 16, borderRadius: 16, padding: 24, alignItems: 'center' },
  walletLabel: { fontSize: 14, color: '#E1F5EE', marginBottom: 8 },
  walletBalance: { fontSize: 42, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  walletSub: { fontSize: 13, color: '#E1F5EE' },
  section: { backgroundColor: '#fff', margin: 16, marginTop: 0, borderRadius: 12, padding: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 14 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: '#555', marginBottom: 8 },
  networkRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  networkBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1.5, borderColor: '#ddd', alignItems: 'center', backgroundColor: '#fff' },
  networkBtnText: { fontSize: 13, fontWeight: '600', color: '#555' },
  networkBtnTextActive: { color: '#fff' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15, color: '#333', backgroundColor: '#f9f9f9', marginBottom: 14 },
  quickAmounts: { flexDirection: 'row', gap: 8, marginBottom: 14, flexWrap: 'nowrap' },
  quickAmount: { flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#1D9E75', alignItems: 'center' },
  quickAmountText: { color: '#1D9E75', fontWeight: '600', fontSize: 13 },
  payButton: { backgroundColor: '#1D9E75', paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  payButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 15 },
  paystackNote: { textAlign: 'center', color: '#aaa', fontSize: 11, marginTop: 10 },
  emptyText: { color: '#999', textAlign: 'center', paddingVertical: 20 },
  txnRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  txnDetails: { flex: 1 },
  txnDescription: { fontSize: 14, color: '#333', fontWeight: '500' },
  txnDate: { fontSize: 12, color: '#999', marginTop: 2 },
  txnAmount: { fontSize: 15, fontWeight: 'bold' },
  backButton: { margin: 16, alignItems: 'center', paddingBottom: 20 },
  backButtonText: { color: '#999', fontSize: 14 },
  modalClose: { padding: 16, borderBottomWidth: 1, borderBottomColor: '#eee' },
  modalCloseText: { fontSize: 16, color: '#333', fontWeight: '600' },
});
