import { useTheme } from '@/lib/theme'
import { Feather } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import React from 'react'
import { SafeAreaView, Text, TouchableOpacity, View } from 'react-native'

export default function CallScreen() {
  const theme = useTheme()
  const router = useRouter()

  return (
    <View style={{ flex: 1, backgroundColor: '#0D1F2D', alignItems: 'center', justifyContent: 'center' }}>
      <SafeAreaView style={{ alignItems: 'center' }}>
        <Feather name="phone" size={64} color={theme.green} />
        <Text style={{ color: 'white', fontSize: 20, fontWeight: '700', marginTop: 24 }}>
          Voice Calls
        </Text>
        <Text style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, marginTop: 8, textAlign: 'center', paddingHorizontal: 40 }}>
          Coming soon. Voice calls will be available in a future update.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginTop: 40, backgroundColor: theme.green, paddingHorizontal: 32, paddingVertical: 14, borderRadius: 12 }}
        >
          <Text style={{ color: 'white', fontWeight: '700', fontSize: 16 }}>Go Back</Text>
        </TouchableOpacity>
      </SafeAreaView>
    </View>
  )
}
