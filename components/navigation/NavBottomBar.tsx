import React, { useState } from 'react'
import { View, Text, TouchableOpacity, Pressable } from 'react-native'
import { Feather } from '@expo/vector-icons'

type ThemeColors = {
  card: string
  text: string
  textSecondary: string
  textMuted: string
  border: string
  green: string
  greenLight: string
  blue: string
  blueLight: string
  red: string
}

export interface NavBottomBarProps {
  mode: 'to_pickup' | 'to_destination'
  theme: ThemeColors
  bottomInset: number
  durationText: string | null
  distanceText: string | null
  arrivalTimeText: string | null
  riderName: string
  riderInitial: string
  chatUnreadCount: number
  pickupAddress: string
  dropoffAddress: string
  fareText: string
  paymentMethod: 'cash' | 'go_cash' | string
  onPressChat: () => void
  onPressCall: () => void
  onPressPrimary: () => void
  onPressCancel?: () => void
  onPressBreakdown?: () => void
}

export default function NavBottomBar({
  mode,
  theme,
  bottomInset,
  durationText,
  distanceText,
  arrivalTimeText,
  riderName,
  riderInitial,
  chatUnreadCount,
  pickupAddress,
  dropoffAddress,
  fareText,
  paymentMethod,
  onPressChat,
  onPressCall,
  onPressPrimary,
  onPressCancel,
  onPressBreakdown,
}: NavBottomBarProps) {
  const [expanded, setExpanded] = useState(false)
  const label = mode === 'to_pickup' ? 'To pickup' : 'To destination'
  const summary = [durationText, distanceText, arrivalTimeText].filter(Boolean).join(' · ')

  return (
    <View style={{
      backgroundColor: theme.card,
      borderTopLeftRadius: 20,
      borderTopRightRadius: 20,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: Math.max(bottomInset, 12),
      elevation: 10,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: -4 },
      shadowOpacity: 0.1,
      shadowRadius: 10,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.text, fontSize: 16, fontWeight: '800' }} numberOfLines={1}>
            {summary || label}
          </Text>
          <Text style={{ color: theme.textSecondary, fontSize: 12, marginTop: 2 }}>{label}</Text>
        </View>
        <Pressable
          onPress={() => setExpanded(e => !e)}
          hitSlop={10}
          style={{ paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}
        >
          <Text style={{ color: theme.textSecondary, fontSize: 13 }}>More</Text>
          <Feather name={expanded ? 'chevron-down' : 'chevron-up'} size={16} color={theme.textSecondary} />
        </Pressable>
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{
          width: 36, height: 36, borderRadius: 18,
          backgroundColor: theme.green,
          justifyContent: 'center', alignItems: 'center',
        }}>
          <Text style={{ color: 'white', fontSize: 15, fontWeight: '700' }}>{riderInitial}</Text>
        </View>
        <Text style={{ flex: 1, color: theme.text, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>
          {riderName}
        </Text>

        <TouchableOpacity
          onPress={onPressChat}
          style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: theme.greenLight,
            justifyContent: 'center', alignItems: 'center',
          }}
        >
          <Feather name="message-circle" size={18} color={theme.green} />
          {chatUnreadCount > 0 ? (
            <View style={{
              position: 'absolute', top: -4, right: -4,
              backgroundColor: theme.red,
              borderRadius: 10,
              minWidth: 18, height: 18,
              justifyContent: 'center', alignItems: 'center',
              paddingHorizontal: 4,
            }}>
              <Text style={{ color: 'white', fontSize: 10, fontWeight: '700' }}>
                {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
              </Text>
            </View>
          ) : null}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onPressCall}
          style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: theme.blueLight,
            justifyContent: 'center', alignItems: 'center',
          }}
        >
          <Feather name="phone" size={18} color={theme.blue} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={onPressPrimary}
          style={{
            backgroundColor: theme.green,
            borderRadius: 12,
            paddingVertical: 10,
            paddingHorizontal: 18,
            marginLeft: 4,
          }}
        >
          <Text style={{ color: 'white', fontSize: 15, fontWeight: '700' }}>Arrived</Text>
        </TouchableOpacity>
      </View>

      {expanded ? (
        <View style={{ marginTop: 14, borderTopWidth: 1, borderTopColor: theme.border, paddingTop: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
            <Feather name="map-pin" size={16} color={theme.textSecondary} style={{ marginTop: 2 }} />
            <Text style={{ color: theme.text, fontSize: 14, flex: 1 }} numberOfLines={2}>
              {pickupAddress}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
            <Feather name="flag" size={16} color={theme.textSecondary} style={{ marginTop: 2 }} />
            <Text style={{ color: theme.text, fontSize: 14, flex: 1 }} numberOfLines={2}>
              {dropoffAddress}
            </Text>
          </View>

          <View style={{
            backgroundColor: theme.greenLight,
            borderRadius: 10,
            padding: 10,
            alignItems: 'center',
            marginBottom: 12,
          }}>
            <Text style={{ fontSize: 20, fontWeight: '900', color: theme.green }}>GH₵ {fareText}</Text>
            <Text style={{ fontSize: 12, color: theme.textSecondary, marginTop: 2 }}>
              {paymentMethod === 'cash' ? '💵 Cash' : '📱 Go Cash'}
            </Text>
          </View>

          {mode === 'to_pickup' && onPressCancel ? (
            <TouchableOpacity
              onPress={onPressCancel}
              style={{
                borderWidth: 1, borderColor: '#d9534f',
                paddingVertical: 12, borderRadius: 8,
                alignItems: 'center', marginBottom: 8,
              }}
            >
              <Text style={{ color: '#d9534f', fontWeight: '600' }}>Cancel Ride</Text>
            </TouchableOpacity>
          ) : null}

          {mode === 'to_destination' && onPressBreakdown ? (
            <TouchableOpacity
              onPress={onPressBreakdown}
              style={{
                borderWidth: 1, borderColor: '#d9534f',
                paddingVertical: 12, borderRadius: 8,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#d9534f', fontWeight: '600' }}>Report Breakdown</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}
