import { applyDiscount, DiscountResult, recordDiscountUse } from '@/lib/discounts';
import { calculateZoneFare, FareResult, getFareSuggestions } from '@/lib/fares';
import { getDriverToken, sendPushNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useUnreadMessages } from '@/lib/useUnreadMessages';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  AppStateStatus,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  Vibration,
  View,
} from 'react-native';
import MapView, { AnimatedRegion, Marker, MarkerAnimated, Polyline } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const GOOGLE_API_KEY = (process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || 'AIzaSyCVOaCgGucjGUokQilWaK93ZZgT41h821k') ?? '';

const REQUEST_COOLDOWN = 10000; // 10 seconds between ride requests

const reverseGeocode = async (lat: number, lng: number): Promise<string> => {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_API_KEY}`
    );
    const data = await response.json();
    if (data.results && data.results.length > 0) {
      return data.results[0].formatted_address;
    }
    return 'Current Location';
  } catch (e) {
    return 'Current Location';
  }
};

function decodePolyline(encoded: string): { latitude: number; longitude: number }[] {
  const points: { latitude: number; longitude: number }[] = [];
  let index = 0, lat = 0, lng = 0;
  while (index < encoded.length) {
    let shift = 0, result = 0, byte: number;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : result >> 1;
    shift = result = 0;
    do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : result >> 1;
    points.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return points;
}

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
];

const CANCEL_REASONS = [
  'Driver is taking too long',
  'I ordered by mistake',
  'Change of plans',
  'Driver asked me to cancel',
  'Found another ride',
  'Other reason',
];

const PRAGYA_COLOR_MAP: { [key: string]: string } = {
  red: '#FF3B30', blue: '#2563eb', yellow: '#FFD60A',
  green: '#1D9E75', white: '#F2F2F7', black: '#1C1C1E',
  orange: '#FF9500', silver: '#8E8E93',
};

const haversineDistanceKm = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// Zone centers used for pickup zone detection (radius-based until zone_settings has boundaries)
const ZONE_CENTERS: Record<string, { lat: number; lng: number; radiusKm: number; name: string }> = {
  '30853fd6-cafa-4a12-9a82-db209ad6c450': { lat: 7.3349, lng: -2.3123, radiusKm: 15, name: 'Sunyani' },
  'e47b9116-1e40-46c1-8a8d-b9e7aee7c271': { lat: 7.4574, lng: -2.5884, radiusKm: 15, name: 'Berekum' },
  '7d9e8499-e07f-4e76-a07f-7e0c1f4639c2': { lat: 7.5912, lng: -1.9784, radiusKm: 15, name: 'Techiman' },
  'b5345518-41de-4ab9-8339-0fcaaeb460b6': { lat: 8.0607, lng: -1.7300, radiusKm: 15, name: 'Kintampo' },
};

const calculateETA = (driverLat: number, driverLng: number, riderLat: number, riderLng: number) => {
  const distanceKm = haversineDistanceKm(driverLat, driverLng, riderLat, riderLng);
  const etaMinutes = Math.round((distanceKm / 20) * 60);
  return etaMinutes < 1 ? '< 1 min' : `~${etaMinutes} min`;
};

export default function RiderHomeScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [userLat, setUserLat] = useState<number | null>(null);
  const [userLng, setUserLng] = useState<number | null>(null);
  const [sosSending, setSosSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [destination, setDestination] = useState('');
  const [stops, setStops] = useState<string[]>([]);
  const [newStop, setNewStop] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'momo'>('cash');
  const [nearbyDrivers, setNearbyDrivers] = useState<any[]>([]);
  const [fareEstimate, setFareEstimate] = useState<number | null>(null);
  const [fareBreakdown, setFareBreakdown] = useState<FareResult | null>(null);
  const [calculatingFare, setCalculatingFare] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [lastRequestTime, setLastRequestTime] = useState(0);
  const [currentRide, setCurrentRide] = useState<any>(null);
  const [rideStatus, setRideStatus] = useState('');
  const [driverInfo, setDriverInfo] = useState<any>(null);
  const [showDriverCard, setShowDriverCard] = useState(false);
  const [eta, setEta] = useState<string | null>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [selectedRating, setSelectedRating] = useState(0);
  const [completedRide, setCompletedRide] = useState<any>(null);
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [ratingComment, setRatingComment] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [riderConfirmedPayment, setRiderConfirmedPayment] = useState(false);
  // Supabase serializes Postgres `numeric` columns as strings, so despite the DB
  // value being a fare amount, final_fare_ghs/fare_ghs can arrive here as either type.
  const [finalFare, setFinalFare] = useState<number | string | null>(null);
  const [showFareAcceptModal, setShowFareAcceptModal] = useState(false);
  const [showCancelReasonModal, setShowCancelReasonModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [otherCancelReason, setOtherCancelReason] = useState('');
  const [cancellingRide, setCancellingRide] = useState(false);
  const rideSubscription = useRef<any>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dispatchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDispatchingRef = useRef(false);
  const requestingRef = useRef(false);
  const [dispatchAttempt, setDispatchAttempt] = useState(0);
  const driverLocationSubscription = useRef<any>(null);
  const locationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const currentRideRef = useRef<any>(null);
  const rideStatusRef = useRef<string>('');
  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const driverLocationAnim = useRef<any>(
    new AnimatedRegion({ latitude: 0, longitude: 0, latitudeDelta: 0.01, longitudeDelta: 0.01 })
  ).current;
  const destDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoneIdRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  const regionZoneIdsRef = useRef<string[]>([]);
  const [selectedDestCoords, setSelectedDestCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [driverLocation, setDriverLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [routePoints, setRoutePoints] = useState<{ latitude: number; longitude: number }[]>([]);
  const [routeDistance, setRouteDistance] = useState<string | null>(null);
  const [discountResult, setDiscountResult] = useState<DiscountResult | null>(null);
  const [originalFare, setOriginalFare] = useState<number | null>(null);
  const [destinationSuggestions, setDestinationSuggestions] = useState<any[]>([]);
  const [loadingDestSuggestions, setLoadingDestSuggestions] = useState(false);
  const [stopSuggestions, setStopSuggestions] = useState<any[]>([]);
  const [loadingStopSuggestions, setLoadingStopSuggestions] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [hasBoarded, setHasBoarded] = useState(false);
  const [boardingLoading, setBoardingLoading] = useState(false);
  const [pickupLocation, setPickupLocation] = useState('My Current Location');
  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);
  const [pickupSuggestions, setPickupSuggestions] = useState<any[]>([]);
  const [editingPickup, setEditingPickup] = useState(false);
  const [loadingPickupSuggestions, setLoadingPickupSuggestions] = useState(false);
  const pickupDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false);
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);
    });
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => { currentRideRef.current = currentRide; }, [currentRide]);
  useEffect(() => { rideStatusRef.current = rideStatus; }, [rideStatus]);

  const chatUnreadCount = useUnreadMessages(currentRide?.id ?? null, currentUserId);

  useEffect(() => {
    if (currentRide) {
      AsyncStorage.setItem('activeRide', JSON.stringify(currentRide));
      AsyncStorage.setItem('rideStatus', rideStatus);
    } else {
      AsyncStorage.removeItem('activeRide');
      AsyncStorage.removeItem('rideStatus');
    }
  }, [currentRide, rideStatus]);

  const restoreActiveRide = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check Supabase for active ride first (most reliable)
      const { data: activeRideData } = await supabase
        .from('rides')
        .select('*')
        .eq('rider_id', user.id)
        .in('status', ['requested', 'accepted', 'rider_boarding', 'in_progress', 'arrived_destination', 'payment_pending'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeRideData) {
        setCurrentRide(activeRideData);
        setRideStatus(activeRideData.status);
        setHasBoarded(false);
        setBoardingLoading(false);

        subscribeToRideUpdates(activeRideData.id);

        if (activeRideData.driver_id) {
          await fetchDriverInfo(activeRideData.driver_id);

          const { data: driverData } = await supabase
            .from('drivers')
            .select('id, current_lat, current_lng')
            .eq('id', activeRideData.driver_id)
            .single();

          if (driverData?.current_lat) {
            setDriverLocation({
              latitude: parseFloat(driverData.current_lat),
              longitude: parseFloat(driverData.current_lng),
            });
            subscribeToDriverLocation(driverData.id);
          }
        }
      }
    } catch (e) {
      console.log('Restore ride error:', e);
    }
  };

  useEffect(() => {
    restoreActiveRide();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      // Re-check for active ride when tab is focused
      if (!currentRide) {
        restoreActiveRide();
      }
    }, [currentRide])
  );

  const appStateRef = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      if (appStateRef.current.match(/inactive|background/) && nextAppState === 'active') {
        console.log('App came to foreground - restoring ride state');

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          router.replace('/');
          appStateRef.current = nextAppState;
          return;
        }

        if (currentRide?.id) {
          const { data: ride } = await supabase
            .from('rides')
            .select('*')
            .eq('id', currentRide.id)
            .single();

          if (ride) {
            if (ride.status === 'completed' || ride.status === 'cancelled') {
              // Realtime socket is typically dropped while backgrounded, so the
              // subscription handler's own cleanup may have been missed — mirror it here.
              setShowDriverCard(false);
              setShowFareAcceptModal(false);
              setCurrentRide(null);
              setRideStatus('');
              setDriverInfo(null);
              setEta(null);
              setFinalFare(null);
              setHasBoarded(false);
              if (rideSubscription.current) { supabase.removeChannel(rideSubscription.current); rideSubscription.current = null; }
              if (driverLocationSubscription.current) { supabase.removeChannel(driverLocationSubscription.current); driverLocationSubscription.current = null; }
              if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
              if (dispatchTimeoutRef.current) { clearTimeout(dispatchTimeoutRef.current); dispatchTimeoutRef.current = null; }
              isDispatchingRef.current = false;
              stopDriverTracking();
              if (ride.status === 'cancelled') Alert.alert('Ride Cancelled', 'Your ride was cancelled.');
            } else {
              setCurrentRide(ride);
              setRideStatus(ride.status);
            }
          }
        }
      }
      appStateRef.current = nextAppState;
    });

    return () => subscription.remove();
  }, [currentRide]);

  useEffect(() => {
    requestLocationPermission();
    fetchNearbyDrivers();
    fetchUnreadCount();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      userIdRef.current = user.id;
      setCurrentUserId(user.id);
      supabase.from('profiles').select('zone_id, role').eq('id', user.id).single()
        .then(({ data }: { data: { zone_id: string | null; role: string } | null }) => {
          const zoneId = data?.zone_id ?? null;
          zoneIdRef.current = zoneId;
          if (zoneId) initZoneData(zoneId);
        });
    });
    const interval = setInterval(fetchNearbyDrivers, 5000);
    return () => {
      clearInterval(interval);
      if (rideSubscription.current) supabase.removeChannel(rideSubscription.current);
      if (driverLocationSubscription.current) supabase.removeChannel(driverLocationSubscription.current);
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (pulseLoopRef.current) pulseLoopRef.current.stop();
      if (destDebounceRef.current) clearTimeout(destDebounceRef.current);
      if (stopDebounceRef.current) clearTimeout(stopDebounceRef.current);
      if (pickupDebounceRef.current) clearTimeout(pickupDebounceRef.current);
      if (dispatchTimeoutRef.current) clearTimeout(dispatchTimeoutRef.current);
      isDispatchingRef.current = false;
      locationWatcherRef.current?.remove();
    };
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel('driver-locations')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'drivers',
        filter: 'is_online=eq.true'
      }, (payload) => {
        const updated = payload.new as any;
        if (updated.current_lat && updated.current_lng) {
          setNearbyDrivers(prev => {
            const exists = prev.find(d => d.id === updated.id);
            if (exists) {
              return prev.map(d => d.id === updated.id ? {
                ...d,
                current_lat: updated.current_lat,
                current_lng: updated.current_lng
              } : d);
            } else if (updated.is_online) {
              return [...prev, updated];
            }
            return prev;
          });
        }
        // Remove driver if they go offline
        if (!updated.is_online) {
          setNearbyDrivers(prev => prev.filter(d => d.id !== updated.id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location Required', 'Please enable location to use PragyaGo.');
        return false;
      }
      getCurrentLocation();
      startLocationWatcher();
      return true;
    } catch (e) {
      console.error('Location permission error');
      Alert.alert('Error', 'Could not access location. Please check your settings.');
      return false;
    }
  };

  // Keeps userLat/userLng/location current for the whole session — not gated on
  // ride status, so it keeps running after a ride completes instead of going stale.
  const startLocationWatcher = async () => {
    if (locationWatcherRef.current) return;
    try {
      locationWatcherRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 10 },
        (loc) => {
          const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setUserLat(coords.latitude);
          setUserLng(coords.longitude);
          setLocation(coords);
          locationRef.current = coords;
        }
      );
    } catch (e) {
      console.log('Location watcher error:', e);
    }
  };

  const getCurrentLocation = async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setLocation(coords);
      setUserLat(coords.latitude);
      setUserLng(coords.longitude);
      locationRef.current = coords;
      setLoading(false);
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.05, longitudeDelta: 0.05 });

      const { data: { user } } = await supabase.auth.getUser();
      if (user) detectAndAssignZone(coords.latitude, coords.longitude, user.id);
    } catch { setLoading(false); }
  };

  const fetchNearbyDrivers = async () => {
    try {
      const { data: drivers } = await supabase
        .from('drivers')
        .select('id, current_lat, current_lng')
        .eq('is_online', true)
        .not('current_lat', 'is', null)
        .not('current_lng', 'is', null);
      console.log('Nearby drivers fetched:', drivers?.length);
      if (drivers) setNearbyDrivers(drivers);
    } catch (error) { console.error(error); }
  };

  const fetchDriverInfo = async (driverId: string) => {
    try {
      const { data: driver } = await supabase.from('drivers').select('*, profiles(full_name, phone, email)').eq('id', driverId).single();
      if (driver) {
        setDriverInfo(driver);
        if (location && driver.current_lat && driver.current_lng) {
          setEta(calculateETA(driver.current_lat, driver.current_lng, location.latitude, location.longitude));
        }
        setShowDriverCard(true);
      }
    } catch (error) { console.error('Error fetching driver info:', error); }
  };

  const startPulseAnimation = () => {
    if (pulseLoopRef.current) pulseLoopRef.current.stop();
    pulseAnim.setValue(0);
    pulseLoopRef.current = Animated.loop(
      Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true })
    );
    pulseLoopRef.current.start();
  };

  const stopDriverTracking = () => {
    if (pulseLoopRef.current) { pulseLoopRef.current.stop(); pulseLoopRef.current = null; }
    pulseAnim.setValue(0);
    setDriverLocation(null);
    setRoutePoints([]);
    setRouteDistance(null);
  };

  // Runs after a ride completes — currentRide/rideStatus/driverLocation are already
  // cleared by the 'completed' branch in subscribeToRideUpdates; this just resets the
  // request form and re-centers the map on a fresh GPS fix so it doesn't jump back to
  // wherever the map camera was left (e.g. the dropoff point) once the ride sheet closes.
  const resetAfterRide = async () => {
    setDestination('');
    setFareEstimate(0);
    setPickupLocation('My Current Location');

    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setUserLat(coords.latitude);
      setUserLng(coords.longitude);
      setLocation(coords);
      locationRef.current = coords;

      mapRef.current?.animateToRegion({
        ...coords,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
    } catch (e) {
      console.log('Location reset error:', e);
    }
  };

  const fetchRoute = async (originLat: number, originLng: number, destLat: number, destLng: number) => {
    if (!GOOGLE_API_KEY) return;
    try {
      const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${originLat},${originLng}&destination=${destLat},${destLng}&key=${GOOGLE_API_KEY}&mode=driving`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status !== 'OK' || !data.routes?.length) return;
      const route = data.routes[0];
      const leg = route.legs[0];
      const points = decodePolyline(route.overview_polyline.points);
      setRoutePoints(points);
      if (leg?.distance?.text) setRouteDistance(leg.distance.text);
      if (leg?.duration?.text) setEta(`~${leg.duration.text}`);
      if (points.length > 1) {
        mapRef.current?.fitToCoordinates(points, {
          edgePadding: { top: 80, right: 40, bottom: 220, left: 40 },
          animated: true,
        });
      }
    } catch (err) {
      console.error('Error fetching route:', err);
    }
  };

  const subscribeToDriverLocation = async (driverId: string) => {
    if (driverLocationSubscription.current) await supabase.removeChannel(driverLocationSubscription.current);
    startPulseAnimation();
    const channel = supabase
      .channel(`driver-location-${driverId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'drivers', filter: `id=eq.${driverId}` },
        (payload) => {
          const driver = payload.new;
          if (driver.current_lat && driver.current_lng) {
            const coords = { latitude: driver.current_lat, longitude: driver.current_lng };
            setDriverLocation(coords);
            driverLocationAnim.timing({
              latitude: coords.latitude,
              longitude: coords.longitude,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
              duration: 1000,
              useNativeDriver: false,
            } as any).start();

            const ride = currentRideRef.current;
            const target = rideStatusRef.current === 'in_progress' && ride?.dropoff_lat
              ? { latitude: ride.dropoff_lat, longitude: ride.dropoff_lng }
              : ride?.pickup_lat
                ? { latitude: ride.pickup_lat, longitude: ride.pickup_lng }
                : locationRef.current;
            if (target) {
              fetchRoute(driver.current_lat, driver.current_lng, target.latitude, target.longitude);
            } else {
              mapRef.current?.animateCamera({ center: coords }, { duration: 500 });
            }
          }
        });
    channel.subscribe();
    driverLocationSubscription.current = channel;
  };

  const detectAndAssignZone = async (lat: number, lng: number, userId: string) => {
    try {
      // Check if rider already has a zone
      const { data: profile } = await supabase
        .from('profiles')
        .select('zone_id')
        .eq('id', userId)
        .single();

      if (profile?.zone_id) return; // already has zone, no need to reassign

      // Detect zone from coordinates
      const zoneId = await detectZoneFromCoordinates(lat, lng);

      if (zoneId) {
        await supabase
          .from('profiles')
          .update({ zone_id: zoneId })
          .eq('id', userId);
      }
    } catch (e) {
      console.error('Zone assignment error');
    }
  };

  const detectZoneFromCoordinates = async (lat: number, lng: number): Promise<string | null> => {
    try {
      // Find zone where rider is within radius
      let closestZoneId: string | null = null;
      let closestDistance = Infinity;

      for (const [zoneId, center] of Object.entries(ZONE_CENTERS)) {
        const distance = haversineDistanceKm(lat, lng, center.lat, center.lng);
        if (distance <= center.radiusKm && distance < closestDistance) {
          closestDistance = distance;
          closestZoneId = zoneId;
        }
      }

      // If within a zone return it
      if (closestZoneId) return closestZoneId;

      // If not within any zone return nearest zone
      let nearestZoneId: string | null = null;
      let nearestDistance = Infinity;

      for (const [zoneId, center] of Object.entries(ZONE_CENTERS)) {
        const distance = haversineDistanceKm(lat, lng, center.lat, center.lng);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestZoneId = zoneId;
        }
      }

      return nearestZoneId;
    } catch (e) {
      console.error('Zone detection error');
      return null;
    }
  };

  const initZoneData = async (riderZoneId: string) => {
    try {
      const { data: riderZone } = await supabase
        .from('zones')
        .select('id, region_id, boundary_lat_min, boundary_lat_max, boundary_lng_min, boundary_lng_max')
        .eq('id', riderZoneId)
        .single();
      if (!riderZone?.region_id) return;

      const { data: regionZones } = await supabase
        .from('zones')
        .select('id, boundary_lat_min, boundary_lat_max, boundary_lng_min, boundary_lng_max')
        .eq('region_id', riderZone.region_id);
      if (!regionZones || regionZones.length === 0) return;

      regionZoneIdsRef.current = regionZones.map((z: any) => z.id);
    } catch (err) {
      console.error('Error initializing zone data:', err);
    }
  };

  const fetchGooglePlacesSuggestions = async (query: string, lat?: number, lng?: number): Promise<any[]> => {
    if (!GOOGLE_API_KEY) return [];
    try {
      const locationBias = lat != null && lng != null
        ? `&location=${lat},${lng}&radius=20000&strictbounds=false`
        : '';
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(query)}&key=${GOOGLE_API_KEY}&components=country:gh${locationBias}&language=en`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') return [];
      return (data.predictions ?? []).map((p: any) => ({
        id: `gplace-${p.place_id}`,
        label: p.description,
        placeId: p.place_id,
        source: 'place' as const,
      }));
    } catch (e) {
      console.log('Places fetch error:', e);
      return [];
    }
  };

  const fetchPlaceDetails = async (placeId: string): Promise<{ lat: number; lng: number } | null> => {
    if (!GOOGLE_API_KEY) return null;
    try {
      const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=geometry,name&key=${GOOGLE_API_KEY}`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.status !== 'OK') return null;
      const loc = data.result?.geometry?.location;
      return loc ? { lat: loc.lat, lng: loc.lng } : null;
    } catch { return null; }
  };

  const handleDestinationChange = (text: string) => {
    setDestination(text);
    setFareEstimate(null);
    if (destDebounceRef.current) clearTimeout(destDebounceRef.current);
    if (text.length < 2) { setDestinationSuggestions([]); return; }
    destDebounceRef.current = setTimeout(async () => {
      setLoadingDestSuggestions(true);
      try {
        const fareZoneIds = regionZoneIdsRef.current.length > 0 ? regionZoneIdsRef.current : zoneIdRef.current;
        const [zoneSuggestions, placeSuggestions] = await Promise.all([
          getFareSuggestions(fareZoneIds, text),
          fetchGooglePlacesSuggestions(text, location?.latitude, location?.longitude),
        ]);
        console.log('Zone suggestions:', zoneSuggestions.length, 'Place suggestions:', placeSuggestions.length);
        const zoneItems = zoneSuggestions.map((z: any, i: number) => ({
          id: `zone-${i}`,
          label: z.to_location,
          fare: z.rider_fare,
          source: 'zone' as const,
        }));
        const combined = [...zoneItems, ...placeSuggestions];
        console.log('Total suggestions set:', combined.length);
        setDestinationSuggestions(combined);
      } catch (e) {
        console.log('Suggestion fetch error:', e);
        setDestinationSuggestions([]);
      }
      finally { setLoadingDestSuggestions(false); }
    }, 500);
  };

  const handlePickupChange = (text: string) => {
    setPickupLocation(text);
    if (pickupDebounceRef.current) clearTimeout(pickupDebounceRef.current);
    if (text.length < 2) { setPickupSuggestions([]); return; }
    pickupDebounceRef.current = setTimeout(async () => {
      setLoadingPickupSuggestions(true);
      const results = await fetchGooglePlacesSuggestions(text, location?.latitude, location?.longitude);
      setPickupSuggestions(results);
      setLoadingPickupSuggestions(false);
    }, 500);
  };

  const resetPickupToGPS = () => {
    setPickupLocation('My Current Location');
    setPickupLat(null);
    setPickupLng(null);
    setPickupSuggestions([]);
    setEditingPickup(false);
  };

  const handleStopChange = (text: string) => {
    setNewStop(text);
    if (stopDebounceRef.current) clearTimeout(stopDebounceRef.current);
    if (text.length >= 2) {
      stopDebounceRef.current = setTimeout(async () => {
        setLoadingStopSuggestions(true);
        const results = await fetchGooglePlacesSuggestions(text, location?.latitude, location?.longitude);
        setStopSuggestions(results);
        setLoadingStopSuggestions(false);
      }, 500);
    } else {
      setStopSuggestions([]);
    }
  };

  const addStop = () => {
    if (!newStop.trim()) { Alert.alert('Enter a stop location'); return; }
    if (stops.length >= 3) { Alert.alert('Maximum 3 stops allowed'); return; }
    setStops([...stops, newStop.trim()]);
    setNewStop('');
    if (fareEstimate) {
      setFareEstimate(prev => prev ? Math.round((prev + 2) * 10) / 10 : prev);
      if (originalFare !== null) setOriginalFare(prev => prev !== null ? Math.round((prev + 2) * 10) / 10 : prev);
    }
  };

  const removeStop = (index: number) => {
    setStops(stops.filter((_, i) => i !== index));
    if (fareEstimate) {
      setFareEstimate(prev => prev ? Math.round((prev - 2) * 10) / 10 : prev);
      if (originalFare !== null) setOriginalFare(prev => prev !== null ? Math.round((prev - 2) * 10) / 10 : prev);
    }
  };

  const calculateFareAuto = async () => {
    if (!destination.trim()) {
      setFareEstimate(null);
      setFareBreakdown(null);
      setDiscountResult(null);
      setOriginalFare(null);
      return;
    }
    setCalculatingFare(true);
    setDiscountResult(null);
    setOriginalFare(null);
    setFareBreakdown(null);
    try {
      const fareResult = await calculateZoneFare(
        zoneIdRef.current, destination, stops.length,
        pickupLat ?? location?.latitude ?? 0,
        pickupLng ?? location?.longitude ?? 0,
        selectedDestCoords?.lat, selectedDestCoords?.lng
      );
      setFareBreakdown(fareResult);
      const userId = userIdRef.current;
      if (userId) {
        const disc = await applyDiscount(userId, destination, fareResult.riderFare);
        if (disc.discount) {
          setDiscountResult(disc);
          setOriginalFare(fareResult.riderFare);
          setFareEstimate(disc.finalFare);
        } else {
          setFareEstimate(fareResult.riderFare);
        }
      } else {
        setFareEstimate(fareResult.riderFare);
      }
    } catch (_) {
      // silent failure — user can try again by reselecting destination
    } finally {
      setCalculatingFare(false);
    }
  };

  useEffect(() => {
    if (destination.trim().length > 0) {
      calculateFareAuto();
    } else {
      setFareEstimate(0);
      setFareBreakdown(null);
      setDiscountResult(null);
      setOriginalFare(null);
    }
  }, [destination, stops, selectedDestCoords, pickupLat, pickupLng]);

  const subscribeToRideUpdates = async (rideId: string) => {
    try {
      if (rideSubscription.current) await supabase.removeChannel(rideSubscription.current);
      const channel = supabase
        .channel(`ride-update-${rideId}-${Date.now()}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` },
          async (payload) => {
            console.log('Ride UPDATE received, status:', payload.new?.status);
            const ride = payload.new;
            if (ride.id !== rideId) return;
            setCurrentRide(ride);
            setRideStatus(ride.status);

            if (ride.status === 'accepted' && ride.driver_id) {
              if (dispatchTimeoutRef.current) {
                clearTimeout(dispatchTimeoutRef.current);
                dispatchTimeoutRef.current = null;
              }
              isDispatchingRef.current = false;
              setDispatchAttempt(0);
              Alert.alert('Driver Found!', 'Your Pragya driver is on the way!');
              await fetchDriverInfo(ride.driver_id);
              await subscribeToDriverLocation(ride.driver_id);

              // Start tracking immediately rather than waiting for the driver's next location ping
              const { data: driverRow } = await supabase
                .from('drivers')
                .select('current_lat, current_lng')
                .eq('id', ride.driver_id)
                .single();
              if (driverRow?.current_lat && driverRow?.current_lng) {
                const driverCoords = { latitude: driverRow.current_lat, longitude: driverRow.current_lng };
                setDriverLocation(driverCoords);
                driverLocationAnim.timing({
                  ...driverCoords,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                  duration: 500,
                  useNativeDriver: false,
                } as any).start();
                const pickupTarget = ride.pickup_lat
                  ? { latitude: ride.pickup_lat, longitude: ride.pickup_lng }
                  : locationRef.current;
                if (pickupTarget) {
                  await fetchRoute(driverCoords.latitude, driverCoords.longitude, pickupTarget.latitude, pickupTarget.longitude);
                }
              }
            } else if (ride.status === 'rider_boarding') {
              setShowDriverCard(false);
              Vibration.vibrate([0, 400, 150, 400]);
            } else if (ride.status === 'in_progress') {
              setShowDriverCard(false);
              Alert.alert('Ride Started! 🎉', 'You are now on your way.');
            } else if (ride.status === 'arrived_destination' || ride.status === 'payment_pending') {
              // Driver has reached the destination — stop live route/pulse tracking,
              // but leave the driver marker visible at its last known position.
              if (pulseLoopRef.current) { pulseLoopRef.current.stop(); pulseLoopRef.current = null; }
              pulseAnim.setValue(0);
              setRoutePoints([]);
              setRouteDistance(null);
              const newFare = ride.final_fare_ghs || ride.fare_ghs;
              setFinalFare(newFare);
              // paymentPanel handles the rest automatically (rideStatus is already set above,
              // and it renders whenever rideStatus is 'arrived_destination' or 'payment_pending')
              if (ride.final_fare_ghs && Math.abs(ride.final_fare_ghs - ride.fare_ghs) > 0.5) {
                setShowFareAcceptModal(true);
              }
            } else if (ride.status === 'completed') {
              setShowDriverCard(false);
              setShowFareAcceptModal(false);
              setCompletedRide(ride);
              setShowReceiptModal(true);
              sendReceiptEmail(ride);
              setCurrentRide(null);
              setRideStatus('');
              setRiderConfirmedPayment(false);
              setFinalFare(null);
              setHasBoarded(false);
              if (rideSubscription.current) supabase.removeChannel(rideSubscription.current);
              if (driverLocationSubscription.current) { supabase.removeChannel(driverLocationSubscription.current); driverLocationSubscription.current = null; }
              if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
              stopDriverTracking();
              await resetAfterRide();
            } else if (ride.status === 'cancelled') {
              Alert.alert('Ride Cancelled', 'Your ride was cancelled.');
              setShowDriverCard(false);
              setShowFareAcceptModal(false);
              setCurrentRide(null);
              setRideStatus('');
              setDriverInfo(null);
              setEta(null);
              setFinalFare(null);
              setHasBoarded(false);
              if (rideSubscription.current) supabase.removeChannel(rideSubscription.current);
              if (driverLocationSubscription.current) { supabase.removeChannel(driverLocationSubscription.current); driverLocationSubscription.current = null; }
              if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
              if (dispatchTimeoutRef.current) { clearTimeout(dispatchTimeoutRef.current); dispatchTimeoutRef.current = null; }
              isDispatchingRef.current = false;
              stopDriverTracking();
            }
          });
      channel.subscribe((status) => {
        console.log('Rider subscription status:', status);
      });
      rideSubscription.current = channel;
    } catch (e) {
      console.error('Ride subscription error');
    }
  };

  const pollRideStatus = async (rideId: string) => {
    const { data: ride } = await supabase.from('rides').select('*').eq('id', rideId).single();
    if (ride && ride.status !== rideStatusRef.current) {
      console.log('Poll detected ride status change:', ride.status);
      setCurrentRide(ride);
      setRideStatus(ride.status);
    }
  };

  const confirmBoarding = async (rideId: string) => {
    if (boardingLoading) return; // prevent double tap
    setBoardingLoading(true);
    setHasBoarded(true); // optimistic — hides the button immediately, ahead of the DB round-trip
    try {
      const { error } = await supabase.from('rides').update({ rider_confirmed_boarding: true }).eq('id', rideId);
      if (error) {
        Alert.alert('Error', error.message);
        setHasBoarded(false);
        return;
      }
      if (currentRide) setCurrentRide({ ...currentRide, rider_confirmed_boarding: true });
      if (currentRide?.driver_id) {
        const driverToken = await getDriverToken(currentRide.driver_id);
        if (driverToken) {
          await sendPushNotification(
            driverToken,
            '✅ Rider Confirmed Boarding!',
            'The rider has confirmed they are on board. You can start the ride.',
            { type: 'boarding_confirmed', rideId },
            'ride-updates'
          );
        }
      }
    } catch (e) {
      console.log('Boarding error:', e);
      setHasBoarded(false);
    } finally {
      setBoardingLoading(false);
    }
  };

  const acceptNewFare = async () => {
    if (!currentRide) return;
    try {
      const { error } = await supabase.from('rides').update({ fare_accepted: true }).eq('id', currentRide.id);

      if (error) {
        Alert.alert('Error', 'Could not accept fare. Please try again.');
        return;
      }

      setShowFareAcceptModal(false);
      setFinalFare(finalFare);
      // paymentPanel will show automatically since rideStatus is payment_pending
    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    }
  };

  const sendReceiptEmail = async (ride: any) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const riderEmail = user?.email;
      const driverEmail = driverInfo?.profiles?.email;
      const recipients = [riderEmail, driverEmail].filter(Boolean);
      if (recipients.length === 0) return;
      const finalFareValue = ride.final_fare_ghs || ride.fare_ghs;

      await fetch('https://admin.pragyago.com/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: recipients,
          subject: `PragyaGo Ride Receipt - GH₵ ${finalFareValue}`,
          message: `
            Ride Receipt
            Date: ${new Date().toLocaleDateString()}
            From: ${ride.pickup_address}
            To: ${ride.dropoff_address}
            Fare: GH₵ ${finalFareValue}
            Payment: ${ride.payment_method}
            Driver: ${driverInfo?.profiles?.full_name || 'Your Driver'}
            Thank you for riding with PragyaGo!
          `,
          fromEmail: 'noreply@pragyago.com'
        })
      });
    } catch (e) {
      console.log('Receipt email error:', e);
    }
  };

  const confirmPayment = async (ride: any, fare: number | string) => {
    const fareAmount = typeof fare === 'number' ? fare : parseFloat(String(fare));
    setRiderConfirmedPayment(true);
    // The driver completes the ride (and settles commission server-side) after this flag is set
    const { error } = await supabase.from('rides').update({ rider_confirmed_payment: true }).eq('id', ride.id);
    if (error) {
      setRiderConfirmedPayment(false);
      Alert.alert('Error', 'Could not confirm payment. Please try again.');
      return;
    }
    Alert.alert('Payment Confirmed!', 'Waiting for driver to confirm...');
    if (ride.driver_id) {
      const driverToken = await getDriverToken(ride.driver_id);
      if (driverToken) {
        await sendPushNotification(
          driverToken,
          '💰 Payment Confirmed!',
          `Payment of GH₵ ${fareAmount} confirmed via ${ride.payment_method === 'cash' ? 'Cash' : 'Go Cash'}.`,
          { type: 'payment_confirmed', rideId: ride.id },
          'ride-updates'
        );
      }
    }
  };

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

              const rideId = currentRide?.id || null

              // Save SOS alert
              const { error: sosError } = await supabase
                .from('sos_alerts')
                .insert({
                  ride_id: rideId,
                  user_id: user.id,
                  user_role: 'rider',
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

  const dispatchToNearestDriver = async (rideId: string) => {
    if (isDispatchingRef.current) return;
    isDispatchingRef.current = true;

    try {
      const { data: rideRow } = await supabase
        .from('rides')
        .select('zone_id, status')
        .eq('id', rideId)
        .single();

      if (!rideRow || rideRow.status !== 'requested') return;

      // Broadcast model: all online drivers in the zone see the ride via their
      // realtime subscription. We just set a 2-minute cancellation backstop.
      dispatchTimeoutRef.current = setTimeout(async () => {
        const { data: check } = await supabase
          .from('rides')
          .select('status')
          .eq('id', rideId)
          .single();

        if (check?.status === 'requested') {
          await supabase.from('rides')
            .update({
              status: 'cancelled',
              cancellation_reason: 'No drivers accepted',
            })
            .eq('id', rideId)
            .eq('status', 'requested');

          setCurrentRide(null);
          setRideStatus('');
          isDispatchingRef.current = false;
          Alert.alert(
            'No Drivers Available',
            'No drivers accepted your ride. Please try again.'
          );
        }
      }, 120000);
    } catch (e) {
      console.error('Dispatch error');
      isDispatchingRef.current = false;
    }
  };

  const requestRide = async () => {
    if (requestingRef.current) return; // synchronous guard — instant, no re-render lag
    requestingRef.current = true;
    setRequesting(true);
    try {
    if (!destination.trim()) { Alert.alert('Enter Destination', 'Please enter your final destination.'); return; }
    if (!location) { Alert.alert('Location Error', 'Could not get your location.'); return; }
    if (!fareEstimate) { Alert.alert('Estimate Fare', 'Please estimate fare first.'); return; }
    if (selectedDestCoords && userLat != null && userLng != null) {
      const distanceDiff = Math.abs(selectedDestCoords.lat - userLat) + Math.abs(selectedDestCoords.lng - userLng);
      if (distanceDiff < 0.001) {
        Alert.alert('Invalid destination', 'Your destination cannot be the same as your current location.');
        return;
      }
    }

    // Rate limit check
    const now = Date.now();
    if (lastRequestTime > 0 && now - lastRequestTime < REQUEST_COOLDOWN) {
      const secondsLeft = Math.ceil((REQUEST_COOLDOWN - (now - lastRequestTime)) / 1000);
      Alert.alert('Please wait', `You can request another ride in ${secondsLeft} seconds.`);
      return;
    }

    // nearbyDrivers is kept fresh by a 5s poll (fetchNearbyDrivers) using the same
    // is_online + current_lat/lng filter, so it doubles as the "any driver online" check.
    if (nearbyDrivers.length === 0) {
      Alert.alert(
        'No Drivers Available',
        'There are no drivers available in your area right now. Please try again in a few minutes.',
        [{ text: 'OK' }]
      );
      return;
    }

    setRequesting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { Alert.alert('Error', 'Please login first.'); setRequesting(false); return; }
      const allStops = stops.map((stop, index) => ({ order: index + 1, address: stop, completed: false }));
      const resolvedPickupLat = pickupLat ?? location.latitude;
      const resolvedPickupLng = pickupLng ?? location.longitude;
      const pickupAddress = pickupLocation === 'My Current Location'
        ? await reverseGeocode(resolvedPickupLat, resolvedPickupLng)
        : pickupLocation;

      let zoneId = await detectZoneFromCoordinates(resolvedPickupLat, resolvedPickupLng);

      const { data: ride, error } = await supabase
        .from('rides')
        .insert([{
          rider_id: user.id,
          pickup_lat: resolvedPickupLat,
          pickup_lng: resolvedPickupLng,
          pickup_address: pickupAddress,
          dropoff_lat: selectedDestCoords?.lat ?? location.latitude + 0.01,
          dropoff_lng: selectedDestCoords?.lng ?? location.longitude + 0.01,
          dropoff_address: destination,
          stops: allStops, current_stop: 0,
          status: 'requested', fare_ghs: originalFare ?? fareEstimate,
          estimated_fare: fareEstimate,
          expected_distance_km: fareBreakdown?.expectedDistanceKm ?? null,
          payment_method: paymentMethod,
          zone_id: zoneId,
          created_at: new Date().toISOString(),
          ...(discountResult?.discount ? {
            discount_id: discountResult.discount.id,
            discount_amount: discountResult.discountAmount,
            discounted_fare: discountResult.finalFare,
          } : {}),
        }])
        .select().single();
      if (error || !ride) { Alert.alert('Error', error?.message ?? 'Could not create ride request. Please try again.'); }
      else {
        setCurrentRide(ride); setRideStatus('requested');
        setLastRequestTime(Date.now());
        setHasBoarded(false);
        setBoardingLoading(false);
        setDispatchAttempt(0);
        await subscribeToRideUpdates(ride.id);
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = setInterval(() => pollRideStatus(ride.id), 5000);

        // Sequential dispatch owns the "no driver responded" cancellation + alert from
        // here — dispatchToNearestDriver cascades through drivers on its own 30s timeout
        // and cancels the ride itself once no more candidates are left.
        dispatchToNearestDriver(ride.id);

        if (discountResult?.discount) await recordDiscountUse(discountResult.discount.id);
        Alert.alert('Ride Requested 🛺', stops.length > 0 ? `Finding a driver... ${stops.length} stop(s) added.` : 'Finding a nearby driver...');
        setDestination(''); setStops([]); setFareEstimate(null); setFareBreakdown(null); setDiscountResult(null); setOriginalFare(null);
        setPickupLocation('My Current Location'); setPickupLat(null); setPickupLng(null);
      }
    } catch (error: any) {
      console.error('Ride request error:', error?.code || 'unknown');
      Alert.alert('Error', error?.message || 'Could not request ride. Please try again.');
    }
    finally { setRequesting(false); }
    } finally {
      requestingRef.current = false;
      setRequesting(false);
    }
  };

  const handleShareRide = async () => {
    try {
      const driverName = driverInfo?.profiles?.full_name || 'Your driver';
      const plateNumber = driverInfo?.plate_number || '';
      const pragyaColor = driverInfo?.pragya_color || '';
      const pickup = currentRide?.pickup_address || 'Current location';
      const dropoff = currentRide?.dropoff_address || 'Destination';

      const message = `🛺 I'm on a PragyaGo ride!\n\nDriver: ${driverName}\nPragya: ${pragyaColor} - ${plateNumber}\nFrom: ${pickup}\nTo: ${dropoff}\n\nTrack my ride on PragyaGo`;

      await Share.share({
        message: message,
        title: 'Track My PragyaGo Ride'
      });
    } catch (e) {
      console.error('Share error:', e);
    }
  };

  const handleCancelRide = () => {
    setShowCancelReasonModal(true);
  };

  const cancelRide = async (reason: string) => {
    if (!currentRide) return;
    setCancellingRide(true);
    try {
      const { error } = await supabase
        .from('rides')
        .update({ status: 'cancelled', cancellation_reason: reason, cancelled_by: 'rider' })
        .eq('id', currentRide.id);

      if (error) {
        Alert.alert('Error', 'Could not cancel ride. Please try again.');
        return;
      }

      // Only reset state if cancellation actually succeeded
      setCurrentRide(null); setRideStatus(''); setDriverInfo(null);
      setShowDriverCard(false); setEta(null); setFinalFare(null);
      if (rideSubscription.current) await supabase.removeChannel(rideSubscription.current);
      if (driverLocationSubscription.current) { await supabase.removeChannel(driverLocationSubscription.current); driverLocationSubscription.current = null; }
      if (pollIntervalRef.current) { clearInterval(pollIntervalRef.current); pollIntervalRef.current = null; }
      if (dispatchTimeoutRef.current) { clearTimeout(dispatchTimeoutRef.current); dispatchTimeoutRef.current = null; }
      isDispatchingRef.current = false;
      stopDriverTracking();
      setShowCancelReasonModal(false);
      setCancelReason('');
      setOtherCancelReason('');
      Alert.alert('Ride Cancelled', 'Your ride has been cancelled.');
    } catch (e) {
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setCancellingRide(false);
    }
  };

  const confirmCancelRide = () => {
    if (!currentRide?.id) {
      Alert.alert('Error', 'No active ride found');
      return;
    }
    if (!cancelReason) { Alert.alert('Select a reason', 'Please choose why you are cancelling.'); return; }
    if (cancelReason === 'Other reason' && !otherCancelReason.trim()) {
      Alert.alert('Enter a reason', 'Please describe your reason for cancelling.');
      return;
    }
    const finalReason = cancelReason === 'Other reason' ? otherCancelReason.trim() : cancelReason;
    cancelRide(finalReason);
  };

  const submitRating = async () => {
    if (selectedRating === 0) { Alert.alert('Please select a rating'); return; }
    setSubmittingRating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !completedRide || !driverInfo) return;
      const { error } = await supabase.from('ratings').insert([{
        ride_id: completedRide.id, rated_by: user.id,
        rated_user: driverInfo.profile_id, score: selectedRating,
        comment: ratingComment.trim() || null,
        created_at: new Date().toISOString(),
      }]);

      if (error) {
        Alert.alert('Error', 'Could not submit rating. Please try again.');
        return;
      }

      const { data: ratings } = await supabase.from('ratings').select('score').eq('rated_user', driverInfo.profile_id);
      if (ratings && ratings.length > 0) {
        const avgRating = ratings.reduce((sum: number, r: { score: number }) => sum + r.score, 0) / ratings.length;
        await supabase.from('drivers').update({ rating: Math.round(avgRating * 10) / 10 }).eq('id', driverInfo.id);
      }

      // Only close the modal and clear state if the insert actually succeeded
      Alert.alert('Thank you!', `You rated your driver ${selectedRating} star${selectedRating > 1 ? 's' : ''}!`);
      setShowRatingModal(false);
      setSelectedRating(0); setRatingComment(''); setCompletedRide(null); setDriverInfo(null); setEta(null);
    } catch (error) {
      console.error('Error submitting rating:', error);
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setSubmittingRating(false);
    }
  };

  const fetchUnreadCount = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { count } = await supabase
        .from('user_notifications')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('is_read', false);
      setUnreadCount(count ?? 0);
    } catch {}
  };

  const getRideStatusLabel = () => {
    if (rideStatus === 'requested') return '🔍 Finding your Pragya...';
    if (rideStatus === 'accepted') {
      const parts = [routeDistance, eta ? `ETA: ${eta}` : null].filter(Boolean).join('  ·  ');
      return `🛺 Driver on the way!${parts ? `  ${parts}` : ''}`;
    }
    if (rideStatus === 'rider_boarding') return '🛺 Driver has arrived!';
    if (rideStatus === 'in_progress') {
      return `🎉 Ride in progress${routeDistance ? `  ·  ${routeDistance} to go` : ''}${eta ? `  ·  ${eta}` : ''}`;
    }
    if (rideStatus === 'arrived_destination') return '📍 Arrived at destination';
    if (rideStatus === 'payment_pending') return '💰 Confirm payment';
    return '';
  };

  const displayFare = finalFare
    ? (typeof finalFare === 'string' ? parseFloat(finalFare) : finalFare)
    : parseFloat(String(currentRide?.discounted_fare ?? currentRide?.fare_ghs ?? 0));
  const driverInitials = (driverInfo?.profiles?.full_name || '')
    .split(' ').map((n: string) => n[0]).filter(Boolean).join('').toUpperCase().slice(0, 2) || '?';

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      {!keyboardVisible && (
      <View style={styles.mapContainer}>
        <TouchableOpacity style={styles.bellBtn} onPress={() => router.push('/notifications' as any)}>
          <Feather name="bell" size={22} color={theme.text} />
          {unreadCount > 0 ? (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unreadCount}</Text>
            </View>
          ) : null}
        </TouchableOpacity>

        {currentRide && eta && ['accepted', 'rider_boarding', 'in_progress'].includes(rideStatus) ? (
          <View style={{
            position: 'absolute',
            top: 64,
            left: 16,
            right: 16,
            zIndex: 15,
            backgroundColor: theme.card,
            borderRadius: 14,
            padding: 14,
            flexDirection: 'row',
            alignItems: 'center',
            elevation: 8,
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 8,
          }}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, color: theme.textSecondary }}>
                {rideStatus === 'accepted' ? 'Driver arriving in' :
                 rideStatus === 'rider_boarding' ? 'Driver is waiting' :
                 'Arriving at destination in'}
              </Text>
              <Text style={{ fontSize: 22, fontWeight: '800', color: theme.text }}>
                {rideStatus === 'rider_boarding' ? 'Board your Pragya' : eta}
              </Text>
              {routeDistance && rideStatus === 'accepted' ? (
                <Text style={{ fontSize: 13, color: theme.textSecondary, marginTop: 2 }}>
                  {routeDistance} away
                </Text>
              ) : null}
            </View>
            <View style={{
              width: 48, height: 48, borderRadius: 24,
              backgroundColor: theme.green,
              justifyContent: 'center', alignItems: 'center',
            }}>
              <Text style={{ fontSize: 24 }}>🛺</Text>
            </View>
          </View>
        ) : null}

        {currentRide && ['arrived_destination', 'payment_pending'].includes(rideStatus) ? (
          <View style={{
            position: 'absolute',
            top: 64,
            left: 16,
            right: 16,
            zIndex: 15,
            backgroundColor: theme.card,
            borderRadius: 14,
            padding: 14,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            elevation: 8,
            shadowColor: '#000',
            shadowOpacity: 0.15,
            shadowRadius: 8,
          }}>
            <Feather name="check-circle" size={22} color={theme.green} />
            <Text style={{ fontSize: 16, fontWeight: '700', color: theme.text }}>You have arrived!</Text>
          </View>
        ) : null}

        {currentRide ? (
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

        {loading || !location ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.loadingText}>Getting your location...</Text>
          </View>
        ) : (
          <MapView ref={mapRef} style={styles.map} customMapStyle={customMapStyle} mapType="standard" zoomEnabled={true} scrollEnabled={true}
            initialRegion={{ latitude: location.latitude, longitude: location.longitude, latitudeDelta: 0.05, longitudeDelta: 0.05 }}>
            {userLat != null && userLng != null ? (
              <Marker coordinate={{ latitude: userLat, longitude: userLng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                <View style={{ alignItems: 'center', justifyContent: 'center', width: 60, height: 60 }}>
                  {/* Outer pulse ring */}
                  <View style={{
                    position: 'absolute',
                    width: 56, height: 56, borderRadius: 28,
                    backgroundColor: 'rgba(24,95,165,0.12)',
                  }} />
                  {/* Middle ring */}
                  <View style={{
                    position: 'absolute',
                    width: 36, height: 36, borderRadius: 18,
                    backgroundColor: 'rgba(24,95,165,0.2)',
                  }} />
                  {/* Center dot */}
                  <View style={{
                    width: 20, height: 20, borderRadius: 10,
                    backgroundColor: '#185FA5',
                    borderWidth: 3,
                    borderColor: 'white',
                    elevation: 8,
                    shadowColor: '#185FA5',
                    shadowOpacity: 0.5,
                    shadowRadius: 6,
                  }} />
                </View>
              </Marker>
            ) : null}
            {nearbyDrivers.map((driver) => (
              <Marker
                key={driver.id}
                coordinate={{
                  latitude: parseFloat(driver.current_lat),
                  longitude: parseFloat(driver.current_lng),
                }}
                anchor={{ x: 0.5, y: 0.5 }}
                tracksViewChanges={false}
              >
                <View style={{
                  width: 44, height: 44, borderRadius: 22,
                  backgroundColor: theme.green,
                  borderWidth: 2.5,
                  borderColor: 'white',
                  justifyContent: 'center',
                  alignItems: 'center',
                  elevation: 6,
                  shadowColor: theme.green,
                  shadowOpacity: 0.4,
                  shadowRadius: 6,
                }}>
                  <Text style={{ fontSize: 22 }}>🛺</Text>
                </View>
              </Marker>
            ))}
            {driverLocation ? (
              <MarkerAnimated coordinate={driverLocationAnim} title="Your Driver">
                <View style={styles.trackingMarkerWrap}>
                  <Animated.View
                    style={[
                      styles.pulseCircle,
                      {
                        transform: [{ scale: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [1, 1.8] }) }],
                        opacity: pulseAnim.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                      },
                    ]}
                  />
                  <View style={styles.tricycleMarker}>
                    <Text style={styles.tricycleEmoji}>🛺</Text>
                  </View>
                </View>
              </MarkerAnimated>
            ) : null}
            {routePoints.length > 1 ? (
              <Polyline coordinates={routePoints} strokeColor={theme.green} strokeWidth={4} />
            ) : null}
          </MapView>
        )}
        {!loading && userLat != null && userLng != null ? (
          <TouchableOpacity
            style={styles.locateMeBtn}
            onPress={() => {
              mapRef.current?.animateToRegion({
                latitude: userLat,
                longitude: userLng,
                latitudeDelta: 0.05,
                longitudeDelta: 0.05,
              });
            }}
          >
            <Feather name="navigation" size={20} color="#185FA5" />
          </TouchableOpacity>
        ) : null}
      </View>
      )}

      {currentRide ? (
        <View
          style={{
            backgroundColor: theme.card,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingHorizontal: 20,
            paddingTop: 16,
            paddingBottom: Math.max(insets.bottom, 16),
            elevation: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: -4 },
            shadowOpacity: 0.1,
            shadowRadius: 12,
            maxHeight: '70%',
          }}
        >
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
          {['accepted', 'rider_boarding'].includes(rideStatus) ? (
            <View style={{
              backgroundColor: rideStatus === 'rider_boarding' ? theme.green : theme.card,
              borderWidth: rideStatus === 'rider_boarding' ? 0 : 1,
              borderColor: theme.border,
              borderRadius: 14,
              paddingVertical: 14,
              paddingHorizontal: 16,
              marginBottom: 12,
              alignItems: 'center',
            }}>
              <Text style={{
                fontSize: 16,
                fontWeight: '700',
                color: rideStatus === 'rider_boarding' ? '#fff' : theme.text,
              }}>
                {rideStatus === 'rider_boarding' ? '🛺 Driver has arrived!' : '🛺 Driver is on the way'}
              </Text>
            </View>
          ) : null}
          {rideStatus === 'requested' && (
            <TouchableOpacity
              style={{
                marginTop: 12,
                paddingVertical: 12,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: theme.red,
                alignItems: 'center',
              }}
              onPress={handleCancelRide}
            >
              <Text style={{ color: theme.red, fontWeight: '600' }}>Cancel Ride</Text>
            </TouchableOpacity>
          )}
          {driverInfo && ['accepted', 'rider_boarding', 'in_progress'].includes(rideStatus) ? (
        <View style={styles.driverInlineCard}>
          <View style={styles.driverInlineTopRow}>
            <View style={styles.driverInlineAvatar}>
              <Text style={styles.driverInlineAvatarText}>{driverInitials}</Text>
            </View>
            <View style={styles.driverInlineInfo}>
              <Text style={styles.driverInlineName} numberOfLines={1}>{driverInfo?.profiles?.full_name || 'Driver'}</Text>
              <View style={styles.driverInlineBadgesRow}>
                <View style={styles.pragyaColorBadge}>
                  <View style={[styles.pragyaColorBadgeDot, { backgroundColor: PRAGYA_COLOR_MAP[driverInfo?.pragya_color] || theme.textMuted }]} />
                  <Text style={styles.pragyaColorBadgeText}>
                    {driverInfo?.pragya_color ? driverInfo.pragya_color.charAt(0).toUpperCase() + driverInfo.pragya_color.slice(1) : 'Unknown'}
                  </Text>
                </View>
                <View style={styles.platePill}>
                  <Text style={styles.platePillText}>{driverInfo?.plate_number || 'N/A'}</Text>
                </View>
              </View>
            </View>
            <View style={styles.driverInlineRating}>
              <Feather name="star" size={14} color="#F59E0B" />
              <Text style={styles.driverInlineRatingText}>{(driverInfo?.rating || 0).toFixed(1)}</Text>
            </View>
          </View>
          <Text style={styles.driverInlineStatus}>
            {rideStatus === 'rider_boarding' ? 'Driver has arrived' : 'Your driver is on the way'}
          </Text>
          <View style={styles.driverInlineActions}>
            <TouchableOpacity style={styles.driverInlineChatBtn} onPress={() => router.push(('/chat/' + currentRide.id) as any)}>
              <Feather name="message-circle" size={18} color={theme.green} />
              <Text style={styles.driverInlineChatBtnText}>Chat</Text>
              {chatUnreadCount > 0 && (
                <View style={{
                  position: 'absolute',
                  top: -6, right: -6,
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
            <TouchableOpacity style={styles.driverInlineCallBtn} onPress={() => router.push(('/call/' + currentRide.id) as any)}>
              <Feather name="phone" size={18} color="#185FA5" />
              <Text style={styles.driverInlineCallBtnText}>Call</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {currentRide && rideStatus === 'rider_boarding' ? (
        <View style={styles.boardingPanel}>
          <Feather name="check-circle" size={32} color={theme.green} />
          <Text style={styles.boardingTitle}>Your driver has arrived!</Text>
          <Text style={styles.boardingSubtitle}>Confirm once you're on board to start your ride.</Text>
          {hasBoarded || currentRide.rider_confirmed_boarding ? (
            <Text style={styles.boardingWaitingText}>Waiting for driver to start the ride...</Text>
          ) : (
            <TouchableOpacity
              style={[styles.boardingButton, boardingLoading && { backgroundColor: theme.greenLight }]}
              onPress={() => confirmBoarding(currentRide.id)}
              disabled={boardingLoading}
            >
              {boardingLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.boardingButtonText}>I'm Boarding</Text>
              )}
            </TouchableOpacity>
          )}
        </View>
      ) : null}

      {currentRide && ['arrived_destination', 'payment_pending'].includes(rideStatus) ? (
        <View style={styles.paymentPanel}>
          <Text style={styles.paymentPanelLabel}>Amount Due</Text>
          <Text style={styles.paymentPanelFare}>GH₵ {displayFare}</Text>
          <Text style={styles.paymentPanelMethod}>
            {currentRide.payment_method === 'cash' ? 'Cash' : 'Go Cash'}
          </Text>
          {!riderConfirmedPayment ? (
            <TouchableOpacity style={styles.paymentPanelButton} onPress={() => confirmPayment(currentRide, displayFare)}>
              <Text style={styles.paymentPanelButtonText}>I've Paid</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.boardingWaitingText}>Payment confirmed! Waiting for driver to verify...</Text>
          )}
        </View>
      ) : null}

        <View style={styles.rideStatusBanner}>
          <Text style={styles.rideStatusText}>{getRideStatusLabel()}</Text>
          {rideStatus === 'requested' ? (
            <Text style={styles.dispatchAttemptText}>
              {dispatchAttempt > 0 ? `Trying another driver... (${dispatchAttempt})` : 'Finding your driver...'}
            </Text>
          ) : null}
          <Text style={styles.rideStatusSub}>To: {currentRide.dropoff_address}</Text>
          {(currentRide.stops?.length ?? 0) > 0 ? (
            <Text style={styles.rideStatusStops}>{`Stops: ${currentRide.stops.map((s: any) => s.address).join(' → ')}`}</Text>
          ) : null}
          <View style={styles.fareRow}>
            <Text style={styles.rideStatusFare}>GH₵ {displayFare}</Text>
            {!!finalFare && finalFare !== currentRide.fare_ghs ? (
              <Text style={styles.originalFare}>(est. GH₵ {currentRide.fare_ghs})</Text>
            ) : null}
          </View>
          <View style={styles.rideActions}>
            {driverInfo && (rideStatus === 'accepted' || rideStatus === 'rider_boarding') ? (
              <TouchableOpacity style={styles.viewDriverButton} onPress={() => setShowDriverCard(true)}>
                <Text style={styles.viewDriverButtonText}>View Driver</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {driverInfo ? (
            <TouchableOpacity
              onPress={handleShareRide}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 6,
                paddingVertical: 10,
                borderWidth: 1,
                borderColor: theme.border,
                borderRadius: 10,
                marginTop: 8,
              }}
            >
              <Feather name="share-2" size={16} color={theme.textSecondary} />
              <Text style={{ color: theme.textSecondary, fontSize: 14 }}>Share Ride</Text>
            </TouchableOpacity>
          ) : null}

          {rideStatus === 'accepted' || rideStatus === 'rider_boarding' ? (
            <TouchableOpacity
              onPress={handleCancelRide}
              style={{
                borderWidth: 1,
                borderColor: theme.red,
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: 'center',
                marginTop: 8,
              }}
            >
              <Text style={{ color: theme.red, fontSize: 15, fontWeight: '600' }}>
                Cancel Ride
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
          </ScrollView>
        </View>
      ) : null}

      {!currentRide ? (
        <View
          style={[
            {
              backgroundColor: theme.card,
              borderTopLeftRadius: keyboardVisible ? 0 : 24,
              borderTopRightRadius: keyboardVisible ? 0 : 24,
              paddingTop: 16,
              paddingBottom: Math.max(insets.bottom, 16),
              elevation: 8,
            },
            keyboardVisible ? { flex: 1 } : { maxHeight: '65%' }
          ]}
        >
          <ScrollView
            ref={scrollViewRef}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={{
              paddingHorizontal: 20,
              paddingBottom: 16,
            }}
          >
          <Text style={styles.panelTitle}>Where do you want to go?</Text>
          <Text style={styles.driversCount}>
            {nearbyDrivers.length > 0 ? `🛺 ${nearbyDrivers.length} Pragya driver${nearbyDrivers.length > 1 ? 's' : ''} nearby` : '😔 No drivers nearby right now'}
          </Text>
          {/* Pickup location */}
          <View style={styles.pickupInputContainer}>
            {editingPickup ? (
              <View style={styles.inputWrapper}>
                <TextInput
                  style={[styles.inputWithClear, styles.pickupTextInput]}
                  placeholder="Search pickup location..."
                  value={pickupLocation}
                  onChangeText={handlePickupChange}
                  autoFocus
                  placeholderTextColor="#999"
                />
                <TouchableOpacity style={styles.clearBtn} onPress={resetPickupToGPS}>
                  <Text style={styles.clearBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <TouchableOpacity style={styles.pickupDisplay} onPress={() => {
                if (pickupLocation === 'My Current Location') setPickupLocation('');
                setEditingPickup(true);
              }}>
                <Text style={[styles.pickupDisplayText, pickupLat ? styles.pickupDisplayTextCustom : styles.pickupDisplayTextDefault]} numberOfLines={1}>
                  {pickupLat ? pickupLocation : '📍 My Current Location'}
                </Text>
                {pickupLat ? (
                  <TouchableOpacity onPress={resetPickupToGPS} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                    <Text style={styles.clearBtnText}>✕</Text>
                  </TouchableOpacity>
                ) : null}
              </TouchableOpacity>
            )}
            {loadingPickupSuggestions ? <ActivityIndicator size="small" color={theme.green} style={styles.suggestionsLoader} /> : null}
            {pickupSuggestions.length > 0 ? (
              <View style={styles.suggestionsCard}>
                {pickupSuggestions.map((item, index) => (
                  <TouchableOpacity
                    key={item.id ?? index}
                    style={[styles.suggestionItem, index < pickupSuggestions.length - 1 && styles.suggestionItemBorder]}
                    onPress={async () => {
                      if (pickupDebounceRef.current) clearTimeout(pickupDebounceRef.current);
                      setPickupLocation(item.label);
                      setPickupSuggestions([]);
                      setEditingPickup(false);
                      if (item.placeId) {
                        const coords = await fetchPlaceDetails(item.placeId);
                        if (coords) {
                          setPickupLat(coords.lat);
                          setPickupLng(coords.lng);
                        }
                      }
                    }}
                  >
                    <Text style={styles.suggestionText} numberOfLines={2}>📍 {item.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </View>
          {/* Route connector */}
          <View style={styles.routeConnector}>
            <View style={styles.connectorContent}>
              <View style={styles.connectorDotGreen} />
              <View style={styles.connectorLine} />
              <View style={styles.connectorDotBlue} />
            </View>
          </View>
          <Text style={styles.inputLabel}>Final Destination</Text>
          <View style={styles.destInputContainer}>
            <View style={styles.inputWrapper}>
              <TextInput style={styles.inputWithClear} placeholder="Enter final destination" value={destination} onChangeText={handleDestinationChange} placeholderTextColor={theme.placeholder} />
              {destination.length > 0 ? (
                <TouchableOpacity style={styles.clearBtn} onPress={() => { setDestination(''); setDestinationSuggestions([]); setFareEstimate(0); setFareBreakdown(null); setDiscountResult(null); setOriginalFare(null); setSelectedDestCoords(null); }}>
                  <Text style={styles.clearBtnText}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {loadingDestSuggestions ? <ActivityIndicator size="small" color="#2563eb" style={styles.suggestionsLoader} /> : null}
            {destinationSuggestions.length > 0 ? (
              <>
                {/* Backdrop — tapping anywhere below the dropdown dismisses it instead of
                    hitting whatever button/input happens to be buried underneath. Sized well
                    past this container's own (small) height since RN doesn't clip absolutely
                    positioned views to their parent's bounds. */}
                <TouchableOpacity
                  style={{
                    position: 'absolute',
                    top: 0, left: 0, right: 0, bottom: -600,
                    zIndex: 99,
                  }}
                  onPress={() => setDestinationSuggestions([])}
                  activeOpacity={1}
                />
                <View style={styles.suggestionsCard}>
              {destinationSuggestions.map((item, index) => {
                const prev = index > 0 ? destinationSuggestions[index - 1] : null;
                const showFaresHeader = item.source === 'zone' && prev?.source !== 'zone';
                const showPlacesHeader = item.source === 'place' && prev?.source !== 'place';
                return (
                  <React.Fragment key={item.id ?? index}>
                    {showFaresHeader ? <Text style={styles.sectionLabel}>📍 Fixed Fares</Text> : null}
                    {showPlacesHeader ? <Text style={styles.sectionLabel}>🗺️ All Places</Text> : null}
                    <TouchableOpacity
                      style={[
                        styles.suggestionItem,
                        item.source === 'zone' && styles.suggestionItemZone,
                        index < destinationSuggestions.length - 1 && styles.suggestionItemBorder,
                      ]}
                      onPress={async () => {
                        // Cancel pending debounce so typing suggestions don't reopen the dropdown
                        if (destDebounceRef.current) clearTimeout(destDebounceRef.current);
                        setDestination(item.label);
                        setDestinationSuggestions([]);
                        if (item.source === 'place' && item.placeId) {
                          const coords = await fetchPlaceDetails(item.placeId);
                          if (coords) setSelectedDestCoords(coords);
                          // useEffect watching selectedDestCoords will retrigger calculateFareAuto with the exact coords
                        }
                      }}
                    >
                      {item.source === 'zone' ? (
                        <View style={styles.suggestionRowZone}>
                          <Text style={styles.suggestionTextZone} numberOfLines={1}>📍 {item.label}</Text>
                          <Text style={styles.suggestionFare}>GH₵ {item.fare}</Text>
                        </View>
                      ) : (
                        <Text style={styles.suggestionText} numberOfLines={2}>🗺️ {item.label}</Text>
                      )}
                    </TouchableOpacity>
                  </React.Fragment>
                );
              })}
                </View>
              </>
            ) : null}
          </View>
          {stops.length > 0 ? (
            <View style={styles.stopsContainer}>
              <Text style={styles.stopsTitle}>{`Stops (${stops.length}/3)`}</Text>
              {stops.map((stop, index) => (
                <View key={index} style={styles.stopRow}>
                  <Text style={styles.stopNumber}>{index + 1}</Text>
                  <Text style={styles.stopText}>{stop}</Text>
                  <TouchableOpacity onPress={() => removeStop(index)}>
                    <Text style={styles.removeStop}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : null}
          {stops.length < 3 ? (
            <View>
              <View style={styles.addStopRow}>
                <TextInput style={styles.stopInput} placeholder="Add a stop (optional)" value={newStop} onChangeText={handleStopChange} placeholderTextColor={theme.placeholder} />
                <TouchableOpacity style={styles.addStopButton} onPress={addStop}>
                  <Text style={styles.addStopButtonText}>+ Add</Text>
                </TouchableOpacity>
              </View>
              {loadingStopSuggestions ? <ActivityIndicator size="small" color="#2563eb" style={styles.suggestionsLoader} /> : null}
              {stopSuggestions.length > 0 ? (
                <View style={styles.suggestionsCard}>
                  {stopSuggestions.map((item, index) => (
                    <TouchableOpacity
                      key={item.id ?? index}
                      style={[styles.suggestionItem, index < stopSuggestions.length - 1 && styles.suggestionItemBorder]}
                      onPress={() => { setNewStop(item.label); setStopSuggestions([]); }}
                    >
                      <Text style={styles.suggestionText} numberOfLines={2}>📌 {item.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </View>
          ) : null}
          {calculatingFare ? (
            <ActivityIndicator color={theme.green} style={{ marginVertical: 12 }} />
          ) : null}
          {fareEstimate ? (
            <View style={styles.fareBadgeWrapper}>
              <View style={styles.fareBadge}>
                <Text style={styles.fareBadgeAmount}>GH₵ {fareEstimate.toFixed(2)}</Text>
                <Text style={styles.fareBadgeLabel}>Estimated Fare</Text>
              </View>
            </View>
          ) : null}
          <View style={styles.paymentContainer}>
            <Text style={styles.paymentLabel}>Payment Method</Text>
            <View style={styles.paymentOptions}>
              <TouchableOpacity style={[styles.paymentOption, paymentMethod === 'cash' ? styles.paymentActiveCash : null]} onPress={() => setPaymentMethod('cash')}>
                <Text style={[styles.paymentText, paymentMethod === 'cash' ? styles.paymentTextActive : null]}>Cash</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.paymentOption, paymentMethod === 'momo' ? styles.paymentActiveMomo : null]} onPress={() => setPaymentMethod('momo')}>
                <Text style={[styles.paymentText, paymentMethod === 'momo' ? styles.paymentTextActive : null]}>Go Cash</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity style={[styles.requestButton, requesting && styles.buttonDisabled]} onPress={requestRide} disabled={requesting}>
            {requesting ? <ActivityIndicator color="#fff" /> : <Text style={styles.requestButtonText}>🛺 Request Pragya</Text>}
          </TouchableOpacity>
          </ScrollView>
        </View>
      ) : null}

      {/* Cancellation Reason Modal */}
      <Modal visible={showCancelReasonModal} transparent animationType="slide">
        <View style={[styles.modalOverlay, { paddingTop: insets.top }]}>
          <View style={[styles.cancelReasonCard, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.cancelReasonTitle}>Why are you cancelling?</Text>
            {CANCEL_REASONS.map((reason) => (
              <TouchableOpacity
                key={reason}
                style={styles.cancelReasonRow}
                onPress={() => setCancelReason(reason)}
              >
                <View style={[styles.radioOuter, cancelReason === reason && styles.radioOuterActive]}>
                  {cancelReason === reason ? <View style={styles.radioInner} /> : null}
                </View>
                <Text style={styles.cancelReasonText}>{reason}</Text>
              </TouchableOpacity>
            ))}
            {cancelReason === 'Other reason' ? (
              <TextInput
                style={styles.cancelReasonInput}
                placeholder="Please describe your reason..."
                placeholderTextColor={theme.placeholder}
                value={otherCancelReason}
                onChangeText={setOtherCancelReason}
                multiline
              />
            ) : null}
            <View style={styles.cancelReasonActions}>
              <TouchableOpacity
                style={styles.cancelReasonCancelBtn}
                onPress={() => { setShowCancelReasonModal(false); setCancelReason(''); setOtherCancelReason(''); }}
                disabled={cancellingRide}
              >
                <Text style={styles.cancelReasonCancelBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.cancelReasonConfirmBtn, cancellingRide && styles.buttonDisabled]}
                onPress={confirmCancelRide}
                disabled={cancellingRide}
              >
                {cancellingRide
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={styles.cancelReasonConfirmBtnText}>Confirm Cancellation</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Fare Accept Modal */}
      <Modal visible={showFareAcceptModal} transparent animationType="slide">
        <View style={[styles.modalOverlay, { paddingTop: insets.top }]}>
          <View style={styles.fareAcceptCard}>
            <Text style={styles.fareAcceptTitle}>Fare Updated</Text>
            <Text style={styles.fareAcceptSubtitle}>
              {currentRide?.expected_distance_km && currentRide?.actual_distance_km
                ? `You travelled ${Math.round(currentRide.actual_distance_km * 10) / 10} km instead of ${Math.round(currentRide.expected_distance_km * 10) / 10} km expected.`
                : 'Based on your actual trip distance, the fare has been recalculated.'}
            </Text>
            <View style={styles.fareCompare}>
              <View style={styles.fareCompareItem}>
                <Text style={styles.fareCompareLabel}>Estimated</Text>
                <Text style={styles.fareCompareOld}>GH₵ {currentRide?.fare_ghs}</Text>
              </View>
              <Text style={styles.fareArrow}>→</Text>
              <View style={styles.fareCompareItem}>
                <Text style={styles.fareCompareLabel}>Final</Text>
                <Text style={styles.fareCompareNew}>GH₵ {finalFare}</Text>
              </View>
            </View>
            {currentRide?.actual_distance_km ? (
              <Text style={styles.fareDistance}>{`Actual distance: ${currentRide.actual_distance_km} km`}</Text>
            ) : null}
            <TouchableOpacity style={styles.acceptFareButton} onPress={acceptNewFare}>
              <Text style={styles.acceptFareButtonText}>Accept & Pay GH₵ {finalFare}</Text>
            </TouchableOpacity>
            <Text style={styles.fareAcceptNote}>By accepting, you agree to pay the updated fare.</Text>
          </View>
        </View>
      </Modal>

      {/* Driver Card Modal */}
      <Modal visible={showDriverCard} transparent animationType="slide">
        <View style={[styles.modalOverlay, { paddingTop: insets.top }]}>
          <View style={styles.driverCard}>
            <Text style={styles.driverCardTitle}>Your Driver</Text>
            {(eta || routeDistance) && (
              <View style={styles.etaBadge}>
                <Text style={styles.etaText}>
                  {routeDistance ? `${routeDistance}` : ''}{routeDistance && eta ? '  ·  ' : ''}{eta ? `ETA: ${eta}` : ''}
                </Text>
              </View>
            )}
            <View style={styles.driverPhotoSection}>
              {driverInfo?.photo_url ? (
                <Image source={{ uri: driverInfo.photo_url }} style={styles.driverPhoto} />
              ) : (
                <View style={styles.driverPhotoPlaceholder}><Text style={{ fontSize: 40 }}>👤</Text></View>
              )}
              <View style={styles.driverRatingBadge}>
                <Text style={styles.driverRatingText}>⭐ {(driverInfo?.rating || 0).toFixed(1)}</Text>
              </View>
            </View>
            <Text style={styles.driverName}>{driverInfo?.profiles?.full_name || 'Driver'}</Text>
            <Text style={styles.driverRides}>{driverInfo?.total_rides || 0} rides completed</Text>
            <View style={styles.pragyaDetails}>
              <View style={styles.pragyaDetailRow}>
                <Text style={styles.pragyaDetailLabel}>Pragya Color</Text>
                <View style={styles.pragyaColorRow}>
                  <View style={[styles.pragyaColorDot, { backgroundColor: PRAGYA_COLOR_MAP[driverInfo?.pragya_color] || '#999' }]} />
                  <Text style={styles.pragyaDetailValue}>{driverInfo?.pragya_color ? driverInfo.pragya_color.charAt(0).toUpperCase() + driverInfo.pragya_color.slice(1) : 'Unknown'}</Text>
                </View>
              </View>
              <View style={styles.pragyaDetailRow}>
                <Text style={styles.pragyaDetailLabel}>Plate Number</Text>
                <Text style={styles.pragyaDetailValue}>{driverInfo?.plate_number || 'Not set'}</Text>
              </View>
              <View style={[styles.pragyaDetailRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.pragyaDetailLabel}>Phone</Text>
                <Text style={styles.pragyaDetailValue}>{driverInfo?.profiles?.phone || 'Not set'}</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.closeCardButton} onPress={() => setShowDriverCard(false)}>
              <Text style={styles.closeCardButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Receipt Modal */}
      <Modal visible={showReceiptModal} transparent animationType="slide">
        <View style={[styles.modalOverlay, { paddingTop: insets.top }]}>
          <View style={[styles.receiptCard, { paddingBottom: insets.bottom + 16 }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={{ alignItems: 'center' }}>
                <Image source={require('@/assets/images/icon.png')} style={styles.receiptLogo} resizeMode="contain" />
                <Text style={styles.receiptTitle}>Ride Receipt</Text>
                <Text style={styles.receiptDate}>
                  {new Date().toLocaleDateString()} · {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>

              <View style={styles.receiptDivider} />

              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>From</Text>
                <Text style={styles.receiptDetailValue} numberOfLines={2}>{completedRide?.pickup_address}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>To</Text>
                <Text style={styles.receiptDetailValue} numberOfLines={2}>{completedRide?.dropoff_address}</Text>
              </View>
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Driver</Text>
                <Text style={styles.receiptDetailValue}>
                  {driverInfo?.profiles?.full_name || 'Your Driver'}{driverInfo?.plate_number ? ` · ${driverInfo.plate_number}` : ''}
                </Text>
              </View>
              {completedRide?.actual_distance_km || completedRide?.expected_distance_km ? (
                <View style={styles.receiptDetailRow}>
                  <Text style={styles.receiptDetailLabel}>Distance</Text>
                  <Text style={styles.receiptDetailValue}>
                    {Number(completedRide?.actual_distance_km || completedRide?.expected_distance_km).toFixed(1)} km
                  </Text>
                </View>
              ) : null}
              <View style={styles.receiptDetailRow}>
                <Text style={styles.receiptDetailLabel}>Payment</Text>
                <Text style={styles.receiptDetailValue}>
                  {completedRide?.payment_method === 'cash' ? 'Cash' : 'Go Cash'}
                </Text>
              </View>

              <View style={styles.receiptDivider} />

              <View style={{ alignItems: 'center' }}>
                <Text style={styles.receiptFareLabel}>Fare</Text>
                <Text style={styles.receiptFareAmount}>GH₵ {completedRide?.final_fare_ghs || completedRide?.fare_ghs}</Text>
                <Text style={styles.receiptThanks}>Thank you for riding with PragyaGo! 🛺</Text>
              </View>

              <TouchableOpacity
                style={styles.receiptShareBtn}
                onPress={() => Share.share({
                  message: `PragyaGo Ride Receipt\nFrom: ${completedRide?.pickup_address}\nTo: ${completedRide?.dropoff_address}\nFare: GH₵ ${completedRide?.final_fare_ghs || completedRide?.fare_ghs}`
                })}
              >
                <Feather name="share-2" size={18} color={theme.green} />
                <Text style={styles.receiptShareBtnText}>Share Receipt</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.receiptDoneBtn}
                onPress={() => { setShowReceiptModal(false); setShowRatingModal(true); }}
              >
                <Text style={styles.receiptDoneBtnText}>Done</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Rating Modal */}
      <Modal visible={showRatingModal} transparent animationType="slide">
        <View style={[styles.modalOverlay, { paddingTop: insets.top }]}>
          <View style={[styles.ratingCard, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.ratingTitle}>Ride Complete!</Text>
            <Text style={styles.ratingTopFare}>GH₵ {completedRide?.final_fare_ghs || completedRide?.fare_ghs}</Text>
            <Text style={styles.ratingSubtitle}>How was your experience?</Text>
            {driverInfo?.photo_url ? (
              <Image source={{ uri: driverInfo.photo_url }} style={styles.ratingDriverPhoto} />
            ) : (
              <View style={styles.ratingDriverPhotoPlaceholder}>
                <Feather name="user" size={40} color={theme.green} />
              </View>
            )}
            <Text style={styles.ratingDriverName}>{driverInfo?.profiles?.full_name || 'Your Driver'}</Text>
            {completedRide?.discount_amount > 0 ? (
              <View style={styles.receiptBox}>
                <Text style={styles.receiptRow}>Original fare: <Text style={styles.receiptValue}>GH₵ {completedRide.final_fare_ghs || completedRide.fare_ghs}</Text></Text>
                <Text style={styles.receiptRow}>Discount: <Text style={styles.receiptDiscount}>-GH₵ {completedRide.discount_amount}</Text></Text>
                <Text style={styles.receiptRowTotal}>You paid: <Text style={styles.receiptTotal}>GH₵ {completedRide.discounted_fare ?? (completedRide.fare_ghs - completedRide.discount_amount)}</Text></Text>
              </View>
            ) : (
              <Text style={styles.ratingFare}>Fare paid: GH₵ {completedRide?.final_fare_ghs || completedRide?.fare_ghs}</Text>
            )}
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setSelectedRating(star)}>
                  <Feather name="star" size={36} color={selectedRating >= star ? '#F59E0B' : theme.border} />
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.ratingLabel}>
              {selectedRating === 1 ? 'Poor' : selectedRating === 2 ? 'Fair' : selectedRating === 3 ? 'Good' : selectedRating === 4 ? 'Very Good' : selectedRating === 5 ? 'Excellent!' : 'Tap a star to rate'}
            </Text>
            <TextInput
              style={styles.ratingCommentInput}
              placeholder="Add a comment (optional)"
              placeholderTextColor={theme.placeholder}
              value={ratingComment}
              onChangeText={setRatingComment}
              multiline
              numberOfLines={3}
            />
            <TouchableOpacity style={[styles.submitRatingButton, (selectedRating === 0 || submittingRating) && styles.buttonDisabled]} onPress={submitRating} disabled={selectedRating === 0 || submittingRating}>
              {submittingRating ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitRatingText}>Submit Rating</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.skipRatingButton} onPress={() => { setShowRatingModal(false); setSelectedRating(0); setRatingComment(''); setCompletedRide(null); setDriverInfo(null); }}>
              <Text style={styles.skipRatingText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: c.background },
  mapContainer: { flex: 1, minHeight: 300 },
  map: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: c.textSecondary },
  rideStatusBanner: { backgroundColor: '#185FA5', padding: 16, borderRadius: 10 },
  dispatchAttemptText: { fontSize: 12, color: '#E6F1FB', marginBottom: 2 },
  driverInlineCard: { backgroundColor: c.card, borderLeftWidth: 4, borderLeftColor: c.green, borderRadius: 16, padding: 16, marginBottom: 12 },
  driverInlineTopRow: { flexDirection: 'row', alignItems: 'center' },
  driverInlineAvatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.green, justifyContent: 'center', alignItems: 'center' },
  driverInlineAvatarText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  driverInlineInfo: { flex: 1, marginLeft: 12 },
  driverInlineName: { fontSize: 15, fontWeight: '700', color: c.text },
  driverInlineBadgesRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 },
  pragyaColorBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  pragyaColorBadgeDot: { width: 9, height: 9, borderRadius: 4.5 },
  pragyaColorBadgeText: { fontSize: 12, color: c.textSecondary },
  platePill: { backgroundColor: c.background2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  platePillText: { fontSize: 12, fontWeight: '600', color: c.textSecondary },
  driverInlineRating: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  driverInlineRatingText: { fontSize: 13, fontWeight: '700', color: c.text },
  driverInlineStatus: { fontSize: 13, color: c.green, fontWeight: '600', marginTop: 12 },
  driverInlineActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  driverInlineChatBtn: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: c.greenLight, borderRadius: 10, paddingVertical: 10 },
  driverInlineChatBtnText: { fontSize: 13, fontWeight: '600', color: c.green },
  driverInlineCallBtn: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6, backgroundColor: c.blueLight, borderRadius: 10, paddingVertical: 10 },
  driverInlineCallBtnText: { fontSize: 13, fontWeight: '600', color: '#185FA5' },
  rideStatusText: { fontSize: 15, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  rideStatusSub: { fontSize: 13, color: '#E6F1FB', marginBottom: 2 },
  rideStatusStops: { fontSize: 12, color: '#E6F1FB', marginBottom: 2, fontStyle: 'italic' },
  fareRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  rideStatusFare: { fontSize: 14, color: '#fff', fontWeight: 'bold' },
  originalFare: { fontSize: 11, color: '#E6F1FB' },
  rideActions: { flexDirection: 'row', gap: 10 },
  cancelButton: { flex: 1, backgroundColor: c.red, paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  cancelButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  boardingPanel: { backgroundColor: c.card, alignItems: 'center', padding: 20, gap: 4 },
  boardingTitle: { fontSize: 18, fontWeight: '700', color: c.text, marginTop: 8 },
  boardingSubtitle: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginBottom: 12 },
  boardingButton: { backgroundColor: c.green, borderRadius: 14, paddingVertical: 16, width: '100%', alignItems: 'center' },
  boardingButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  boardingWaitingText: { fontSize: 13, color: c.textSecondary, fontStyle: 'italic', marginTop: 4 },
  paymentPanel: { backgroundColor: c.card, alignItems: 'center', padding: 20 },
  paymentPanelLabel: { fontSize: 13, color: c.textSecondary, fontWeight: '600' },
  paymentPanelFare: { fontSize: 36, fontWeight: '900', color: c.green, marginVertical: 4 },
  paymentPanelMethod: { fontSize: 13, color: c.textSecondary, marginBottom: 16 },
  paymentPanelButton: { backgroundColor: c.green, borderRadius: 14, paddingVertical: 16, width: '100%', alignItems: 'center' },
  paymentPanelButtonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  viewDriverButton: { flex: 1, backgroundColor: '#fff', paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  viewDriverButtonText: { color: '#185FA5', fontWeight: 'bold', fontSize: 14 },
  panelTitle: { fontSize: 18, fontWeight: 'bold', color: c.text, marginBottom: 4 },
  driversCount: { fontSize: 13, color: c.green, marginBottom: 12 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, backgroundColor: c.input, color: c.text, marginBottom: 10 },
  pickupInputContainer: { position: 'relative', zIndex: 10000, backgroundColor: 'rgba(29,158,117,0.08)', borderWidth: 1, borderColor: 'rgba(29,158,117,0.2)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 2, marginBottom: 0 },
  pickupDisplay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  pickupDisplayText: { flex: 1, fontSize: 14, fontWeight: '600' },
  pickupDisplayTextDefault: { color: c.green },
  pickupDisplayTextCustom: { color: c.text },
  pickupTextInput: { borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 4, paddingVertical: 0 },
  routeConnector: { paddingLeft: 16, paddingVertical: 3 },
  connectorContent: { alignItems: 'center', width: 12 },
  connectorDotGreen: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.green },
  connectorLine: { width: 2, height: 14, backgroundColor: '#CBD5E1', marginVertical: 1 },
  connectorDotBlue: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#185FA5' },
  destInputContainer: { position: 'relative', zIndex: 9999, marginBottom: 10 },
  inputWrapper: { position: 'relative' },
  inputWithClear: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 16, paddingRight: 40, paddingVertical: 12, fontSize: 14, backgroundColor: c.input, color: c.text },
  clearBtn: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 4 },
  clearBtnText: { fontSize: 14, color: c.textSecondary, fontWeight: '600' },
  stopsContainer: { backgroundColor: c.input, borderRadius: 8, padding: 10, marginBottom: 10 },
  stopsTitle: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8 },
  stopRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: c.border },
  stopNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#2563eb', color: '#fff', textAlign: 'center', lineHeight: 24, fontSize: 12, fontWeight: 'bold', marginRight: 10 },
  stopText: { flex: 1, fontSize: 13, color: c.text },
  removeStop: { fontSize: 16, color: c.red, paddingHorizontal: 8 },
  addStopRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  stopInput: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, backgroundColor: c.input, color: c.text },
  addStopButton: { backgroundColor: c.green, paddingHorizontal: 14, borderRadius: 8, justifyContent: 'center' },
  addStopButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  estimateButton: { backgroundColor: c.card, paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  estimateButtonText: { color: c.text, fontWeight: '600' },
  fareContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#E1F5EE', padding: 12, borderRadius: 8, marginBottom: 10 },
  fareInfo: { flex: 1, marginRight: 8 },
  fareLabel: { fontSize: 14, color: '#085041', fontWeight: '600' },
  fareNote: { fontSize: 11, color: c.green, marginTop: 1 },
  fareBadgeWrapper: { marginBottom: 12, alignItems: 'center' },
  fareBadge: { backgroundColor: c.green, borderRadius: 12, paddingVertical: 16, paddingHorizontal: 24, alignItems: 'center', width: '100%', shadowColor: c.green, shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6, marginBottom: 8 },
  fareBadgeOriginal: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textDecorationLine: 'line-through', marginBottom: 2 },
  fareBadgeAmount: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 2 },
  fareBadgeLabel: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  fareBreakdownText: { fontSize: 12, color: c.textSecondary, textAlign: 'center', marginBottom: 2 },
  fareDistanceText: { fontSize: 11, color: c.textSecondary, textAlign: 'center', marginBottom: 2 },
  fareBreakdown: { fontSize: 11, color: c.green, marginTop: 1 },
  fareSourceZone: { fontSize: 11, color: c.green, fontWeight: '600', marginTop: 2 },
  fareSourceDistance: { fontSize: 11, color: '#2563eb', fontWeight: '600', marginTop: 2 },
  discountMessage: { fontSize: 12, color: '#085041', fontWeight: '600', marginTop: 4 },
  fareAmountContainer: { alignItems: 'flex-end' },
  fareOriginal: { fontSize: 13, color: c.textSecondary, textDecorationLine: 'line-through', marginBottom: 2 },
  fareAmount: { fontSize: 18, fontWeight: 'bold', color: c.green },
  paymentContainer: { marginBottom: 12 },
  paymentLabel: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8 },
  paymentOptions: { flexDirection: 'row', gap: 10 },
  paymentOption: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E0E0E0', alignItems: 'center', backgroundColor: '#F5F5F5' },
  paymentActiveCash: { backgroundColor: c.green, borderColor: c.green },
  paymentActiveMomo: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  paymentText: { fontSize: 14, fontWeight: '600', color: '#666' },
  paymentTextActive: { color: '#fff' },
  requestButton: { backgroundColor: c.green, paddingVertical: 16, borderRadius: 14, alignItems: 'center' },
  buttonDisabled: { opacity: 0.6 },
  requestButtonText: { color: 'white', fontSize: 17, fontWeight: '700' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  fareAcceptCard: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  receiptCard: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, maxHeight: '85%' },
  receiptLogo: { width: 56, height: 56, borderRadius: 14, marginBottom: 8 },
  receiptTitle: { fontSize: 20, fontWeight: '700', color: c.text },
  receiptDate: { fontSize: 13, color: c.textSecondary, marginTop: 4 },
  receiptDivider: { height: 1, backgroundColor: c.border, marginVertical: 16 },
  receiptDetailRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  receiptDetailLabel: { fontSize: 13, color: c.textSecondary, width: 80 },
  receiptDetailValue: { fontSize: 13, color: c.text, fontWeight: '600', flex: 1, textAlign: 'right' },
  receiptFareLabel: { fontSize: 13, color: c.textSecondary },
  receiptFareAmount: { fontSize: 32, fontWeight: '900', color: c.green, marginVertical: 4 },
  receiptThanks: { fontSize: 13, color: c.textSecondary, marginTop: 8, textAlign: 'center' },
  receiptShareBtn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.green, borderRadius: 14, paddingVertical: 14, marginTop: 20 },
  receiptShareBtnText: { fontSize: 15, fontWeight: '700', color: c.green },
  receiptDoneBtn: { backgroundColor: c.green, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 10 },
  receiptDoneBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  cancelReasonCard: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, width: '100%' },
  cancelReasonTitle: { fontSize: 18, fontWeight: '700', color: c.text, marginBottom: 16 },
  cancelReasonRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 },
  radioOuter: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: c.border, justifyContent: 'center', alignItems: 'center' },
  radioOuterActive: { borderColor: c.green },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: c.green },
  cancelReasonText: { fontSize: 14, color: c.text, flex: 1 },
  cancelReasonInput: { borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.text, backgroundColor: c.input, minHeight: 70, textAlignVertical: 'top', marginTop: 8 },
  cancelReasonActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelReasonCancelBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: c.background2 },
  cancelReasonCancelBtnText: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
  cancelReasonConfirmBtn: { flex: 1, paddingVertical: 14, borderRadius: 12, alignItems: 'center', backgroundColor: c.red },
  cancelReasonConfirmBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  fareAcceptTitle: { fontSize: 20, fontWeight: 'bold', color: c.text, textAlign: 'center', marginBottom: 8 },
  fareAcceptSubtitle: { fontSize: 14, color: c.textSecondary, textAlign: 'center', marginBottom: 20 },
  fareCompare: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16, marginBottom: 12 },
  fareCompareItem: { alignItems: 'center' },
  fareCompareLabel: { fontSize: 12, color: c.textSecondary, marginBottom: 4 },
  fareCompareOld: { fontSize: 20, color: c.textSecondary, textDecorationLine: 'line-through' },
  fareCompareNew: { fontSize: 28, fontWeight: 'bold', color: c.green },
  fareArrow: { fontSize: 20, color: c.textSecondary },
  fareDistance: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginBottom: 16 },
  acceptFareButton: { backgroundColor: c.green, paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginBottom: 8 },
  acceptFareButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  fareAcceptNote: { fontSize: 12, color: c.textSecondary, textAlign: 'center' },
  driverCard: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  driverCardTitle: { fontSize: 18, fontWeight: 'bold', color: c.text, textAlign: 'center', marginBottom: 8 },
  etaBadge: { backgroundColor: '#E1F5EE', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4, alignSelf: 'center', marginBottom: 12 },
  etaText: { color: '#085041', fontWeight: '600', fontSize: 14 },
  driverPhotoSection: { alignItems: 'center', marginBottom: 12, position: 'relative' },
  driverPhoto: { width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: c.green },
  driverPhotoPlaceholder: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#E1F5EE', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: c.green },
  driverRatingBadge: { position: 'absolute', bottom: 0, right: '30%', backgroundColor: '#FFD60A', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  driverRatingText: { fontSize: 12, fontWeight: 'bold', color: '#333' },
  driverName: { fontSize: 20, fontWeight: 'bold', color: c.text, textAlign: 'center', marginBottom: 4 },
  driverRides: { fontSize: 13, color: c.textSecondary, textAlign: 'center', marginBottom: 16 },
  pragyaDetails: { backgroundColor: c.input, borderRadius: 12, padding: 14, marginBottom: 16 },
  pragyaDetailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: c.border },
  pragyaDetailLabel: { fontSize: 13, color: c.textSecondary },
  pragyaDetailValue: { fontSize: 13, fontWeight: '600', color: c.text },
  pragyaColorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pragyaColorDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: c.border },
  closeCardButton: { backgroundColor: c.green, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  closeCardButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  ratingCard: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, alignItems: 'center' },
  ratingTitle: { fontSize: 22, fontWeight: 'bold', color: c.text, marginBottom: 4 },
  ratingTopFare: { fontSize: 32, fontWeight: '900', color: c.green, marginBottom: 8 },
  ratingSubtitle: { fontSize: 14, color: c.textSecondary, textAlign: 'center', marginBottom: 16 },
  ratingDriverPhoto: { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: c.green, marginBottom: 8 },
  ratingDriverPhotoPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#E1F5EE', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  ratingDriverName: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12 },
  ratingFare: { fontSize: 14, color: c.green, fontWeight: '600', marginBottom: 16 },
  receiptBox: { backgroundColor: '#F0FDF7', borderRadius: 8, padding: 12, marginBottom: 16, width: '100%' },
  receiptRow: { fontSize: 13, color: c.text, marginBottom: 4 },
  receiptValue: { fontWeight: '600', color: c.text },
  receiptDiscount: { fontWeight: '600', color: '#e53e3e' },
  receiptRowTotal: { fontSize: 14, color: '#085041', fontWeight: '700', marginTop: 4, borderTopWidth: 1, borderTopColor: '#C6F6E4', paddingTop: 4 },
  receiptTotal: { color: c.green },
  starsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  ratingLabel: { fontSize: 14, color: c.textSecondary, marginBottom: 12, height: 20 },
  ratingCommentInput: { borderWidth: 1, borderColor: c.inputBorder, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, color: c.text, backgroundColor: c.input, width: '100%', minHeight: 70, textAlignVertical: 'top', marginBottom: 16 },
  submitRatingButton: { backgroundColor: c.green, paddingVertical: 14, paddingHorizontal: 40, borderRadius: 10, alignItems: 'center', width: '100%', marginBottom: 10 },
  submitRatingText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  skipRatingButton: { paddingVertical: 10 },
  skipRatingText: { color: c.textSecondary, fontSize: 14 },
  suggestionsCard: { position: 'absolute', top: 46, left: 0, right: 0, zIndex: 9999, backgroundColor: c.card, borderRadius: 12, borderWidth: 0.5, borderColor: c.border, elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, maxHeight: 300, overflow: 'hidden' },
  suggestionItem: { backgroundColor: c.card, padding: 14 },
  suggestionItemZone: { backgroundColor: c.greenLight },
  suggestionItemBorder: { borderBottomWidth: 0.5, borderBottomColor: c.border },
  suggestionRowZone: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  suggestionText: { fontSize: 14, fontWeight: '600', color: c.text, lineHeight: 18 },
  suggestionTextZone: { fontSize: 14, color: c.text, fontWeight: '600', flex: 1, marginRight: 8 },
  suggestionFare: { fontSize: 13, color: c.green, fontWeight: '700' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: c.textSecondary, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4, backgroundColor: c.input, textTransform: 'uppercase', letterSpacing: 0.5 },
  suggestionsLoader: { alignSelf: 'center', marginBottom: 6 },
  tricycleMarker: { width: 44, height: 44, borderRadius: 22, backgroundColor: c.green, borderWidth: 3, borderColor: 'white', justifyContent: 'center', alignItems: 'center', elevation: 6, shadowColor: c.green, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.4, shadowRadius: 8 },
  tricycleEmoji: { fontSize: 20 },
  trackingMarkerWrap: { width: 50, height: 50, justifyContent: 'center', alignItems: 'center' },
  pulseCircle: { position: 'absolute', width: 50, height: 50, borderRadius: 25, backgroundColor: c.green },
  bellBtn: { position: 'absolute', top: 12, right: 12, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: c.card, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 5 },
  locateMeBtn: { position: 'absolute', right: 16, bottom: 16, zIndex: 10, width: 44, height: 44, borderRadius: 22, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.25, shadowRadius: 4, elevation: 6 },
  bellBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: c.red, borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  bellBadgeText: { color: '#fff', fontSize: 9, fontWeight: 'bold' },
  });
}
