import { supabase } from './supabase';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const registerForPushNotifications = async (): Promise<string | null> => {
  try {
    if (Constants.executionEnvironment === 'storeClient') return null;

    if (!Device.isDevice) return null;

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('ride-requests', {
        name: 'Ride Requests',
        importance: Notifications.AndroidImportance.MAX,
        sound: 'default',
        enableVibrate: true,
        vibrationPattern: [0, 500, 250, 500, 250, 500],
        lightColor: '#1D9E75',
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        bypassDnd: true,
        showBadge: true,
      });
      await Notifications.setNotificationChannelAsync('ride-updates', {
        name: 'Ride Updates',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
      await Notifications.setNotificationChannelAsync('payments', {
        name: 'Payments',
        importance: Notifications.AndroidImportance.HIGH,
        sound: 'default',
      });
      await Notifications.setNotificationChannelAsync('general', {
        name: 'General',
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: 'default',
      });
    }

    const { status } = await Notifications.getPermissionsAsync();
    let finalStatus = status;

    if (finalStatus !== 'granted') {
      const { status: newStatus } = await Notifications.requestPermissionsAsync();
      finalStatus = newStatus;
    }

    if (finalStatus !== 'granted') return null;

    const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;

    const { data: { user } } = await supabase.auth.getUser();
    if (token && user) {
      const { error } = await supabase.from('profiles').update({ push_token: token }).eq('id', user.id);
      if (error) console.error('Push token save error');
    }

    return token;
  } catch (e) {
    console.error('Push notification registration error');
    return null;
  }
};

export const sendPushNotification = async (
  expoPushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>,
  channelId?: string
): Promise<void> => {
  if (!expoPushToken) return;
  try {
    // Ride requests need to reliably wake a locked/sleeping Android device, which plain
    // high-priority delivery doesn't guarantee — max channel priority + a short TTL (so a
    // stale request doesn't buzz the driver after it's no longer available) does.
    const isRideRequest = channelId === 'ride-requests';
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: expoPushToken,
        title,
        body,
        data: data ?? {},
        sound: 'default',
        priority: 'high',
        ...(channelId ? { channelId } : {}),
        ...(isRideRequest ? {
          ttl: 30,
          expiration: Math.floor(Date.now() / 1000) + 30,
          android: {
            channelId: 'ride-requests',
            priority: 'max',
            sticky: false,
            vibrate: [0, 500, 250, 500, 250, 500],
            sound: 'default',
          },
        } : {}),
      }),
    });
  } catch {
    // silently ignore — token may be invalid or network unavailable
  }
};

export const getDriverToken = async (driverId: string): Promise<string | null> => {
  const { data: driver } = await supabase
    .from('drivers')
    .select('profile_id')
    .eq('id', driverId)
    .single();

  if (!driver?.profile_id) return null;

  const { data: profile } = await supabase
    .from('profiles')
    .select('push_token')
    .eq('id', driver.profile_id)
    .single();

  return profile?.push_token ?? null;
};

export const getRiderToken = async (riderId: string): Promise<string | null> => {
  const { data: profile } = await supabase
    .from('profiles')
    .select('push_token')
    .eq('id', riderId)
    .single();

  return profile?.push_token ?? null;
};
