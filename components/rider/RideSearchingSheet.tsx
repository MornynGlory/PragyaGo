import React, { useEffect, useRef, useState } from 'react'
import { View, Text, TouchableOpacity, Animated, Easing } from 'react-native'

type ThemeColors = {
  card: string
  text: string
  textSecondary: string
  textMuted: string
  border: string
  green: string
  greenLight: string
  red: string
  amber?: string
}

export interface RideSearchingSheetProps {
  pickupAddress: string
  dropoffAddress: string
  stops: { address: string }[]
  fare: number
  paymentMethod: 'cash' | 'go_cash' | string
  nearbyCount: number
  driverCancelled: boolean
  onCancel: () => void
  theme: ThemeColors
}

const AMBER_BG = '#FEF3C7'
const AMBER_TEXT = '#92400E'

export default function RideSearchingSheet({
  pickupAddress,
  dropoffAddress,
  stops,
  fare,
  paymentMethod,
  nearbyCount,
  driverCancelled,
  onCancel,
  theme,
}: RideSearchingSheetProps) {
  const slide = useRef(new Animated.Value(0)).current
  const [elapsedSec, setElapsedSec] = useState(0)

  useEffect(() => {
    slide.setValue(0)
    const loop = Animated.loop(
      Animated.timing(slide, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    )
    loop.start()
    return () => loop.stop()
  }, [slide])

  useEffect(() => {
    setElapsedSec(0)
    const id = setInterval(() => setElapsedSec(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [])

  const subtitle = elapsedSec >= 60
    ? 'Still looking — hang tight, drivers are nearby'
    : nearbyCount >= 3
      ? `${nearbyCount} drivers nearby · usually under a minute`
      : nearbyCount >= 1
        ? 'Drivers nearby · usually under a minute'
        : 'Searching nearby…'

  const paymentLabel = paymentMethod === 'cash' ? '💵 Cash' : paymentMethod === 'go_cash' ? '📱 Go Cash' : paymentMethod

  return (
    <View style={{ paddingVertical: 4 }}>
      {driverCancelled ? (
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: AMBER_BG,
          borderRadius: 10,
          paddingVertical: 10,
          paddingHorizontal: 12,
          marginBottom: 12,
        }}>
          <Text style={{ fontSize: 16 }}>⚠️</Text>
          <Text style={{ color: AMBER_TEXT, fontSize: 13, flex: 1, fontWeight: '600' }}>
            Your driver cancelled. Finding you another Pragya.
          </Text>
        </View>
      ) : null}

      <Text style={{ fontSize: 20, fontWeight: '800', color: theme.text, marginBottom: 10 }}>
        Finding your Pragya…
      </Text>

      <View style={{
        height: 4,
        backgroundColor: theme.border,
        borderRadius: 2,
        overflow: 'hidden',
        marginBottom: 10,
      }}>
        <Animated.View
          style={{
            width: '35%',
            height: '100%',
            borderRadius: 2,
            backgroundColor: theme.green,
            transform: [{
              translateX: slide.interpolate({
                inputRange: [0, 1],
                outputRange: [-120, 320],
              }),
            }],
          }}
        />
      </View>

      <Text style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 16 }}>
        {subtitle}
      </Text>

      <View style={{
        borderWidth: 1,
        borderColor: theme.border,
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ alignItems: 'center', paddingTop: 4 }}>
            <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.green }} />
            <View style={{
              width: 1,
              flexGrow: 1,
              minHeight: 20 + stops.length * 20,
              backgroundColor: theme.border,
              marginVertical: 2,
            }} />
            <View style={{ width: 10, height: 10, backgroundColor: theme.text }} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600' }} numberOfLines={2}>
              {pickupAddress}
            </Text>
            {stops.length > 0 ? (
              <View style={{ marginTop: 8 }}>
                {stops.map((s, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 2 }}>
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.textSecondary }} />
                    <Text style={{ color: theme.textSecondary, fontSize: 13, flex: 1 }} numberOfLines={2}>
                      {s.address}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}
            <Text style={{ color: theme.text, fontSize: 14, fontWeight: '600', marginTop: 10 }} numberOfLines={2}>
              {dropoffAddress}
            </Text>
          </View>
        </View>
      </View>

      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 20,
      }}>
        <Text style={{ color: theme.text, fontSize: 18, fontWeight: '800' }}>
          GH₵ {Math.ceil(fare)}
        </Text>
        <Text style={{ color: theme.textSecondary, fontSize: 13 }}>
          {paymentLabel}
        </Text>
      </View>

      <TouchableOpacity onPress={onCancel} style={{ alignItems: 'center', paddingVertical: 8 }}>
        <Text style={{ color: theme.red, fontSize: 15, fontWeight: '600' }}>
          Cancel request
        </Text>
      </TouchableOpacity>
      <Text style={{ color: theme.textMuted, fontSize: 11, textAlign: 'center', marginTop: 4 }}>
        Free to cancel until a driver accepts
      </Text>
    </View>
  )
}
