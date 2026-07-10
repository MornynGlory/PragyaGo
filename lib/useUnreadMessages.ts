import { supabase } from '@/lib/supabase';
import { useEffect, useState } from 'react';

export const useUnreadMessages = (rideId: string | null, userId: string | null): number => {
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!rideId || !userId) { setUnreadCount(0); return; }

    const fetchUnread = async () => {
      const { count } = await supabase
        .from('ride_messages')
        .select('*', { count: 'exact', head: true })
        .eq('ride_id', rideId)
        .eq('is_read', false)
        .neq('sender_id', userId);
      setUnreadCount(count || 0);
    };

    fetchUnread();

    const channel = supabase
      .channel(`unread:${rideId}:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ride_messages', filter: `ride_id=eq.${rideId}` }, fetchUnread)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'ride_messages', filter: `ride_id=eq.${rideId}` }, fetchUnread)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [rideId, userId]);

  return unreadCount;
};
