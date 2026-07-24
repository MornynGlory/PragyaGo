import React, { useEffect, useRef, useState } from 'react'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  Alert,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native'
import { useFocusEffect, useRouter } from 'expo-router'
import * as Location from 'expo-location'
import MapView, { Marker } from 'react-native-maps'
import MapViewDirections from 'react-native-maps-directions'
import { Feather } from '@expo/vector-icons'
import { useTheme } from '@/lib/theme'
import { supabase } from '@/lib/supabase'

const GOOGLE_API_KEY = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || 'AIzaSyCVOaCgGucjGUokQilWaK93ZZgT41h821k') ?? ''

const customMapStyle = [
  { elementType: 'geometry', stylers: [{ color: '#f0ede6' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#4a4a4a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f5d88a' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#e8c56a' }] },
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#a8d5e8' }] },
  { featureType: 'poi.park', elementType: 'geometry.fill', stylers: [{ color: '#c8e6b0' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#e8e4dc' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative', elementType: 'labels', stylers: [{ visibility: 'on' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'on' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'on' }] },
]

export default function DriverHome() {
  const theme = useTheme()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const mapRef = useRef<MapView>(null)
  const rideRequestChannelRef = useRef<any>(null)
  const driverRideUpdatesChannelRef = useRef<any>(null)
  const activeRideRef = useRef<any>(null)
  const driverIdRef = useRef<string | null>(null)
  const locationIntervalRef = useRef<any>(null)

  const [driverName, setDriverName] = useState('Driver')
  const [userLat, setUserLat] = useState<number | null>(null)
  const [userLng, setUserLng] = useState<number | null>(null)
  const [earnings, setEarnings] = useState<number>(0)
  const [rating, setRating] = useState<number>(4.9)
  const [ridesCount, setRidesCount] = useState<number>(0)
  const [commissionOwed, setCommissionOwed] = useState<number>(0)
  const [showCommissionModal, setShowCommissionModal] = useState(false)
  const [vehicleVerified, setVehicleVerified] = useState<boolean | null>(null)
  const [unreadCount, setUnreadCount] = useState<number>(0)
  const [isOnline, setIsOnline] = useState<boolean>(false)
  console.log('Driver home rendered, isOnline:', isOnline)
  const [activeRide, setActiveRide] = useState<any>(null)
  const [rideStatus, setRideStatus] = useState('')
  const [riderInfo, setRiderInfo] = useState<any>(null)
  const [rideRequest, setRideRequest] = useState<any>(null)
  const [chatUnreadCount, setChatUnreadCount] = useState(0)

  useEffect(() => { activeRideRef.current = activeRide }, [activeRide])

  useEffect(() => {
    fetchDriverData()
    requestLocationPermission()
    return () => {
      if (rideRequestChannelRef.current) supabase.removeChannel(rideRequestChannelRef.current)
      if (driverRideUpdatesChannelRef.current) supabase.removeChannel(driverRideUpdatesChannelRef.current)
      if (locationIntervalRef.current) {
        clearInterval(locationIntervalRef.current)
        locationIntervalRef.current = null
      }
    }
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
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData?.session?.user
      console.log('Session user:', user?.id)
      if (!user) {
        router.replace('/')
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()
      if (profile?.full_name) setDriverName(profile.full_name)

      const { data: driverRecord } = await supabase
        .from('drivers')
        .select('id, commission_owed, vehicle_verified')
        .eq('profile_id', user.id)
        .single()
      if (driverRecord) {
        driverIdRef.current = driverRecord.id
        const dbCommission = driverRecord.commission_owed ?? 0
        setCommissionOwed(dbCommission)
        setShowCommissionModal(dbCommission > 0)
        setVehicleVerified(!!driverRecord.vehicle_verified)

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
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData?.session?.user
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

  useEffect(() => {
    if (activeRide?.rider_id) {
      fetchRiderInfo(activeRide.rider_id)
    } else {
      setRiderInfo(null)
    }
  }, [activeRide?.rider_id])

  async function fetchRiderInfo(riderId: string) {
    try {
      const { data: riderProfile } = await supabase
        .from('profiles')
        .select('full_name, phone')
        .eq('id', riderId)
        .single()
      setRiderInfo(riderProfile)
    } catch (e) {
      console.warn(e)
    }
  }

  async function toggleOnline() {
    if (vehicleVerified === false) {
      Alert.alert('Verification Required', 'Complete vehicle verification first')
      return
    }

    const newStatus = !isOnline

    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData?.session?.user
    console.log('Toggle - Session user:', user?.id)
    if (!user) {
      Alert.alert('Session expired', 'Please log in again.')
      router.replace('/')
      return
    }

    const { data: driver, error: driverError } = await supabase
      .from('drivers')
      .select('id')
      .eq('profile_id', user.id)
      .single()

    console.log('Driver found:', JSON.stringify(driver))
    console.log('Driver error:', JSON.stringify(driverError))
    if (!driver) return

    const { error: updateError } = await supabase
      .from('drivers')
      .update({
        is_online: newStatus,
        current_lat: userLat,
        current_lng: userLng,
      })
      .eq('id', driver.id)

    console.log('Update error:', JSON.stringify(updateError))
    if (updateError) {
      Alert.alert('Error', 'Could not update online status. Please try again.')
      return
    }

    if (newStatus) {
      console.log('Going online, subscribing to ride requests...')
      await subscribeToRideRequests(driver.id)

      if (locationIntervalRef.current) clearInterval(locationIntervalRef.current)
      locationIntervalRef.current = setInterval(async () => {
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High
          })
          const { latitude, longitude } = loc.coords
          setUserLat(latitude)
          setUserLng(longitude)

          await supabase
            .from('drivers')
            .update({
              current_lat: latitude,
              current_lng: longitude
            })
            .eq('id', driverIdRef.current)

          console.log('Driver location updated:', latitude, longitude)
        } catch (e) {
          console.log('Location update error:', e)
        }
      }, 5000)

      Alert.alert('You are Online!', 'You will now receive ride requests.')
    } else {
      if (rideRequestChannelRef.current) {
        supabase.removeChannel(rideRequestChannelRef.current)
        rideRequestChannelRef.current = null
      }
      if (driverRideUpdatesChannelRef.current) {
        supabase.removeChannel(driverRideUpdatesChannelRef.current)
        driverRideUpdatesChannelRef.current = null
      }
      if (locationIntervalRef.current) {
        clearInterval(locationIntervalRef.current)
        locationIntervalRef.current = null
      }
    }

    setIsOnline(newStatus)
  }

  async function subscribeToRideRequests(driverId: string) {
    console.log('Setting up ride request subscription for driver:', driverId)
    if (rideRequestChannelRef.current) {
      await supabase.removeChannel(rideRequestChannelRef.current)
    }
    const channel = supabase
      .channel(`ride-requests-${driverId}-${Date.now()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'rides',
      }, (payload) => {
        console.log('New ride INSERT received:', JSON.stringify(payload.new))
        const ride = payload.new as any
        if (ride.status === 'requested' && !activeRideRef.current) {
          setRideRequest(ride)
        }
      })
      .subscribe((status) => {
        console.log('Driver subscription status:', status)
      })
    rideRequestChannelRef.current = channel

    if (driverRideUpdatesChannelRef.current) {
      await supabase.removeChannel(driverRideUpdatesChannelRef.current)
    }
    const driverRideChannel = supabase
      .channel(`driver-ride-updates-${driverId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rides',
        filter: `driver_id=eq.${driverId}`
      }, (payload) => {
        console.log('Driver ride update:', JSON.stringify(payload.new))
        const ride = payload.new as any
        setActiveRide(ride)
        setRideStatus(ride.status)

        if (ride.status === 'completed') {
          setActiveRide(null)
          setRideStatus('')
          setEarnings(prev => prev + (ride.final_fare_ghs || ride.fare_ghs))
          setRidesCount(prev => prev + 1)
          Alert.alert('Ride Complete!', `GHS ${ride.final_fare_ghs || ride.fare_ghs} earned!`)
        }
        if (ride.status === 'cancelled') {
          setActiveRide(null)
          setRideStatus('')
          setRideRequest(null)
          Alert.alert('Ride Cancelled', 'The rider has cancelled this ride.')
        }
      })
      .subscribe()
    driverRideUpdatesChannelRef.current = driverRideChannel
  }

  async function acceptRide() {
    if (!rideRequest) return
    console.log('Accepting ride:', rideRequest?.id)
    console.log('Driver ID for accept:', driverIdRef.current)
    if (!driverIdRef.current) return

    const { error } = await supabase
      .from('rides')
      .update({ status: 'accepted', driver_id: driverIdRef.current })
      .eq('id', rideRequest.id)

    console.log('Accept update error:', JSON.stringify(error))
    if (error) {
      Alert.alert('Error', 'Could not accept ride. Please try again.')
      return
    }

    setActiveRide(rideRequest)
    setRideStatus('accepted')
    setRideRequest(null)
  }
  function declineRide() { setRideRequest(null) }
  async function handleArrived() {
    if (!activeRide) return
    try {
      const { error } = await supabase
        .from('rides')
        .update({ status: 'arrived_pickup' })
        .eq('id', activeRide.id)

      console.log('Arrived update error:', JSON.stringify(error))

      if (!error) {
        setRideStatus('arrived_pickup')
        Alert.alert('Arrived!', 'You have arrived at the pickup location. Waiting for rider.')
      } else {
        Alert.alert('Error', 'Could not update status. Please try again.')
      }
    } catch (e) {
      console.log('Arrived error:', e)
      Alert.alert('Error', 'Something went wrong. Please try again.')
    }
  }
  function completeRide() {}

  const riderInitials = (riderInfo?.full_name || '')
    .split(' ').map((n: string) => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 2) || '?'

  const targetLat = activeRide
    ? (rideStatus === 'in_progress' ? parseFloat(activeRide.dropoff_lat) : parseFloat(activeRide.pickup_lat)) || 7.3349
    : 7.3349
  const targetLng = activeRide
    ? (rideStatus === 'in_progress' ? parseFloat(activeRide.dropoff_lng) : parseFloat(activeRide.pickup_lng)) || -2.3123
    : -2.3123

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

          {activeRide ? (
            <Marker
              coordinate={{
                latitude: targetLat,
                longitude: targetLng,
              }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={{
                width: 44, height: 44, borderRadius: 22,
                backgroundColor: '#185FA5',
                borderWidth: 2.5, borderColor: 'white',
                justifyContent: 'center', alignItems: 'center',
                elevation: 6,
              }}>
                <Feather name="user" size={20} color="white" />
              </View>
            </Marker>
          ) : null}

          {activeRide && userLat != null && userLng != null ? (
            <MapViewDirections
              origin={{
                latitude: userLat,
                longitude: userLng,
              }}
              destination={{
                latitude: targetLat,
                longitude: targetLng,
              }}
              apikey={GOOGLE_API_KEY}
              strokeWidth={4}
              strokeColor="#1D9E75"
              onReady={(result) => {
                console.log('Distance:', result.distance)
                console.log('Duration:', result.duration)
              }}
            />
          ) : null}
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

      <View style={[styles.bottomSheet, { backgroundColor: theme.card, borderColor: theme.border, paddingBottom: Math.max(insets.bottom, 16) }]}>
        {vehicleVerified === false ? (
          <View style={styles.vehicleBanner}>
            <Feather name="alert-circle" size={20} color="#B45309" />
            <Text style={styles.vehicleBannerText}>Complete vehicle verification to start receiving rides</Text>
            <TouchableOpacity style={styles.vehicleBannerBtn} onPress={() => router.push('/auth/verify-vehicle' as any)}>
              <Text style={styles.vehicleBannerBtnText}>Verify Now</Text>
            </TouchableOpacity>
          </View>
        ) : null}
        {!activeRide ? (
          <View>
            <TouchableOpacity
              style={[
                styles.fullButton,
                { backgroundColor: isOnline ? '#d9534f' : theme.green },
                vehicleVerified === false && styles.fullButtonDisabled,
              ]}
              onPress={() => {
                console.log('Go Online button tapped!')
                toggleOnline()
              }}
            >
              <Text style={styles.fullButtonText}>{isOnline ? 'Go Offline' : 'Go Online'}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <View style={styles.rowBetween}>
              <Text style={[styles.rideStatus, { color: theme.text }]}>{getStatusLabel()}</Text>
              <View style={styles.fareBadge}><Text style={{ color: '#fff' }}>GHS {activeRide.fare ?? '0.00'}</Text></View>
            </View>

            {riderInfo && (rideStatus === 'accepted' || rideStatus === 'in_progress') ? (
              <View style={[styles.riderInfoRow, { borderColor: theme.border }]}>
                <View style={[styles.riderAvatarCircle, { backgroundColor: theme.green }]}>
                  <Text style={styles.riderAvatarText}>{riderInitials}</Text>
                </View>
                <Text style={[styles.riderInfoName, { color: theme.text }]} numberOfLines={1}>{riderInfo.full_name || 'Rider'}</Text>
                <View style={styles.riderInfoActions}>
                  <TouchableOpacity
                    style={[styles.riderActionBtn, { backgroundColor: theme.greenLight }]}
                    onPress={() => router.push(('/chat/' + activeRide.id) as any)}
                  >
                    <Feather name="message-circle" size={18} color={theme.green} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.riderActionBtn, { backgroundColor: theme.blueLight }]}
                    onPress={() => router.push(('/call/' + activeRide.id) as any)}
                  >
                    <Feather name="phone" size={18} color={theme.blue} />
                  </TouchableOpacity>
                </View>
              </View>
            ) : null}

            <View style={styles.rideRow}>
              <Feather name="map-pin" size={18} color={theme.textSecondary} />
              <Text style={[styles.rideText, { color: theme.text }]} numberOfLines={2}>
                {activeRide.pickup_address === 'Current Location'
                  ? 'Near ' + (activeRide.dropoff_address?.split(',')[1]?.trim() || activeRide.pickup_address)
                  : (activeRide.pickup_address || 'Pickup address')}
              </Text>
            </View>
            <View style={styles.rideRow}>
              <Feather name="flag" size={18} color={theme.textSecondary} />
              <Text style={[styles.rideText, { color: theme.text }]} numberOfLines={2}>{activeRide.dropoff_address || 'Dropoff address'}</Text>
            </View>

            <TouchableOpacity style={styles.fullButton} onPress={handleArrived}><Text style={styles.fullButtonText}>Arrived</Text></TouchableOpacity>

            {activeRide.status === 'in_progress' && (
              <TouchableOpacity style={[styles.outlinedButton, { borderColor: '#d9534f' }]}><Text style={{ color: '#d9534f' }}>Report Breakdown</Text></TouchableOpacity>
            )}
          </ScrollView>
        )}
      </View>

      <Modal visible={!!rideRequest} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.card }]}> 
            <Text style={[styles.modalTitle, { color: theme.text }]}>🛺 New Ride Request!</Text>

            <View style={[styles.modalRouteCard, { backgroundColor: theme.background2 }]}>
              <Text style={[styles.modalRouteLabel, { color: theme.textSecondary }]}>PICKUP</Text>
              <Text style={[styles.modalRouteValue, { color: theme.text }]}>{rideRequest?.pickup_address || 'Loading...'}</Text>

              <View style={[styles.modalDivider, { backgroundColor: theme.border }]} />

              <Text style={[styles.modalRouteLabel, { color: theme.textSecondary }]}>DROPOFF</Text>
              <Text style={[styles.modalRouteValue, { color: theme.text }]}>{rideRequest?.dropoff_address || 'Loading...'}</Text>

              {rideRequest?.stops?.length > 0 && (
                <>
                  <View style={[styles.modalDivider, { backgroundColor: theme.border }]} />
                  <Text style={[styles.modalRouteLabel, { color: theme.textSecondary }]}>STOPS</Text>
                  <Text style={[styles.modalRouteValue, { color: theme.text }]}>
                    {rideRequest.stops.map((s: any) => s.address).join(' → ')}
                  </Text>
                </>
              )}

              {rideRequest?.expected_distance_km ? (
                <>
                  <View style={[styles.modalDivider, { backgroundColor: theme.border }]} />
                  <Text style={[styles.modalRouteLabel, { color: theme.textSecondary }]}>DISTANCE</Text>
                  <Text style={[styles.modalRouteValue, { color: theme.text }]}>{rideRequest.expected_distance_km} km</Text>
                </>
              ) : null}
            </View>

            <View style={[styles.paymentBadge, { backgroundColor: theme.greenLight }]}>
              <Text style={[styles.paymentBadgeText, { color: theme.green }]}>
                {rideRequest?.payment_method?.toUpperCase() === 'MOMO' ? 'GO CASH' : (rideRequest?.payment_method?.toUpperCase() || 'CASH')}
              </Text>
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
  bottomSheet: {
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 16, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.1, shadowRadius: 12,
  },
  fullButton: { width: '100%', paddingVertical: 14, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D9E75', marginBottom: 12 },
  fullButtonDisabled: { opacity: 0.5 },
  fullButtonText: { color: '#fff', fontWeight: '700' },
  vehicleBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FEF3C7', borderRadius: 12, padding: 12, marginBottom: 14 },
  vehicleBannerText: { flex: 1, fontSize: 12, fontWeight: '600', color: '#92400E', lineHeight: 17 },
  vehicleBannerBtn: { backgroundColor: '#B45309', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  vehicleBannerBtnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  quickActionsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  quickAction: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', marginHorizontal: 4 },
  quickActionText: { marginLeft: 8, fontWeight: '600' },
  outlinedButton: { borderWidth: 1, borderColor: '#ddd', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
  outlinedText: { fontWeight: '600' },
  rideStatus: { fontWeight: '700' },
  fareBadge: { backgroundColor: '#1D9E75', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16 },
  rideRow: { flexDirection: 'row', alignItems: 'center', marginTop: 8 },
  rideText: { marginLeft: 8 },
  riderInfoRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth },
  riderAvatarCircle: { width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  riderAvatarText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  riderInfoName: { flex: 1, fontSize: 15, fontWeight: '600', marginLeft: 10 },
  riderInfoActions: { flexDirection: 'row', gap: 10 },
  riderActionBtn: { width: 36, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '85%', borderRadius: 12, padding: 16 },
  modalTitle: { fontSize: 18, fontWeight: '700', marginBottom: 12 },
  modalRouteCard: { padding: 14, borderRadius: 10, marginBottom: 12 },
  modalRouteLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, marginBottom: 4 },
  modalRouteValue: { fontSize: 14, fontWeight: '500' },
  modalDivider: { height: 1, marginVertical: 10 },
  paymentBadge: { alignSelf: 'flex-start', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 16 },
  paymentBadgeText: { fontSize: 12, fontWeight: '700' },
  modalActions: { flexDirection: 'row', justifyContent: 'space-between' },
  declineButton: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#eee', alignItems: 'center', marginRight: 8 },
  acceptButton: { flex: 1, padding: 12, borderRadius: 8, alignItems: 'center' },
})
