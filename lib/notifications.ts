import { supabase } from './supabase';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export const registerForPushNotifications = async (): Promise<string | null> => {
  if (Constants.executionEnvironment === 'storeClient') return null;

  if (!Device.isDevice) return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return null;

  const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  let token: string;
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    token = tokenData.data;
  } catch {
    return null;
  }

  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase.from('profiles').update({ push_token: token }).eq('id', user.id);
  }

  return token;
};

export const sendPushNotification = async (
  expoPushToken: string | null | undefined,
  title: string,
  body: string,
  data?: Record<string, unknown>
): Promise<void> => {
  if (!expoPushToken) return;
  try {
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
