// Run in Supabase SQL:
// CREATE TABLE IF NOT EXISTS platform_settings (
//   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
//   minimum_version TEXT NOT NULL DEFAULT '1.0.0',
//   latest_version TEXT NOT NULL DEFAULT '1.0.0',
//   force_update BOOLEAN NOT NULL DEFAULT false,
//   force_update_message TEXT,
//   soft_update_message TEXT,
//   updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
// );
// -- This table is read with .single(), so seed exactly one row:
// INSERT INTO platform_settings (minimum_version, latest_version, force_update_message, soft_update_message)
// VALUES ('1.0.0', '1.1.5', 'Please update to continue using PragyaGo.', 'A new version is available with improvements and fixes.');

import { Feather } from '@expo/vector-icons'
import * as Notifications from 'expo-notifications'
import { Stack, useRouter } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useRef, useState } from 'react'
import { Linking, Modal, Text, TouchableOpacity, useColorScheme, View } from 'react-native'
import 'react-native-reanimated'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { version as currentVersion } from '../package.json'
import { registerForPushNotifications } from '@/lib/notifications'
import { supabase } from '@/lib/supabase'

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.mornynglory.pragyago'

if (process.env.NODE_ENV === 'production') {
  console.log = () => {}
  console.warn = () => {}
  console.debug = () => {}
}

function compareVersions(v1: string, v2: string): number {
  const parts1 = v1.split('.').map(Number)
  const parts2 = v2.split('.').map(Number)

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0
    if (p1 < p2) return -1
    if (p1 > p2) return 1
  }
  return 0
}

export default function RootLayout() {
  const colorScheme = useColorScheme()
  const router = useRouter()
  const notificationListener = useRef<Notifications.EventSubscription | null>(null)
  const responseListener = useRef<Notifications.EventSubscription | null>(null)

  const [showForceUpdate, setShowForceUpdate] = useState(false)
  const [showSoftUpdate, setShowSoftUpdate] = useState(false)
  const [updateMessage, setUpdateMessage] = useState('')

  const checkForUpdates = async () => {
    try {
      const { data: settings } = await supabase
        .from('platform_settings')
        .select('minimum_version, latest_version, force_update, force_update_message, soft_update_message')
        .single()

      if (!settings) return

      console.log('Current version:', currentVersion)
      console.log('Minimum version:', settings.minimum_version)
      console.log('Latest version:', settings.latest_version)

      // Compare versions
      const isForceUpdate = compareVersions(currentVersion, settings.minimum_version) < 0
      const isSoftUpdate = compareVersions(currentVersion, settings.latest_version) < 0 && !isForceUpdate

      if (isForceUpdate || settings.force_update) {
        setShowForceUpdate(true)
        setUpdateMessage(settings.force_update_message)
      } else if (isSoftUpdate) {
        setShowSoftUpdate(true)
        setUpdateMessage(settings.soft_update_message)
      }
    } catch (e) {
      console.log('Version check error:', e)
    }
  }

  useEffect(() => {
    checkForUpdates()
  }, [])

  useEffect(() => {
    registerForPushNotifications()

    notificationListener.current = Notifications.addNotificationReceivedListener(() => {
      console.log('Notification received')
    })
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { type?: string } | undefined

      // Navigate based on notification type — mirrors the types actually sent by
      // sendPushNotification() call sites (driver/home.tsx, rider/home.tsx).
      if (data?.type === 'ride_request' || data?.type === 'boarding_confirmed') {
        router.push('/driver/home')
      } else if (data?.type === 'payment_confirmed') {
        router.push('/driver-screens/wallet')
      } else if (data?.type === 'ride_update') {
        router.push('/rider/home')
      }
    })
    return () => {
      notificationListener.current?.remove()
      responseListener.current?.remove()
    }
  }, [])

  return (
    <SafeAreaProvider>
      <Stack>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="auth" options={{ headerShown: false }} />
        <Stack.Screen name="rider" options={{ headerShown: false }} />
        <Stack.Screen name="rider-screens/gocash" options={{ headerShown: false }} />
        <Stack.Screen name="rider-screens/edit-profile" options={{ headerShown: false }} />
        <Stack.Screen name="rider-screens/notifications" options={{ headerShown: false }} />
        <Stack.Screen name="driver" options={{ headerShown: false }} />
        <Stack.Screen name="driver-screens/wallet" options={{ headerShown: false }} />
        <Stack.Screen name="driver-screens/edit-profile" options={{ headerShown: false }} />
        <Stack.Screen name="driver-screens/notifications" options={{ headerShown: false }} />
        <Stack.Screen name="support" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[rideId]" options={{ headerShown: false }} />
        <Stack.Screen name="call/[rideId]" options={{ headerShown: false }} />
      </Stack>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />

      {showSoftUpdate && (
        <View style={{
          position: 'absolute',
          top: 0, left: 0, right: 0,
          backgroundColor: '#1D9E75',
          padding: 12,
          flexDirection: 'row',
          alignItems: 'center',
          zIndex: 9999,
        }}>
          <Text style={{ color: 'white', flex: 1, fontSize: 13 }}>
            {updateMessage}
          </Text>
          <TouchableOpacity
            onPress={() => Linking.openURL(PLAY_STORE_URL)}
            style={{ marginRight: 8 }}
          >
            <Text style={{ color: 'white', fontWeight: '700', fontSize: 13 }}>Update</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowSoftUpdate(false)}>
            <Feather name="x" size={18} color="white" />
          </TouchableOpacity>
        </View>
      )}

      <Modal visible={showForceUpdate} transparent animationType="fade" onRequestClose={() => {}}>
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.9)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        }}>
          <View style={{
            backgroundColor: 'white',
            borderRadius: 20,
            padding: 28,
            width: '100%',
            alignItems: 'center',
          }}>
            <Text style={{ fontSize: 48, marginBottom: 16 }}>🛺</Text>
            <Text style={{ fontSize: 22, fontWeight: '900', color: '#0D1F2D', textAlign: 'center', marginBottom: 12 }}>
              Update Required
            </Text>
            <Text style={{ fontSize: 14, color: '#6B7280', textAlign: 'center', lineHeight: 22, marginBottom: 28 }}>
              {updateMessage}
            </Text>
            <TouchableOpacity
              onPress={() => Linking.openURL(PLAY_STORE_URL)}
              style={{
                backgroundColor: '#1D9E75',
                borderRadius: 14,
                paddingVertical: 16,
                paddingHorizontal: 32,
                width: '100%',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: 'white', fontSize: 17, fontWeight: '700' }}>
                Update Now
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaProvider>
  )
}
