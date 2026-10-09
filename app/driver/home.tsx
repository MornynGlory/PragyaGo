import React, { useEffect, useRef, useState } from 'react'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  AppStateStatus,
  View,
  Text,
  StyleSheet,
  TextInput,
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
import { getDriverToken, sendPushNotification } from '@/lib/notifications'

const GOOGLE_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? ''

const MIN_DISTANCE_METERS = 5

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const BREAKDOWN_REASONS = [
  { label: 'Accident', exemptFromCommission: true },
  { label: 'Rider assault or threatening behavior', exemptFromCommission: true },
  { label: 'Flat tyre', exemptFromCommission: false },
  { label: 'Engine problem', exemptFromCommission: false },
  { label: 'Fuel finished', exemptFromCommission: false },
  { label: 'Overheating', exemptFromCommission: false },
  { label: 'Personal reasons', exemptFromCommission: false },
  { label: 'Other', exemptFromCommission: false },
]

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
  const dispatchUpdatesChannelRef = useRef<any>(null)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const activeRideRef = useRef<any>(null)
  const driverIdRef = useRef<string | null>(null)
  const currentUserIdRef = useRef<string | null>(null)
  const profileIdRef = useRef<string | null>(null)
  const driverZoneRef = useRef<string | null>(null)
  const locationIntervalRef = useRef<any>(null)
  const queueChannelRef = useRef<any>(null)
  const lastSentLocationRef = useRef<{ lat: number; lng: number }>({ lat: 0, lng: 0 })
  const statusChangingRef = useRef(false)
  const notifChannelRef = useRef<any>(null)

  const [driverName, setDriverName] = useState('Driver')
  const [inQueue, setInQueue] = useState(false)
  const [queuePosition, setQueuePosition] = useState<number | null>(null)
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
  const [activeRide, setActiveRide] = useState<any>(null)
  const [rideStatus, setRideStatus] = useState('')
  const [riderInfo, setRiderInfo] = useState<any>(null)
  const [rideRequest, setRideRequest] = useState<any>(null)
  const [acceptCountdown, setAcceptCountdown] = useState(30)
  const [chatUnreadCount, setChatUnreadCount] = useState(0)
  const [showBreakdownModal, setShowBreakdownModal] = useState(false)
  const [breakdownReason, setBreakdownReason] = useState('')
  const [otherBreakdownReason, setOtherBreakdownReason] = useState('')
  const [reportingBreakdown, setReportingBreakdown] = useState(false)
  const [sosSending, setSosSending] = useState(false)
  const [distanceToPickup, setDistanceToPickup] = useState<string | null>(null)
  const [etaToPickup, setEtaToPickup] = useState<string | null>(null)
  const distanceIntervalRef = useRef<any>(null)
  // Latest driver position, read by the distance interval so it doesn't use stale coords.
  const userLocRef = useRef<{ lat: number | null; lng: number | null }>({ lat: null, lng: null })

  useEffect(() => { activeRideRef.current = activeRide }, [activeRide])
  useEffect(() => { userLocRef.current = { lat: userLat, lng: userLng } }, [userLat, userLng])

  const fetchDistanceToPickup = async (driverLat: number, driverLng: number, pickupLat: number, pickupLng: number) => {
    try {
      const response = await fetch(
        `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${driverLat},${driverLng}&destinations=${pickupLat},${pickupLng}&mode=driving&key=${GOOGLE_API_KEY}`
      )
      const data = await response.json()
      const element = data.rows?.[0]?.elements?.[0]
      if (element?.status === 'OK') {
        setDistanceToPickup(element.distance.text)
        setEtaToPickup(element.duration.text)
      }
    } catch (e) {
      console.error('Distance fetch error')
    }
  }

  // Poll distance/ETA to pickup every 30s while heading to pickup.
  useEffect(() => {
    const clearDistanceInterval = () => {
      if (distanceIntervalRef.current) {
        clearInterval(distanceIntervalRef.current)
        distanceIntervalRef.current = null
      }
    }

    if (rideStatus !== 'accepted' || !activeRide?.id) {
      clearDistanceInterval()
      setDistanceToPickup(null)
      setEtaToPickup(null)
      return
    }

    const pickupLat = parseFloat(activeRide.pickup_lat)
    const pickupLng = parseFloat(activeRide.pickup_lng)
    if (isNaN(pickupLat) || isNaN(pickupLng)) return

    const tick = () => {
      const { lat, lng } = userLocRef.current
      if (lat != null && lng != null) fetchDistanceToPickup(lat, lng, pickupLat, pickupLng)
    }
    tick()
    distanceIntervalRef.current = setInterval(tick, 30000)

    return clearDistanceInterval
  }, [rideStatus, activeRide?.id])

  useEffect(() => {
    if (activeRide) {
      AsyncStorage.setItem('driverActiveRide', JSON.stringify(activeRide))
      AsyncStorage.setItem('driverRideStatus', rideStatus)
    } else {
      AsyncStorage.removeItem('driverActiveRide')
      AsyncStorage.removeItem('driverRideStatus')
    }
  }, [activeRide, rideStatus])

  useEffect(() => {
    fetchDriverData()
    restoreDriverState()
    requestLocationPermission()
    return () => {
      if (rideRequestChannelRef.current) supabase.removeChannel(rideRequestChannelRef.current)
      if (driverRideUpdatesChannelRef.current) supabase.removeChannel(driverRideUpdatesChannelRef.current)
      if (dispatchUpdatesChannelRef.current) supabase.removeChannel(dispatchUpdatesChannelRef.current)
      if (queueChannelRef.current) supabase.removeChannel(queueChannelRef.current)
      if (notifChannelRef.current) supabase.removeChannel(notifChannelRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
      if (locationIntervalRef.current) {
        clearInterval(locationIntervalRef.current)
        locationIntervalRef.current = null
      }
    }
  }, [])

  const appStateRef = useRef(AppState.currentState)

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        console.log('Driver app came to foreground')

        const { data: sessionData } = await supabase.auth.getSession()
        if (!sessionData?.session) {
          router.replace('/')
          appStateRef.current = nextAppState
          return
        }

        // Realtime socket is typically dropped while backgrounded, so the
        // driverRideUpdatesChannelRef handler's terminal-state clear may have been missed —
        // re-check the known ride by id directly rather than relying on the channel alone.
        if (activeRideRef.current?.id) {
          const { data: ride } = await supabase
            .from('rides')
            .select('*')
            .eq('id', activeRideRef.current.id)
            .single()

          if (ride) {
            if (ride.status === 'completed' || ride.status === 'cancelled') {
              setActiveRide(null)
              setRideStatus('')
            } else {
              setActiveRide(ride)
              setRideStatus(ride.status)
            }
          }
        }

        restoreDriverState()
      }
      appStateRef.current = nextAppState
    })
    return () => subscription.remove()
  }, [])

  useFocusEffect(
    React.useCallback(() => {
      fetchDriverData()
      if (activeRideRef.current?.id) fetchChatUnreadCount(activeRideRef.current.id)
    }, [])
  )

  useFocusEffect(
    React.useCallback(() => {
      restoreDriverState()
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
      if (!user) {
        router.replace('/')
        return
      }
      currentUserIdRef.current = user.id
      profileIdRef.current = user.id
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', user.id)
        .single()
      if (profile?.full_name) setDriverName(profile.full_name)

      const { data: driverRecord } = await supabase
        .from('drivers')
        .select('id, commission_owed, vehicle_verified, rating, zone_id')
        .eq('profile_id', user.id)
        .single()
      if (driverRecord) {
        driverIdRef.current = driverRecord.id
        driverZoneRef.current = driverRecord.zone_id
        if (driverRecord.rating !== null && driverRecord.rating !== undefined) {
          setRating(parseFloat(driverRecord.rating))
        }
        const dbCommission = driverRecord.commission_owed ?? 0
        setCommissionOwed(dbCommission)
        setShowCommissionModal(dbCommission > 0)
        setVehicleVerified(!!driverRecord.vehicle_verified)

        const { data: activeRideData } = await supabase
          .from('rides')
          .select('*')
          .eq('driver_id', driverRecord.id)
          .in('status', ['accepted', 'rider_boarding', 'in_progress', 'arrived_destination', 'payment_pending'])
          .maybeSingle()
        if (activeRideData) {
          setActiveRide(activeRideData)
          setRideStatus(activeRideData.status)
        } else {
          setActiveRide(null)
          setRideStatus('')
        }
      }

      fetchUnreadCount()
      subscribeToNotifications()
    } catch (e) {
      console.warn(e)
    }
  }

  async function fetchUnreadCount() {
    if (!currentUserIdRef.current) return
    const { count } = await supabase
      .from('user_notifications')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', currentUserIdRef.current)
      .eq('is_read', false)

    if (count !== null) setUnreadCount(count)
  }

  function subscribeToNotifications() {
    // fetchDriverData runs on every focus — only subscribe once
    if (notifChannelRef.current || !currentUserIdRef.current) return
    notifChannelRef.current = supabase
      .channel(`driver-notifications:${currentUserIdRef.current}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'user_notifications',
        filter: `user_id=eq.${currentUserIdRef.current}`,
      }, () => {
        fetchUnreadCount()
      })
      .subscribe()
  }

  async function restoreDriverState() {
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const user = sessionData?.session?.user
      if (!user) return
      currentUserIdRef.current = user.id
      profileIdRef.current = user.id

      const { data: driver } = await supabase
        .from('drivers')
        .select('id, is_online, commission_owed, wallet_balance, rating, zone_id')
        .eq('profile_id', user.id)
        .single()

      if (!driver) return
      driverIdRef.current = driver.id
      driverZoneRef.current = driver.zone_id
      if (driver.rating !== null && driver.rating !== undefined) {
        setRating(parseFloat(driver.rating))
      }

      // Check for active ride
      const { data: activeRideData } = await supabase
        .from('rides')
        .select('*')
        .eq('driver_id', driver.id)
        .in('status', ['accepted', 'rider_boarding', 'in_progress', 'arrived_destination', 'payment_pending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (activeRideData) {
        setActiveRide(activeRideData)
        setRideStatus(activeRideData.status)
        setIsOnline(true)
      }

      // Restore online status
      if (driver.is_online) {
        setIsOnline(true)
        subscribeToRideRequests(driver.id)
        startLocationTracking()
      }
    } catch (e) {
      console.log('Driver restore error:', e)
    }
  }

  const getStatusLabel = () => {
    if (rideStatus === 'accepted') return 'Heading to Pickup'
    if (rideStatus === 'rider_boarding') return 'Waiting for Rider to Board'
    if (rideStatus === 'in_progress') return 'Ride in Progress'
    if (rideStatus === 'arrived_destination') return 'Arrived at Destination'
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

  function startLocationTracking() {
    if (locationIntervalRef.current) clearInterval(locationIntervalRef.current)
    locationIntervalRef.current = setInterval(async () => {
      try {
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced
        })
        const { latitude, longitude } = loc.coords
        setUserLat(latitude)
        setUserLng(longitude)

        const distance = calculateDistance(
          lastSentLocationRef.current.lat,
          lastSentLocationRef.current.lng,
          latitude,
          longitude
        )

        if (distance > MIN_DISTANCE_METERS) {
          await supabase
            .from('drivers')
            .update({
              current_lat: latitude,
              current_lng: longitude
            })
            .eq('id', driverIdRef.current)

          lastSentLocationRef.current = { lat: latitude, lng: longitude }
        }
      } catch (e) {
        console.log('Location update error:', e)
      }
    }, 2000)
  }

  function stopLocationTracking() {
    if (locationIntervalRef.current) {
      clearInterval(locationIntervalRef.current)
      locationIntervalRef.current = null
    }
  }

  async function leaveQueue() {
    if (!driverIdRef.current) return
    await supabase.from('driver_queue').delete().eq('driver_id', driverIdRef.current).eq('status', 'waiting')
    setInQueue(false)
    setQueuePosition(null)
    if (queueChannelRef.current) {
      supabase.removeChannel(queueChannelRef.current)
      queueChannelRef.current = null
    }
  }

  // Feature 1: zone driver limit + queue. Listens for this driver's own queue
  // entry being activated (i.e. a slot opened up while they were waiting).
  function subscribeToQueueUpdates(driverId: string) {
    if (queueChannelRef.current) supabase.removeChannel(queueChannelRef.current)
    const channel = supabase
      .channel(`driver-queue-${driverId}-${Date.now()}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'driver_queue',
        filter: `driver_id=eq.${driverId}`,
      }, async (payload) => {
        const updated = payload.new as any
        if (updated.status === 'activated') {
          setInQueue(false)
          setQueuePosition(null)
          setIsOnline(true)
          startLocationTracking()
          await subscribeToRideRequests(driverId)
          Alert.alert('Slot Available!', 'A slot is now available! You are now online.')
          if (queueChannelRef.current) {
            supabase.removeChannel(queueChannelRef.current)
            queueChannelRef.current = null
          }
        }
      })
      .subscribe()
    queueChannelRef.current = channel
  }

  // Activate whichever driver has been waiting longest in this zone's queue.
  async function activateNextInQueue(zoneId: string) {
    const { data: nextInLine } = await supabase
      .from('driver_queue')
      .select('*')
      .eq('zone_id', zoneId)
      .eq('status', 'waiting')
      .order('queued_at', { ascending: true })
      .limit(1)
      .single()

    if (!nextInLine) return

    await supabase.from('drivers').update({ is_online: true }).eq('id', nextInLine.driver_id)
    await supabase
      .from('driver_queue')
      .update({ status: 'activated', activated_at: new Date().toISOString() })
      .eq('id', nextInLine.id)

    const token = await getDriverToken(nextInLine.driver_id)
    if (token) {
      await sendPushNotification(token, 'A slot is now available!', 'You are now online.')
    }
  }

  async function toggleOnline() {
    if (statusChangingRef.current) return
    statusChangingRef.current = true

    if (vehicleVerified === false) {
      Alert.alert('Verification Required', 'Complete vehicle verification first')
      statusChangingRef.current = false
      return
    }

    const previousStatus = isOnline
    const newStatus = !isOnline
    // Optimistic update — flip the UI immediately so the toggle feels instant;
    // revert it if any step below fails.
    setIsOnline(newStatus)

    try {

    const { data: sessionData } = await supabase.auth.getSession()
    const user = sessionData?.session?.user
    if (!user) {
      setIsOnline(previousStatus)
      Alert.alert('Session expired', 'Please log in again.')
      router.replace('/')
      return
    }

    const { data: driver, error: driverError } = await supabase
      .from('drivers')
      .select('id')
      .eq('profile_id', user.id)
      .single()

    if (driverError) console.error('Driver lookup error:', driverError)
    if (!driver) {
      setIsOnline(previousStatus)
      return
    }

    // Zone-id lives on profiles (drivers has no zone_id column in the known schema);
    // keep drivers.zone_id in sync so the zone-scoped online-count query below can
    // filter on it directly, matching the shape of driver_queue's own zone_id column.
    const { data: profile } = await supabase.from('profiles').select('zone_id').eq('id', user.id).single()
    const zoneId = profile?.zone_id ?? null
    if (zoneId) await supabase.from('drivers').update({ zone_id: zoneId }).eq('id', driver.id)

    if (newStatus && zoneId) {
      const { count } = await supabase
        .from('drivers')
        .select('*', { count: 'exact', head: true })
        .eq('zone_id', zoneId)
        .eq('is_online', true)

      const { data: zoneSettings } = await supabase
        .from('zone_settings')
        .select('max_active_drivers')
        .eq('zone_id', zoneId)
        .single()

      const limit = zoneSettings?.max_active_drivers || 20

      if ((count ?? 0) >= limit) {
        const { data: queueEntry } = await supabase
          .from('driver_queue')
          .insert({ driver_id: driver.id, zone_id: zoneId, status: 'waiting' })
          .select()
          .single()

        Alert.alert(
          'Zone Full',
          'Your zone is currently full. You have been added to the waiting queue. You will be notified when a slot becomes available.'
        )

        if (queueEntry) {
          const { count: aheadCount } = await supabase
            .from('driver_queue')
            .select('*', { count: 'exact', head: true })
            .eq('zone_id', zoneId)
            .eq('status', 'waiting')
            .lt('queued_at', queueEntry.queued_at)
          setQueuePosition((aheadCount ?? 0) + 1)
          setInQueue(true)
          subscribeToQueueUpdates(driver.id)
        }
        // Not actually online yet — queued, so undo the optimistic flip.
        setIsOnline(previousStatus)
        return
      }
    }

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
      setIsOnline(previousStatus)
      Alert.alert('Error', 'Could not update online status. Please try again.')
      return
    }

    if (newStatus) {
      console.log('Going online, subscribing to ride requests...')
      await subscribeToRideRequests(driver.id)
      startLocationTracking()
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
      if (dispatchUpdatesChannelRef.current) {
        supabase.removeChannel(dispatchUpdatesChannelRef.current)
        dispatchUpdatesChannelRef.current = null
      }
      stopLocationTracking()

      // Remove this driver from the queue if they were waiting, then let the
      // next-longest-waiting driver in this zone take the freed-up slot.
      await supabase.from('driver_queue').delete().eq('driver_id', driver.id).eq('status', 'waiting')
      setInQueue(false)
      setQueuePosition(null)
      if (queueChannelRef.current) {
        supabase.removeChannel(queueChannelRef.current)
        queueChannelRef.current = null
      }
      if (zoneId) await activateNextInQueue(zoneId)
    }
    } catch (e) {
      console.log('Toggle online error:', e)
      setIsOnline(previousStatus)
      Alert.alert('Error', 'Could not update online status. Please try again.')
    } finally {
      statusChangingRef.current = false
    }
  }

  const sendRideRequestNotification = async (ride: any) => {
    try {
      const { data: profile } = await supabase
        .from('profiles')
        .select('push_token')
        .eq('id', currentUserIdRef.current)
        .single()

      if (!profile?.push_token) return

      await sendPushNotification(
        profile.push_token,
        '🛺 New Ride Request!',
        `Pickup: ${ride.pickup_address}\nDropoff: ${ride.dropoff_address}`,
        { type: 'ride_request', rideId: ride.id },
        'ride-requests'
      )
    } catch (e) {
      console.log('Push notification error:', e)
    }
  }

  function startAcceptCountdown() {
    if (countdownRef.current) clearInterval(countdownRef.current)
    setAcceptCountdown(30)
    countdownRef.current = setInterval(() => {
      setAcceptCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current)
          countdownRef.current = null
          setRideRequest(null) // auto dismiss when time runs out
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  async function subscribeToRideRequests(driverId: string) {
    if (rideRequestChannelRef.current) {
      await supabase.removeChannel(rideRequestChannelRef.current)
    }
    const channel = supabase
      .channel(`ride-requests-${driverId}-${Date.now()}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'rides',
      }, async (payload) => {
        const ride = payload.new as any
        if (ride.status !== 'requested') return
        if (!activeRideRef.current && ride.zone_id === driverZoneRef.current) {
          setRideRequest(ride)
          startAcceptCountdown()
          await sendRideRequestNotification(ride)
        }
      })
      .subscribe((status) => {
        console.log('Driver subscription status:', status)
      })
    rideRequestChannelRef.current = channel

    if (dispatchUpdatesChannelRef.current) {
      await supabase.removeChannel(dispatchUpdatesChannelRef.current)
    }
    const dispatchChannel = supabase
      .channel(`driver-dispatch-${driverId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rides',
        filter: `dispatched_driver_id=eq.${driverId}`
      }, async (payload) => {
        const ride = payload.new as any
        // Catches a later dispatch attempt reassigned to this driver (e.g. after an
        // earlier driver's 30s window expired), not just the very first INSERT.
        if (ride.status === 'requested' && !activeRideRef.current) {
          setRideRequest(ride)
          startAcceptCountdown()
          await sendRideRequestNotification(ride)
        }
      })
      .subscribe()
    dispatchUpdatesChannelRef.current = dispatchChannel

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
        const ride = payload.new as any
        // activeRideRef still holds the pre-update value here (it's synced by a separate
        // effect), so this reliably catches the false->true transition without depending
        // on payload.old, which Supabase only populates fully when REPLICA IDENTITY FULL is set.
        const justBoarded = ride.rider_confirmed_boarding && !activeRideRef.current?.rider_confirmed_boarding
        // Keep local state in lockstep with the row so handlers never act on a stale ride.
        setActiveRide(ride)
        setRideStatus(ride.status)

        if (justBoarded) {
          Alert.alert('Rider has boarded!', 'You can now start the ride.')
        }

        if (ride.status === 'completed') {
          setEarnings(prev => prev + (ride.final_fare_ghs || ride.fare_ghs))
          setRidesCount(prev => prev + 1)
          Alert.alert('Ride Complete!', `GH₵ ${ride.final_fare_ghs || ride.fare_ghs} earned!`)
        }
        if (ride.status === 'cancelled') {
          setRideRequest(null)
          Alert.alert('Ride Cancelled', 'The rider has cancelled this ride.')
        }
        // Terminal states clear the active ride; every other status
        // ('accepted' | 'rider_boarding' | 'in_progress' | 'arrived_destination' |
        // 'payment_pending') keeps it and just re-renders the action button.
        if (ride.status === 'completed' || ride.status === 'cancelled') {
          setActiveRide(null)
          setRideStatus('')
        }
      })
      .subscribe()
    driverRideUpdatesChannelRef.current = driverRideChannel
  }

  const handleSOS = async () => {
    if (sosSending) return // prevent double tap

    Alert.alert(
      '🚨 Emergency SOS',
      'Are you in danger? This will alert PragyaGo and your emergency contact.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Send SOS',
          style: 'destructive',
          onPress: async () => {
            setSosSending(true)
            try {
              // Get current location - fall back to last known if it fails
              let lat = userLat
              let lng = userLng

              try {
                const location = await Location.getCurrentPositionAsync({
                  accuracy: Location.Accuracy.Balanced,
                })
                lat = location.coords.latitude
                lng = location.coords.longitude
              } catch (e) {
                console.error('Location error - using last known')
              }

              if (!lat || !lng) {
                Alert.alert(
                  'Location Unavailable',
                  'Could not get your location. Please call 191 directly.',
                  [{ text: 'Call 191', onPress: () => Linking.openURL('tel:191') }]
                )
                return
              }

              const { data: { user } } = await supabase.auth.getUser()
              if (!user) {
                Alert.alert(
                  'SOS Failed',
                  'Could not send SOS alert. Please call emergency services directly.',
                  [
                    { text: 'Call Police (191)', onPress: () => Linking.openURL('tel:191') },
                    { text: 'Call Ambulance (193)', onPress: () => Linking.openURL('tel:193') },
                  ]
                )
                return
              }

              const rideId = activeRide?.id || null

              // Save SOS alert
              const { error: sosError } = await supabase
                .from('sos_alerts')
                .insert({
                  ride_id: rideId,
                  user_id: user.id,
                  user_role: 'driver',
                  lat,
                  lng,
                  triggered_at: new Date().toISOString(),
                })

              if (sosError) {
                Alert.alert(
                  'SOS Failed',
                  'Could not send SOS alert. Please call emergency services directly.',
                  [
                    { text: 'Call Police (191)', onPress: () => Linking.openURL('tel:191') },
                    { text: 'Call Ambulance (193)', onPress: () => Linking.openURL('tel:193') },
                  ]
                )
                return
              }

              // Update ride if active
              if (rideId) {
                const { error: rideError } = await supabase.from('rides').update({
                  sos_triggered: true,
                  sos_triggered_at: new Date().toISOString(),
                  sos_location_lat: lat,
                  sos_location_lng: lng,
                }).eq('id', rideId)
                if (rideError) console.error('SOS ride update error')
              }

              Alert.alert(
                '🚨 SOS Sent!',
                `Your emergency alert has been sent to PragyaGo support.\n\nYour location has been recorded.\n\nPlease call Ghana Police: 191\nAmbulance: 193\nFire: 192`,
                [
                  { text: 'Call Police (191)', onPress: () => Linking.openURL('tel:191') },
                  { text: 'OK' },
                ]
              )
            } catch (e) {
              Alert.alert(
                'SOS Failed',
                'Could not send SOS alert. Please call emergency services directly.',
                [{ text: 'Call 191', onPress: () => Linking.openURL('tel:191') }]
              )
            } finally {
              setSosSending(false)
            }
          },
        },
      ]
    )
  }

  const acceptRide = async () => {
    console.log('[ACCEPT] Function called, rideRequest:', rideRequest?.id)
    if (!rideRequest) return
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }

    try {
      // Use atomic function to prevent race conditions
      const { data, error } = await supabase.rpc('accept_ride', {
        p_ride_id: rideRequest.id,
        p_driver_id: driverIdRef.current,
        p_profile_id: profileIdRef.current
      })

      if (error) {
        Alert.alert('Error', 'Could not accept ride. Please try again.')
        setRideRequest(null)
        return
      }

      if (!data.success) {
        // Ride was taken by another driver
        Alert.alert('Ride Unavailable', 'This ride has already been taken by another driver.')
        setRideRequest(null)
        return
      }

      // Successfully accepted
      setActiveRide({ ...rideRequest, status: 'accepted', driver_id: driverIdRef.current })
      setRideStatus('accepted')
      setRideRequest(null)

    } catch (e: any) {
      console.error('Accept ride error:', e)
      Alert.alert('Error', 'Something went wrong. Please try again.')
      setRideRequest(null)
    }
  }
  function declineRide() {
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null }
    setRideRequest(null)
  }

  const handleArrivedAtPickup = async () => {
    try {
      if (!activeRide?.id) {
        Alert.alert('Error', 'No active ride found. Please try again.')
        return
      }

      const { data, error } = await supabase
        .from('rides')
        .update({ status: 'rider_boarding' })
        .eq('id', activeRide.id)
        .select()

      if (error) {
        Alert.alert('Error', `Status update failed: ${error.message}`)
        return
      }

      setRideStatus('rider_boarding')
      setActiveRide({ ...activeRide, status: 'rider_boarding' })
      Alert.alert('Arrived!', 'Waiting for rider to confirm boarding.')
    } catch (e: any) {
      console.error('Arrived at pickup error:', e)
      Alert.alert('Error', 'Something went wrong. Please try again.')
    }
  }

  async function handleStartRide() {
    if (!activeRide) return
    if (!activeRide?.rider_confirmed_boarding) {
      Alert.alert('Waiting', 'Please wait for the rider to confirm they have boarded.')
      return
    }
    const { error } = await supabase
      .from('rides')
      .update({
        status: 'in_progress',
        started_at: new Date().toISOString()
      })
      .eq('id', activeRide.id)
    if (!error) {
      setRideStatus('in_progress')
    } else {
      Alert.alert('Error', 'Could not start ride. Please try again.')
    }
  }

  async function handleArrivedAtDestination() {
    if (!activeRide) return
    const estimatedFare = parseFloat(activeRide?.fare_ghs || '0')
    const { error } = await supabase
      .from('rides')
      .update({ status: 'payment_pending' })
      .eq('id', activeRide.id)
    if (!error) {
      setRideStatus('payment_pending')
      Alert.alert(
        'Arrived at Destination!',
        `Fare: GH₵ ${estimatedFare.toFixed(2)}\nPlease wait for the rider to confirm payment.`
      )
    } else {
      Alert.alert('Error', 'Could not update status. Please try again.')
    }
  }

  async function handleConfirmPayment() {
    if (!activeRide) return
    if (!activeRide?.rider_confirmed_payment) {
      Alert.alert('Waiting', 'Please wait for the rider to confirm payment.')
      return
    }
    await handleCompleteRide()
  }

  async function handleCompleteRide() {
    if (!activeRide) return

    // Commission and earnings are calculated server-side
    const { data, error } = await supabase.rpc('complete_ride_and_deduct_commission', {
      p_ride_id: activeRide.id,
      p_driver_id: driverIdRef.current,
    })

    if (error || !data?.success) {
      console.error('Complete ride error')
      Alert.alert('Error', 'Could not confirm payment. Please try again.')
      return
    }

    // Reset ride state — isOnline is untouched, so the driver stays online automatically
    setActiveRide(null)
    setRideStatus('')
    Alert.alert(
      '🎉 Ride Complete!',
      `Fare: GH₵ ${data.fare}\nYour earnings: GH₵ ${data.earnings}\nCommission: GH₵ ${data.commission}`
    )
  }

  async function confirmBreakdown() {
    if (!breakdownReason) {
      Alert.alert('Select a reason', 'Please choose a reason for the breakdown.')
      return
    }
    if (breakdownReason === 'Other' && !otherBreakdownReason.trim()) {
      Alert.alert('Enter a reason', 'Please describe the issue.')
      return
    }
    if (!activeRide) return

    const finalReason = breakdownReason === 'Other' ? otherBreakdownReason.trim() : breakdownReason
    const selectedReason = BREAKDOWN_REASONS.find(r => r.label === breakdownReason)
    const exemptFromCommission = selectedReason?.exemptFromCommission || false

    setReportingBreakdown(true)
    try {
      if (!exemptFromCommission) {
        // Calculate commission on fare_ghs and add it to the driver's commission_owed
        const fare = parseFloat(activeRide.fare_ghs || '0')
        const commission = Math.round(fare * 0.15 * 100) / 100
        await supabase.rpc('increment_commission', { driver_id: driverIdRef.current, amount: commission })
      }
      // If exempt, no commission is charged — status stays 'pending_review' until admin decides

      const { error } = await supabase.from('driver_breakdowns').insert({
        ride_id: activeRide.id,
        driver_id: driverIdRef.current,
        rider_id: activeRide.rider_id,
        notes: finalReason,
        status: exemptFromCommission ? 'pending_review' : 'confirmed',
        commission_charged: !exemptFromCommission,
      })

      if (error) {
        Alert.alert('Error', 'Could not report breakdown. Please try again.')
        return
      }

      if (isOnline) await toggleOnline()

      setShowBreakdownModal(false)
      setBreakdownReason('')
      setOtherBreakdownReason('')

      if (exemptFromCommission) {
        Alert.alert(
          'Breakdown Reported',
          'Your breakdown has been reported for admin review. Commission will not be charged until a decision is made. You have been set to Offline.'
        )
      } else {
        Alert.alert(
          'Breakdown Reported',
          'You have been set to Offline. Commission has been charged for this incomplete ride. Please resolve the issue before going online again.'
        )
      }
    } catch (e) {
      console.log('Breakdown report error:', e)
      Alert.alert('Error', 'Something went wrong. Please try again.')
    } finally {
      setReportingBreakdown(false)
    }
  }

  function getActionButton(): { label: string; color: string; action: () => void; disabled?: boolean; disabledText?: string } | null {
    if (rideStatus === 'accepted') {
      return { label: 'Arrived at Pickup', color: theme.green, action: handleArrivedAtPickup }
    }
    if (rideStatus === 'rider_boarding') {
      return {
        label: 'Start Ride',
        color: theme.blue,
        action: handleStartRide,
        disabled: !activeRide?.rider_confirmed_boarding,
        disabledText: 'Waiting for rider to confirm boarding...'
      }
    }
    if (rideStatus === 'in_progress') {
      return { label: 'Arrived at Destination', color: theme.green, action: handleArrivedAtDestination }
    }
    if (rideStatus === 'arrived_destination' || rideStatus === 'payment_pending') {
      if (activeRide?.rider_confirmed_payment) {
        return { label: 'Payment Confirmed', color: theme.green, action: handleCompleteRide }
      }
      return {
        label: 'Waiting for Payment...',
        color: theme.amber,
        disabled: true,
        disabledText: 'Waiting for rider to confirm payment...',
        action: handleConfirmPayment
      }
    }
    return null
  }

  const riderInitials = (riderInfo?.full_name || '')
    .split(' ').map((n: string) => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 2) || '?'

  const actionButton = getActionButton()

  // Once the ride is underway the map should point at the dropoff, not the pickup.
  const headingToDropoff = ['in_progress', 'arrived_destination', 'payment_pending'].includes(rideStatus)
  const targetLat = activeRide
    ? (headingToDropoff ? parseFloat(activeRide.dropoff_lat) : parseFloat(activeRide.pickup_lat)) || 7.3349
    : 7.3349
  const targetLng = activeRide
    ? (headingToDropoff ? parseFloat(activeRide.dropoff_lng) : parseFloat(activeRide.pickup_lng)) || -2.3123
    : -2.3123

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      <SafeAreaView edges={["top"]} style={[styles.headerSafeArea, { backgroundColor: theme.green }]}> 
        <View style={styles.headerContent}>
          <View style={styles.row}>
            <Text style={[styles.driverName, { color: '#fff' }]}>{driverName}</Text>
            <View style={{ alignItems: 'flex-end', marginLeft: 'auto' }}>
              <Text style={[styles.earnings, { color: '#fff' }]}>GH₵ {earnings.toFixed(2)}</Text>
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
                <Text style={styles.pillText}>GH₵ {commissionOwed.toFixed(2)}</Text>
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
        {activeRide ? (
          <TouchableOpacity
            onPress={handleSOS}
            style={{
              position: 'absolute',
              top: insets.top + 16,
              right: 16,
              width: 52, height: 52,
              borderRadius: 26,
              backgroundColor: theme.red,
              justifyContent: 'center',
              alignItems: 'center',
              elevation: 8,
              shadowColor: theme.red,
              shadowOpacity: 0.5,
              shadowRadius: 8,
              zIndex: 100,
            }}
          >
            <Text style={{ color: 'white', fontSize: 11, fontWeight: '900' }}>SOS</Text>
          </TouchableOpacity>
        ) : null}
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
              backgroundColor: theme.green,
              borderWidth: 3,
              borderColor: 'white',
              justifyContent: 'center',
              alignItems: 'center',
              elevation: 8,
              shadowColor: theme.green,
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
              strokeColor={theme.green}
              onReady={(result) => {
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
            {inQueue ? (
              <>
                <View style={styles.queueBanner}>
                  <Feather name="clock" size={20} color={theme.blue} />
                  <Text style={styles.queueBannerText}>
                    Your zone is full. You are #{queuePosition} in the queue.
                  </Text>
                </View>
                <TouchableOpacity
                  style={[styles.fullButton, { backgroundColor: '#d9534f' }]}
                  onPress={leaveQueue}
                >
                  <Text style={styles.fullButtonText}>Leave Queue</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity
                style={[
                  styles.fullButton,
                  { backgroundColor: isOnline ? '#d9534f' : theme.green },
                  vehicleVerified === false && styles.fullButtonDisabled,
                ]}
                onPress={() => {
                  toggleOnline()
                }}
              >
                <Text style={styles.fullButtonText}>{isOnline ? 'Go Offline' : 'Go Online'}</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
            <View style={styles.rowBetween}>
              <Text style={[styles.rideStatus, { color: theme.text }]}>{getStatusLabel()}</Text>
              <View style={styles.fareBadge}><Text style={{ color: '#fff' }}>GH₵ {activeRide.fare ?? '0.00'}</Text></View>
            </View>

            {rideStatus === 'accepted' ? (
              <View style={{
                backgroundColor: theme.greenLight,
                borderRadius: 12,
                padding: 12,
                marginBottom: 12,
                flexDirection: 'row',
                justifyContent: 'space-around',
                alignItems: 'center',
              }}>
                <View style={{ alignItems: 'center' }}>
                  <Feather name="navigation" size={20} color={theme.green} />
                  <Text style={{ color: theme.green, fontSize: 18, fontWeight: '800', marginTop: 4 }}>
                    {distanceToPickup || '--'}
                  </Text>
                  <Text style={{ color: theme.textSecondary, fontSize: 12 }}>Distance</Text>
                </View>
                <View style={{ width: 1, height: 40, backgroundColor: theme.border }} />
                <View style={{ alignItems: 'center' }}>
                  <Feather name="clock" size={20} color={theme.green} />
                  <Text style={{ color: theme.green, fontSize: 18, fontWeight: '800', marginTop: 4 }}>
                    {etaToPickup || '--'}
                  </Text>
                  <Text style={{ color: theme.textSecondary, fontSize: 12 }}>ETA</Text>
                </View>
              </View>
            ) : null}

            {riderInfo && ['accepted', 'rider_boarding', 'in_progress', 'arrived_destination', 'payment_pending'].includes(rideStatus) ? (
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
                    {chatUnreadCount > 0 && (
                      <View style={{
                        position: 'absolute',
                        top: -4, right: -4,
                        backgroundColor: theme.red,
                        borderRadius: 10,
                        minWidth: 18, height: 18,
                        justifyContent: 'center',
                        alignItems: 'center',
                        paddingHorizontal: 4,
                      }}>
                        <Text style={{ color: 'white', fontSize: 10, fontWeight: '700' }}>
                          {chatUnreadCount > 9 ? '9+' : chatUnreadCount}
                        </Text>
                      </View>
                    )}
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

            {(rideStatus === 'arrived_destination' || rideStatus === 'payment_pending') && activeRide?.rider_confirmed_payment ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <Feather name="check-circle" size={20} color={theme.green} />
                <Text style={{ color: theme.green, fontWeight: '700', fontSize: 15 }}>Payment Confirmed!</Text>
              </View>
            ) : null}

            {actionButton ? (
              <>
                <TouchableOpacity
                  style={[
                    styles.fullButton,
                    { backgroundColor: actionButton.color },
                    actionButton.disabled && styles.fullButtonDisabled,
                  ]}
                  onPress={actionButton.action}
                  disabled={actionButton.disabled}
                >
                  <Text style={styles.fullButtonText}>{actionButton.label}</Text>
                </TouchableOpacity>
                {actionButton.disabled && actionButton.disabledText ? (
                  <Text style={{ fontSize: 12, color: theme.textSecondary, textAlign: 'center', marginTop: -6, marginBottom: 12 }}>
                    {actionButton.disabledText}
                  </Text>
                ) : null}
              </>
            ) : null}

            {rideStatus === 'in_progress' && (
              <TouchableOpacity
                style={[styles.outlinedButton, { borderColor: '#d9534f' }]}
                onPress={() => setShowBreakdownModal(true)}
              >
                <Text style={{ color: '#d9534f' }}>Report Breakdown</Text>
              </TouchableOpacity>
            )}
          </ScrollView>
        )}
      </View>

      <Modal visible={!!rideRequest} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalCard, { backgroundColor: theme.card }]}>
            <Text style={[styles.modalTitle, { color: theme.text }]}>🛺 New Ride Request!</Text>
            <Text style={{
              color: acceptCountdown <= 5 ? theme.red : theme.text,
              fontSize: 24, fontWeight: '800', textAlign: 'center'
            }}>
              {acceptCountdown}s
            </Text>

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
              <Pressable style={[styles.acceptButton, { backgroundColor: theme.green }]} onPress={() => {
                console.log('[ACCEPT BUTTON] Tapped!')
                acceptRide()
              }}><Text style={{ color: '#fff' }}>Accept</Text></Pressable>
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
              GH₵ {commissionOwed.toFixed(2)}
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
                router.push('/driver-screens/wallet')
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

      <Modal visible={showBreakdownModal} transparent animationType="fade">
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.6)',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
        }}>
          <View style={{
            backgroundColor: theme.card,
            borderRadius: 16,
            padding: 20,
            width: '100%',
            maxHeight: '85%',
          }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: theme.text, marginBottom: 4 }}>
              Report Breakdown
            </Text>
            <Text style={{ fontSize: 13, color: theme.textSecondary, marginBottom: 16 }}>
              Select the reason that best describes what happened.
            </Text>

            <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: 320 }}>
              {BREAKDOWN_REASONS.map((reason) => (
                <TouchableOpacity
                  key={reason.label}
                  style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 }}
                  onPress={() => setBreakdownReason(reason.label)}
                >
                  <View style={{
                    width: 20, height: 20, borderRadius: 10,
                    borderWidth: 2,
                    borderColor: breakdownReason === reason.label ? theme.green : theme.border,
                    justifyContent: 'center', alignItems: 'center',
                  }}>
                    {breakdownReason === reason.label ? (
                      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: theme.green }} />
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 14, color: theme.text, flex: 1 }}>{reason.label}</Text>
                </TouchableOpacity>
              ))}

              {breakdownReason ? (
                BREAKDOWN_REASONS.find(r => r.label === breakdownReason)?.exemptFromCommission ? (
                  <Text style={{ color: theme.green, fontSize: 13, marginTop: 8 }}>
                    ✓ Commission may be waived subject to admin review
                  </Text>
                ) : (
                  <Text style={{ color: theme.red, fontSize: 13, marginTop: 8 }}>
                    ✗ Commission will be charged for this breakdown
                  </Text>
                )
              ) : null}

              {breakdownReason === 'Other' ? (
                <TextInput
                  style={{
                    borderWidth: 1, borderColor: theme.border, borderRadius: 10,
                    paddingHorizontal: 14, paddingVertical: 12, fontSize: 14,
                    color: theme.text, backgroundColor: theme.background2,
                    minHeight: 70, textAlignVertical: 'top', marginTop: 12,
                  }}
                  placeholder="Describe what happened..."
                  placeholderTextColor={theme.textMuted}
                  value={otherBreakdownReason}
                  onChangeText={setOtherBreakdownReason}
                  multiline
                />
              ) : null}
            </ScrollView>

            <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: theme.background2 }}
                onPress={() => {
                  setShowBreakdownModal(false)
                  setBreakdownReason('')
                  setOtherBreakdownReason('')
                }}
                disabled={reportingBreakdown}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: theme.textSecondary }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: '#d9534f' }}
                onPress={confirmBreakdown}
                disabled={reportingBreakdown}
              >
                {reportingBreakdown
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ fontSize: 15, fontWeight: '700', color: '#fff' }}>Report Breakdown</Text>}
              </TouchableOpacity>
            </View>
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
  queueBanner: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#E6F1FB', borderRadius: 12, padding: 14, marginBottom: 14 },
  queueBannerText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#185FA5', lineHeight: 18 },
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
