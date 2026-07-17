import React, { useEffect, useRef, useState } from 'react'
import { SafeAreaView } from 'react-native-safe-area-context'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import * as Location from 'expo-location'
import MapView, { Marker } from 'react-native-maps'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '@/lib/theme'
import { supabase } from '@/lib/supabase'

const customMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#EBE8E0' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#523735' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f1e6' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#c9b2a6' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#C8E6B2' }] },
  { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#F8D48A' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#e9bc62' }] },
  { featureType: 'road.highway', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#AED6F1' }] },
  { featureType: 'water', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#F0EBE0' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#DCEDC8' }] },
]

export default function DriverHome() {
  const theme = useTheme()
  const router = useRouter()
  const mapRef = useRef<MapView>(null)

  const [driverName, setDriverName] = useState('Driver')
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLng, setUserLng] = useState<number | null>(null)
  const [earnings, setEarnings] = useState<number>(0)
  const [rating, setRating] = useState<number>(4.9)
  const [ridesCount, setRidesCount] = useState<number>(0)
  const [commissionOwed, setCommissionOwed] = useState<number>(0)
  const [showCommissionModal, setShowCommissionModal] = useState(false)
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [isOnline, setIsOnline] = useState<boolean>(false)
  const [activeRide, setActiveRide] = useState<any>(null)
  const [rideStatus, setRideStatus] = useState('')
  const [rideRequest, setRideRequest] = useState<any>(null)
  const [chatUnreadCount, setChatUnreadCount] = useState(0)

  useEffect(() => {
    fetchDriverData()
    requestLocationPermission()
  }, [])

  useFocusEffect(
    React.useCallback(() => {
      fetchDriverData()
    }, [])
  )

  async function requestLocationPermission() {
    const { status } = await Location.requestForegroundPermissionsAsync()
    if (status !== 'granted') return
    getCurrentLocation()
  }

  async function getCurrentLocation() {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High })
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude }
      setUserLat(coords.latitude)
      setUserLng(coords.longitude)
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 })
    } catch {}
  }

  async function fetchDriverData() {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()
      if (profile?.full_name) setDriverName(profile.full_name)

      const { data: driverRecord } = await supabase
        .from('drivers')
        .select('id, commission_owed')
        .eq('profile_id', user.id)
        .single()
      if (driverRecord) {
        const dbCommission = driverRecord.commission_owed ?? 0
        setCommissionOwed(dbCommission)
        if (dbCommission > 0) {
          setShowCommissionModal(true)
        }

        const { data: activeRideData } = await supabase
          .from('rides')
          .select('*')
          .eq('driver_id', driverRecord.id)
          .in('status', ['accepted', 'arrived_pickup', 'in_progress', 'payment_pending'])
          .maybeSingle()
        if (activeRideData) {
          setActiveRide(activeRideData)
          setRideStatus(activeRideData.status)
        } else {
          setActiveRide(null)
          setRideStatus('')
        }
      }
    } catch (e) {
      console.warn(e)
    }
  }

  const getStatusLabel = () => {
    if (rideStatus === 'accepted') return 'Heading to Pickup'
    if (rideStatus === 'arrived_pickup') return 'Waiting for Rider'
    if (rideStatus === 'in_progress') return 'Ride in Progress'
    if (rideStatus === 'payment_pending') return 'Confirm Payment'
    return 'Active Ride'
  }

  const fetchChatUnreadCount = async (rideId: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { count } = await supabase
        .from('ride_messages')
        .select('*', { count: 'exact', head: true })
        .eq('ride_id', rideId)
        .neq('sender_id', user.id)
        .eq('is_read', false)
      setChatUnreadCount(count ?? 0)
    } catch {}
  }

  useEffect(() => {
    if (activeRide?.id) {
      fetchChatUnreadCount(activeRide.id)
    } else {
      setChatUnreadCount(0)
    }
  }, [activeRide?.id])

  function toggleOnline() { setIsOnline((v) => !v) }
  function acceptRide() { setRideRequest(null) }
  function declineRide() { setRideRequest(null) }
  function arrivePickup() {}
  function completeRide() {}

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView edges={["top"]} style={[styles.headerSafeArea, { backgroundColor: theme.green }]}> 
        <View style={styles.headerContent}>
          <View style={styles.row}>
            <Text style={[styles.driverName, { color: '#fff' }]}>{driverName}</Text>
            <View style={{ alignItems: 'flex-end', marginLeft: 'auto' }}>
              <Text style={[styles.earnings, { color: '#fff' }]}>GHS {earnings.toFixed(2)}</Text>
              <Text style={[styles.earningsLabel, { color: '#e6fff7' }]}>Today's Earnings</Text>
            </View>
          </View>

          <View style={[styles.row, { marginTop: 10, alignItems: 'center' }]}> 
            <View style={styles.pillsRow}>
              <View style={[styles.pill, { backgroundColor: 'rgba(0,0,0,0.18)' }]}>
                <Feather name="star" size={12} color="#fff" />
                <Text style={styles.pillText}>{rating.toFixed(1)}</Text>
              </View>
              <View style={[styles.pill, { backgroundColor: 'rgba(0,0,0,0.18)' }]}>
                <Text style={styles.pillText}>🛺 {ridesCount} rides</Text>
              </View>
              <View style={[styles.pill, { backgroundColor: 'rgba(0,0,0,0.18)' }]}>
                <Feather name="dollar-sign" size={12} color="#fff" />
                <Text style={styles.pillText}>GHS {commissionOwed.toFixed(2)}</Text>
              </View>
            </View>

            <View style={{ marginLeft: 'auto' }}>
              <TouchableOpacity onPress={() => router.push('/notifications' as any)}>
                <Feather name="bell" size={22} color="#fff" />
                {unreadCount > 0 && (
                  <View style={styles.badge}><Text style={styles.badgeText}>{unreadCount}</Text></View>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </SafeAreaView>

      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          customMapStyle={customMapStyle}
          mapType="standard"
          zoomEnabled
          scrollEnabled
          initialRegion={{
            latitude: userLat ?? 7.3349,
            longitude: userLng ?? -2.3123,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01,
          }}
        >
          <Marker
            coordinate={{ latitude: userLat ?? 7.3349, longitude: userLng ?? -2.3123 }}
            anchor={{ x: 0.5, y: 0.5 }}
            tracksViewChanges={false}
          >
            <View style={{
              width: 48, height: 48, borderRadius: 24,
              backgroundColor: '#1D9E75',
              borderWidth: 3,
              borderColor: 'white',
              justifyContent: 'center',
              alignItems: 'center',
              elevation: 8,
              shadowColor: '#1D9E75',
              shadowOpacity: 0.5,
              shadowRadius: 8,
            }}>
              <Text style={{ fontSize: 24 }}>🛺</Text>
            </View>
          </Marker>
        </MapView>
        {userLat != null && userLng != null ? (
          <TouchableOpacity
            style={styles.locateMeBtn}
            onPress={() => {
              mapRef.current?.animateToRegion({
                latitude: userLat,
                longitude: userLng,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              })
            }}
          >
            <Feather name="navigation" size={20} color="#185FA5" />
          </TouchableOpacity>
        ) : null}
      </View>

      {activeRide && rideStatus !== 'payment_pending' ? (
        <TouchableOpacity
          style={[styles.chatFab, { backgroundColor: theme.green }]}
          onPress={() => { setChatUnreadCount(0); router.push(`/chat/${activeRide.id}` as any) }}
          activeOpacity={0.85}
        >
          <Feather name="message-circle" size={24} color="#fff" />
          {chatUnreadCount > 0 && (
            <View style={styles.chatFabBadge}>
              <Text style={styles.chatFabBadgeText}>{chatUnreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      ) : null}

      <View style={[styles.bottomSheet, { backgroundColor: theme.card, borderColor: theme.border }]}> 
        {!activeRide ? (
          <View>
            <TouchableOpacity
              style={[styles.fullButton, { backgroundColor: isOnline ? '#d9534f' : theme.green }]}
              onPress={toggleOnline}
            >
              <Text style={styles.fullButtonText}>{isOnline ? 'Go Offline' : 'Go Online'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View>
            <View style={styles.rowBetween}>
              <Text style={[styles.rideStatus, { color: theme.text }]}>{getStatusLabel()}</Text>
              <View style={styles.fareBadge}><Text style={{ color: '#fff' }}>GHS {activeRide.fare ?? '0.00'}</Text></View>
            </View>

            <View style={styles.rideRow}><Feather name="map-pin" size={18} color={theme.textSecondary} /><Text style={[styles.rideText, { color: theme.text }]}>{activeRide.pickup ?? 'Pickup address'}</Text></View>
            <View style={styles.rideRow}><Feather name="flag" size={18} color={theme.textSecondary} /><Text style={[styles.rideText, { color: theme.text }]}>{activeRide.dropoff ?? 'Dropoff address'}</Text></View>

            <TouchableOpacity style={styles.fullButton} onPress={arrivePickup}><Text style={styles.fullButtonText}>Arrived</Text></TouchableOpacity>

            {activeRide.status === 'in_progress' && (
              <TouchableOpacity style={[styles.outlinedButton, { borderColor: '#d9534f' }]}><Text style={{ color: '#d9534f' }}>Report Breakdown</Text></TouchableOpacity>
            )}
          </View>
        )}
      </View>

      <Modal visible={!!rideRequest} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.card }]}> 
            <Text style={[styles.modalTitle, { color: theme.text }]}>🛺 New Ride Request!</Text>
            <Text style={[styles.modalFare, { color: theme.green }]}>GHS {rideRequest?.fare ?? '0.00'}</Text>
            <View style={styles.modalAddresses}>
              <Text style={{ color: theme.text }}>{rideRequest?.pickup ?? 'Pickup address'}</Text>
              <Text style={{ color: theme.textSecondary }}>{rideRequest?.dropoff ?? 'Dropoff address'}</Text>
            </View>

            <View style={styles.modalActions}>
              <Pressable style={styles.declineButton} onPress={declineRide}><Text>Decline</Text></Pressable>
              <Pressable style={[styles.acceptButton, { backgroundColor: theme.green }]} onPress={acceptRide}><Text style={{ color: '#fff' }}>Accept</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={showCommissionModal} transparent animationType="fade">
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.85)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        }}>
          <View style={{
            backgroundColor: theme.card,
            borderRadius: 20,
            padding: 28,
            width: '100%',
            alignItems: 'center',
          }}>
            {/* Lock icon */}
            <View style={{
              width: 72, height: 72, borderRadius: 36,
              backgroundColor: theme.redLight,
              justifyContent: 'center', alignItems: 'center',
              marginBottom: 20,
            }}>
              <Feather name="lock" size={36} color={theme.red} />
            </View>

            <Text style={{
              fontSize: 22, fontWeight: '900',
              color: theme.text, textAlign: 'center',
              marginBottom: 8,
            }}>Account Locked</Text>

            <Text style={{
              fontSize: 14, color: theme.textSecondary,
              textAlign: 'center', lineHeight: 22,
              marginBottom: 20,
            }}>
              You have unpaid commission of
            </Text>

            <Text style={{
              fontSize: 40, fontWeight: '900',
              color: theme.red, marginBottom: 8,
            }}>
              GHS {commissionOwed.toFixed(2)}
            </Text>

            <Text style={{
              fontSize: 13, color: theme.textSecondary,
              textAlign: 'center', lineHeight: 20,
              marginBottom: 28,
              paddingHorizontal: 8,
            }}>
              Your account is locked until you pay your outstanding commission. You cannot go online or accept rides until this is settled.
            </Text>

            {/* Pay now button */}
            <TouchableOpacity
              style={{
                backgroundColor: theme.green,
                borderRadius: 14,
                paddingVertical: 16,
                width: '100%',
                alignItems: 'center',
                marginBottom: 12,
              }}
              onPress={() => {
                setShowCommissionModal(false)
                router.push('/driver/wallet')
              }}
            >
              <Text style={{ color: 'white', fontSize: 17, fontWeight: '700' }}>
                Pay Now via Mobile Money
              </Text>
            </TouchableOpacity>

            {/* Remind me later - only available if commission is less than 24 hours old */}
            <TouchableOpacity
              style={{
                paddingVertical: 12,
                width: '100%',
                alignItems: 'center',
              }}
              onPress={() => setShowCommissionModal(false)}
            >
              <Text style={{ color: theme.textMuted, fontSize: 14 }}>
                Remind me later
              </Text>
            </TouchableOpacity>

          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  headerSafeArea: {},
  headerContent: { paddingHorizontal: 16, paddingBottom: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  driverName: { fontSize: 18, fontWeight: '700' },
  earnings: { fontSize: 20, fontWeight: '700' },
  earningsLabel: { fontSize: 12 },
  pillsRow: { flexDirection: 'row' },
  pill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, marginRight: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillText: { color: '#fff', fontSize: 12 },
  badge: { position: 'absolute', right: -6, top: -6, backgroundColor: '#d9534f', borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { color: '#fff', fontSize: 10 },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  locateMeBtn: { position: 'absolute', right: 16, bottom: 16, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 6 },
  bottomSheet: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  fullButton: { width: '100%', paddingVertical: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D9E75', marginBottom: 12 },
  fullButtonText: { color: '#fff', fontWeight: '700' },
  quickActionsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  quickAction: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginHorizontal: 4 },
  quickActionText: { marginLeft: 8, fontWeight: '600' },
  outlinedButton: { borderWidth: 1, borderColor: '#ddd', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  outlinedText: { fontWeight: '600' },
  rideStatus: { fontWeight: '700' },
  fareBadge: { backgroundColor: '#1D9E75', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },
  rideRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  rideText: { marginLeft: 8 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', borderRadius: 12, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 8 },
  modalFare: { fontSize: 22, fontWeight: '800', marginBottom: 12 },
  modalAddresses: { backgroundColor: '#fff', padding: 12, borderRadius: 8, marginBottom: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between' },
  declineButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#eee', alignItems: 'center', marginRight: 8 },
  acceptButton: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center' },
  chatFab: { position: 'absolute', right: 16, bottom: 140, width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 8, zIndex: 20 },
  chatFabBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: '#FF3B30', borderRadius: 10, minWidth: 20, height: 20, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
  chatFabBadgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
})
