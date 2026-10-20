import React from 'react'
import { View, Text } from 'react-native'
import { MaterialCommunityIcons } from '@expo/vector-icons'

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name']

// Google Directions API `maneuver` values → MaterialCommunityIcons.
// Unknown or omitted maneuvers fall back to a generic forward arrow.
const MANEUVER_ICON: Record<string, IconName> = {
  'turn-left': 'arrow-left-top',
  'turn-right': 'arrow-right-top',
  'turn-slight-left': 'arrow-top-left',
  'turn-slight-right': 'arrow-top-right',
  'turn-sharp-left': 'arrow-left-bottom',
  'turn-sharp-right': 'arrow-right-bottom',
  'uturn-left': 'arrow-u-left-top',
  'uturn-right': 'arrow-u-right-top',
  'keep-left': 'arrow-top-left-thick',
  'keep-right': 'arrow-top-right-thick',
  'fork-left': 'source-fork',
  'fork-right': 'source-fork',
  'ramp-left': 'arrow-top-left-thick',
  'ramp-right': 'arrow-top-right-thick',
  'roundabout-left': 'rotate-left',
  'roundabout-right': 'rotate-right',
  merge: 'call-merge',
  straight: 'arrow-up',
}

function iconFor(maneuver?: string): IconName {
  if (!maneuver) return 'arrow-up'
  const mapped = MANEUVER_ICON[maneuver]
  return mapped ?? 'arrow-up'
}

export interface TurnCardProps {
  instruction: string
  distanceText: string | null
  maneuver?: string
  thenInstruction?: string | null
  thenManeuver?: string
  topInset: number
}

export default function TurnCard({
  instruction,
  distanceText,
  maneuver,
  thenInstruction,
  thenManeuver,
  topInset,
}: TurnCardProps) {
  return (
    <View style={{
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      backgroundColor: '#1A1A2E',
      paddingTop: topInset + 8,
      paddingBottom: 12,
      paddingHorizontal: 16,
      zIndex: 100,
    }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <MaterialCommunityIcons name={iconFor(maneuver)} size={40} color="white" />
        <View style={{ flex: 1 }}>
          {distanceText ? (
            <Text style={{ color: 'white', fontSize: 26, fontWeight: '800' }}>
              {distanceText}
            </Text>
          ) : null}
          <Text
            style={{ color: 'white', fontSize: 16, fontWeight: '600', marginTop: 2 }}
            numberOfLines={2}
          >
            {instruction}
          </Text>
        </View>
      </View>
      {thenInstruction ? (
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginTop: 10,
          paddingTop: 10,
          borderTopWidth: 1,
          borderTopColor: 'rgba(255,255,255,0.12)',
        }}>
          <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13 }}>Then</Text>
          <MaterialCommunityIcons name={iconFor(thenManeuver)} size={16} color="rgba(255,255,255,0.9)" />
          <Text
            style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13, flex: 1 }}
            numberOfLines={1}
          >
            {thenInstruction}
          </Text>
        </View>
      ) : null}
    </View>
  )
}
