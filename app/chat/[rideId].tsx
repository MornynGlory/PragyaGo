import { useTheme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type Message = {
  id: string;
  ride_id: string;
  sender_id: string;
  sender_role: 'rider' | 'driver';
  message: string;
  is_read: boolean;
  created_at: string;
};

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDay(ts: string) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}

function sameDay(a: string, b: string) {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export default function ChatScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const router = useRouter();
  const theme = useTheme();
  const styles = makeStyles(theme);
  const flatListRef = useRef<FlatList>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState('');
  const [senderRole, setSenderRole] = useState<'rider' | 'driver'>('rider');
  const [otherPersonName, setOtherPersonName] = useState('');
  const [otherPersonId, setOtherPersonId] = useState<string | null>(null);
  const [rideEnded, setRideEnded] = useState(false);
  const [sending, setSending] = useState(false);

  const msgChannelRef = useRef<any>(null);
  const rideChannelRef = useRef<any>(null);

  useEffect(() => {
    if (!rideId) return;
    initChat();
    return () => {
      if (msgChannelRef.current) supabase.removeChannel(msgChannelRef.current);
      if (rideChannelRef.current) supabase.removeChannel(rideChannelRef.current);
    };
  }, [rideId]);

  const initChat = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setCurrentUserId(user.id);

    const [{ data: profile }, { data: ride }] = await Promise.all([
      supabase.from('profiles').select('full_name').eq('id', user.id).single(),
      supabase.from('rides').select('rider_id, driver_id, status').eq('id', rideId).single(),
    ]);

    if (profile?.full_name) setCurrentUserName(profile.full_name);
    if (!ride) return;

    const isRider = ride.rider_id === user.id;
    setSenderRole(isRider ? 'rider' : 'driver');

    if (ride.status === 'completed' || ride.status === 'cancelled') setRideEnded(true);

    // Resolve other person's name and profile ID for push notifications
    if (isRider && ride.driver_id) {
      const { data: driver } = await supabase
        .from('drivers')
        .select('profile_id, profiles(full_name)')
        .eq('id', ride.driver_id)
        .single();
      const driverProfile = driver?.profiles as any;
      if (driverProfile?.full_name) setOtherPersonName(driverProfile.full_name);
      if (driver?.profile_id) setOtherPersonId(driver.profile_id);
    } else if (!isRider) {
      setOtherPersonId(ride.rider_id);
      const { data: riderProfile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', ride.rider_id)
        .single();
      if (riderProfile?.full_name) setOtherPersonName(riderProfile.full_name);
    }

    // Load messages
    const { data: existing } = await supabase
      .from('ride_messages')
      .select('*')
      .eq('ride_id', rideId)
      .order('created_at', { ascending: true });
    setMessages(existing || []);

    // Mark received messages as read
    await supabase
      .from('ride_messages')
      .update({ is_read: true })
      .eq('ride_id', rideId)
      .neq('sender_id', user.id);

    // Realtime: new messages
    const msgChannel = supabase
      .channel(`chat:${rideId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'ride_messages',
        filter: `ride_id=eq.${rideId}`,
      }, (payload) => {
        const newMsg = payload.new as Message;
        setMessages((prev) => [...prev, newMsg]);
        if (newMsg.sender_id !== user.id) {
          supabase.from('ride_messages').update({ is_read: true }).eq('id', newMsg.id);
        }
      })
      .subscribe();
    msgChannelRef.current = msgChannel;

    // Realtime: ride status (detect when ride ends)
    const rideChannel = supabase
      .channel(`ride-status-chat:${rideId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rides',
        filter: `id=eq.${rideId}`,
      }, (payload) => {
        const s = payload.new.status;
        if (s === 'completed' || s === 'cancelled') setRideEnded(true);
      })
      .subscribe();
    rideChannelRef.current = rideChannel;
  };

  const sendMessage = async () => {
    if (!input.trim() || !currentUserId || sending) return;
    const text = input.trim();
    setInput('');
    setSending(true);
    try {
      await supabase.from('ride_messages').insert({
        ride_id: rideId,
        sender_id: currentUserId,
        sender_role: senderRole,
        message: text,
        is_read: false,
      });

      // Push notification to other person
      if (otherPersonId && currentUserName) {
        const { data: otherProfile } = await supabase
          .from('profiles')
          .select('expo_push_token')
          .eq('id', otherPersonId)
          .single();
        const token = otherProfile?.expo_push_token;
        if (token) {
          fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to: token,
              title: `New message from ${currentUserName}`,
              body: text,
              data: { rideId, screen: 'chat' },
            }),
          }).catch(() => {});
        }
      }
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), 80);
    }
  }, [messages.length]);

  const initial = otherPersonName ? otherPersonName[0].toUpperCase() : '?';

  const renderItem = ({ item, index }: { item: Message; index: number }) => {
    const isMine = item.sender_id === currentUserId;
    const prev = index > 0 ? messages[index - 1] : null;
    const showDate = !prev || !sameDay(prev.created_at, item.created_at);

    return (
      <>
        {showDate ? (
          <View style={styles.dateSep}>
            <Text style={styles.dateSepText}>{formatDay(item.created_at)}</Text>
          </View>
        ) : null}
        <View style={[styles.msgRow, isMine ? styles.msgRowMine : styles.msgRowTheirs]}>
          {!isMine ? (
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
          ) : null}
          <View style={[styles.bubble, isMine ? styles.bubbleMine : styles.bubbleTheirs]}>
            <Text style={[styles.bubbleText, isMine ? styles.bubbleTextMine : styles.bubbleTextTheirs]}>
              {item.message}
            </Text>
            <Text style={[styles.bubbleTime, isMine ? styles.bubbleTimeMine : styles.bubbleTimeTheirs]}>
              {formatTime(item.created_at)}
            </Text>
          </View>
        </View>
      </>
    );
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.headerBack}>
          <Feather name="arrow-left" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerAvatar}>
          <Text style={styles.headerAvatarText}>{initial}</Text>
        </View>
        <View style={styles.headerInfo}>
          <Text style={styles.headerName} numberOfLines={1}>{otherPersonName || '...'}</Text>
          <View style={styles.onlineRow}>
            <View style={styles.onlineDot} />
            <Text style={styles.onlineText}>Online</Text>
          </View>
        </View>
        <TouchableOpacity style={styles.callBtn} onPress={() => router.push(`/call/${rideId}` as any)}>
          <Feather name="phone" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
      >
        <FlatList
          ref={flatListRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={styles.list}
          contentContainerStyle={[styles.listContent, messages.length === 0 && styles.listEmpty]}
          ListEmptyComponent={
            <View style={styles.emptyWrap}>
              <Feather name="message-circle" size={40} color={theme.textMuted} />
              <Text style={styles.emptyText}>No messages yet.{'\n'}Say hello!</Text>
            </View>
          }
        />

        {rideEnded ? (
          <View style={styles.endedBanner}>
            <Text style={styles.endedText}>This chat has ended</Text>
          </View>
        ) : (
          <View style={styles.inputArea}>
            <TextInput
              style={styles.textInput}
              placeholder="Type a message..."
              placeholderTextColor={theme.placeholder}
              value={input}
              onChangeText={setInput}
              multiline
              maxHeight={100}
              returnKeyType="default"
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!input.trim() || sending) && styles.sendBtnDisabled]}
              onPress={sendMessage}
              disabled={!input.trim() || sending}
            >
              <Feather name="send" size={17} color="#fff" />
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(theme: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: theme.green },
    flex: { flex: 1, backgroundColor: theme.background2 },

    header: {
      backgroundColor: theme.green,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 10,
      gap: 10,
    },
    headerBack: { padding: 4 },
    headerAvatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: 'rgba(255,255,255,0.25)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    headerAvatarText: { color: '#fff', fontSize: 16, fontWeight: '700' },
    headerInfo: { flex: 1 },
    headerName: { color: '#fff', fontSize: 16, fontWeight: '700' },
    onlineRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
    onlineDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#4ADE80' },
    onlineText: { color: 'rgba(255,255,255,0.8)', fontSize: 12 },
    callBtn: { padding: 6 },

    list: { flex: 1 },
    listContent: { paddingHorizontal: 12, paddingVertical: 16 },
    listEmpty: { flex: 1, justifyContent: 'center', alignItems: 'center' },

    emptyWrap: { alignItems: 'center', gap: 12 },
    emptyText: { color: theme.textMuted, fontSize: 14, textAlign: 'center', lineHeight: 22 },

    dateSep: { alignItems: 'center', marginVertical: 12 },
    dateSepText: {
      fontSize: 12,
      color: theme.textMuted,
      backgroundColor: theme.background,
      paddingHorizontal: 12,
      paddingVertical: 4,
      borderRadius: 10,
      overflow: 'hidden',
    },

    msgRow: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: 6 },
    msgRowMine: { justifyContent: 'flex-end' },
    msgRowTheirs: { justifyContent: 'flex-start' },

    avatar: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: theme.green,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 6,
    },
    avatarText: { color: '#fff', fontSize: 12, fontWeight: '700' },

    bubble: { maxWidth: '75%', paddingHorizontal: 14, paddingTop: 9, paddingBottom: 6 },
    bubbleMine: { backgroundColor: theme.green, borderRadius: 18, borderBottomRightRadius: 4 },
    bubbleTheirs: { backgroundColor: theme.card, borderRadius: 18, borderBottomLeftRadius: 4 },
    bubbleText: { fontSize: 15, lineHeight: 21 },
    bubbleTextMine: { color: '#fff' },
    bubbleTextTheirs: { color: theme.text },
    bubbleTime: { fontSize: 10, marginTop: 3, textAlign: 'right' },
    bubbleTimeMine: { color: 'rgba(255,255,255,0.6)' },
    bubbleTimeTheirs: { color: theme.textMuted },

    inputArea: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      backgroundColor: theme.card,
      borderTopWidth: 0.5,
      borderTopColor: theme.border,
      paddingHorizontal: 12,
      paddingVertical: 8,
      gap: 8,
    },
    textInput: {
      flex: 1,
      fontSize: 15,
      color: theme.text,
      maxHeight: 100,
      paddingVertical: Platform.OS === 'ios' ? 8 : 4,
      paddingHorizontal: 4,
    },
    sendBtn: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: theme.green,
      justifyContent: 'center',
      alignItems: 'center',
    },
    sendBtnDisabled: { opacity: 0.45 },

    endedBanner: {
      paddingVertical: 14,
      alignItems: 'center',
      backgroundColor: theme.input,
      borderTopWidth: 0.5,
      borderTopColor: theme.border,
    },
    endedText: { color: theme.textSecondary, fontSize: 13, fontStyle: 'italic' },
  });
}
