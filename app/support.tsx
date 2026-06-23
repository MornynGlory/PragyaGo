import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const CATEGORIES = ['Payment Issue', 'Driver Complaint', 'App Problem', 'Fare Dispute', 'Account Issue', 'Other'];

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open:        { bg: '#FEF3C7', text: '#92400E' },
  in_progress: { bg: '#DBEAFE', text: '#1E40AF' },
  resolved:    { bg: '#D1FAE5', text: '#065F46' },
  closed:      { bg: '#F3F4F6', text: '#4B5563' },
};

export default function SupportScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [category, setCategory] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    fetchTickets();
  }, []);

  const fetchTickets = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }
      setUserId(user.id);
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (!error) setTickets(data ?? []);
    } catch (err) {
      console.error('Error fetching tickets:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!category) { Alert.alert('Validation', 'Please select a category'); return; }
    if (!subject.trim()) { Alert.alert('Validation', 'Please enter a subject'); return; }
    if (!message.trim()) { Alert.alert('Validation', 'Please describe your issue'); return; }
    if (!userId) { Alert.alert('Error', 'Please log in again'); return; }

    setSubmitting(true);
    try {
      const { error } = await supabase.from('support_tickets').insert([{
        user_id: userId,
        category,
        subject: subject.trim(),
        message: message.trim(),
        status: 'open',
        created_at: new Date().toISOString(),
      }]);
      if (error) { Alert.alert('Error', error.message); return; }
      Alert.alert('Submitted!', 'Your support ticket has been submitted. We\'ll get back to you soon.');
      setShowModal(false);
      setCategory(''); setSubject(''); setMessage('');
      fetchTickets();
    } catch (err) {
      Alert.alert('Error', 'Failed to submit ticket. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const statusLabel = (status: string) => {
    if (status === 'in_progress') return 'In Progress';
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Help & Support</Text>
        <TouchableOpacity style={styles.newButton} onPress={() => setShowModal(true)}>
          <Text style={styles.newButtonText}>+ New</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator size="large" color="#1D9E75" /></View>
      ) : tickets.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyIcon}>🎧</Text>
          <Text style={styles.emptyTitle}>No tickets yet</Text>
          <Text style={styles.emptySubtitle}>Tap "+ New" to submit a support request</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {tickets.map((ticket) => {
            const ticketColors = STATUS_COLORS[ticket.status] ?? STATUS_COLORS.closed;
            return (
              <View key={ticket.id} style={styles.ticketCard}>
                <View style={styles.ticketTop}>
                  <Text style={styles.ticketSubject} numberOfLines={1}>{ticket.subject}</Text>
                  <View style={[styles.statusBadge, { backgroundColor: ticketColors.bg }]}>
                    <Text style={[styles.statusText, { color: ticketColors.text }]}>{statusLabel(ticket.status)}</Text>
                  </View>
                </View>
                <Text style={styles.ticketCategory}>{ticket.category}</Text>
                <Text style={styles.ticketMessage} numberOfLines={2}>{ticket.message}</Text>
                <Text style={styles.ticketDate}>{formatDate(ticket.created_at)}</Text>
                {ticket.admin_reply && (
                  <View style={styles.replyBox}>
                    <Text style={styles.replyLabel}>Support reply:</Text>
                    <Text style={styles.replyText}>{ticket.admin_reply}</Text>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={showModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>New Support Ticket</Text>
              <TouchableOpacity onPress={() => { setShowModal(false); setCategory(''); setSubject(''); setMessage(''); }}>
                <Text style={styles.modalClose}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.fieldLabel}>Category *</Text>
              <View style={styles.categoryGrid}>
                {CATEGORIES.map((cat) => (
                  <Pressable
                    key={cat}
                    style={[styles.categoryChip, category === cat && styles.categoryChipActive]}
                    onPress={() => setCategory(cat)}
                  >
                    <Text style={[styles.categoryChipText, category === cat && styles.categoryChipTextActive]}>
                      {cat}
                    </Text>
                  </Pressable>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Subject *</Text>
              <TextInput
                style={styles.input}
                placeholder="Brief description of your issue"
                value={subject}
                onChangeText={setSubject}
                placeholderTextColor={colors.subtext}
                editable={!submitting}
              />

              <Text style={styles.fieldLabel}>Message *</Text>
              <TextInput
                style={[styles.input, styles.messageInput]}
                placeholder="Describe your issue in detail..."
                value={message}
                onChangeText={setMessage}
                multiline
                numberOfLines={5}
                textAlignVertical="top"
                placeholderTextColor={colors.subtext}
                editable={!submitting}
              />

              <TouchableOpacity
                style={[styles.submitButton, submitting && styles.buttonDisabled]}
                onPress={handleSubmit}
                disabled={submitting}
              >
                {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Submit Ticket</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: c.card, borderBottomWidth: 1, borderBottomColor: c.border },
    headerTitle: { fontSize: 18, fontWeight: '700', color: '#1D9E75' },
    newButton: { backgroundColor: '#1D9E75', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 8 },
    newButtonText: { color: '#fff', fontWeight: '600', fontSize: 14 },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 60 },
    emptyIcon: { fontSize: 48, marginBottom: 12 },
    emptyTitle: { fontSize: 18, fontWeight: '600', color: c.text, marginBottom: 6 },
    emptySubtitle: { fontSize: 14, color: c.subtext, textAlign: 'center' },
    list: { padding: 16, gap: 12 },
    ticketCard: { backgroundColor: c.card, borderRadius: 12, padding: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    ticketTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
    ticketSubject: { fontSize: 15, fontWeight: '600', color: c.text, flex: 1, marginRight: 8 },
    statusBadge: { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
    statusText: { fontSize: 11, fontWeight: '700' },
    ticketCategory: { fontSize: 12, color: '#1D9E75', fontWeight: '600', marginBottom: 6 },
    ticketMessage: { fontSize: 13, color: c.subtext, lineHeight: 18, marginBottom: 8 },
    ticketDate: { fontSize: 11, color: c.subtext },
    replyBox: { marginTop: 10, backgroundColor: '#F0FDF7', borderRadius: 8, padding: 10, borderLeftWidth: 3, borderLeftColor: '#1D9E75' },
    replyLabel: { fontSize: 11, fontWeight: '700', color: '#1D9E75', marginBottom: 4 },
    replyText: { fontSize: 13, color: c.text, lineHeight: 18 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalCard: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '90%' },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
    modalTitle: { fontSize: 18, fontWeight: '700', color: c.text },
    modalClose: { fontSize: 18, color: c.subtext, paddingHorizontal: 4 },
    fieldLabel: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8, marginTop: 4 },
    categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
    categoryChip: { borderWidth: 1.5, borderColor: c.border, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: c.card },
    categoryChipActive: { borderColor: '#1D9E75', backgroundColor: '#F0FDF7' },
    categoryChipText: { fontSize: 12, color: c.subtext },
    categoryChipTextActive: { color: '#1D9E75', fontWeight: '700' },
    input: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 11, fontSize: 14, color: c.text, backgroundColor: c.inputBg, marginBottom: 14 },
    messageInput: { height: 110, paddingTop: 11 },
    submitButton: { backgroundColor: '#1D9E75', paddingVertical: 14, borderRadius: 8, alignItems: 'center', marginTop: 4, marginBottom: 8 },
    buttonDisabled: { opacity: 0.6 },
    submitButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  });
}
