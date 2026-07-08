import { applyDiscount, DiscountResult, recordDiscountUse } from '@/lib/discounts';
import { useTheme } from '@/lib/useTheme';
import { calculateZoneFare, FareResult, getFareSuggestions } from '@/lib/fares';
import { getDriverToken, sendPushNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
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

const PRAGYA_COLOR_MAP: { [key: string]: string } = {
  red: '#FF3B30', blue: '#2563eb', yellow: '#FFD60A',
  green: '#1D9E75', white: '#F2F2F7', black: '#1C1C1E',
  orange: '#FF9500', silver: '#8E8E93',
};

const calculateETA = (driverLat: number, driverLng: number, riderLat: number, riderLng: number) => {
  const R = 6371;
  const dLat = (riderLat - driverLat) * Math.PI / 180;
  const dLng = (riderLng - driverLng) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(driverLat * Math.PI / 180) * Math.cos(riderLat * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distanceKm = R * c;
  const etaMinutes = Math.round((distanceKm / 20) * 60);
  return etaMinutes < 1 ? '< 1 min' : `~${etaMinutes} min`;
};

export default function RiderHomeScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
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
  const [currentRide, setCurrentRide] = useState<any>(null);
  const [rideStatus, setRideStatus] = useState('');
  const [driverInfo, setDriverInfo] = useState<any>(null);
  const [showDriverCard, setShowDriverCard] = useState(false);
  const [eta, setEta] = useState<string | null>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [selectedRating, setSelectedRating] = useState(0);
  const [completedRide, setCompletedRide] = useState<any>(null);
  const [submittingRating, setSubmittingRating] = useState(false);
  const [riderConfirmedPayment, setRiderConfirmedPayment] = useState(false);
  const [finalFare, setFinalFare] = useState<number | null>(null);
  const [showFareAcceptModal, setShowFareAcceptModal] = useState(false);
  const rideSubscription = useRef<any>(null);
  const driverLocationSubscription = useRef<any>(null);
  const locationRef = useRef<{ latitude: number; longitude: number } | null>(null);
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
  const viewboxRef = useRef<string | null>(null);
  const regionCenterRef = useRef<{ lat: number; lng: number } | null>(null);
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
  const [isDriver, setIsDriver] = useState(false);
  const [showArrivedBanner, setShowArrivedBanner] = useState(false);
  const [arrivedBannerDriverName, setArrivedBannerDriverName] = useState('');
  const [pickupLocation, setPickupLocation] = useState('My Current Location');
  const [pickupLat, setPickupLat] = useState<number | null>(null);
  const [pickupLng, setPickupLng] = useState<number | null>(null);
  const [pickupSuggestions, setPickupSuggestions] = useState<any[]>([]);
  const [editingPickup, setEditingPickup] = useState(false);
  const [loadingPickupSuggestions, setLoadingPickupSuggestions] = useState(false);
  const pickupDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { currentRideRef.current = currentRide; }, [currentRide]);
  useEffect(() => { rideStatusRef.current = rideStatus; }, [rideStatus]);

  useEffect(() => {
    requestLocationPermission();
    fetchNearbyDrivers();
    fetchUnreadCount();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) return;
      userIdRef.current = user.id;
      supabase.from('profiles').select('zone_id, role').eq('id', user.id).single()
        .then(({ data }: { data: { zone_id: string | null; role: string } | null }) => {
          const zoneId = data?.zone_id ?? null;
          zoneIdRef.current = zoneId;
          if (zoneId) initZoneData(zoneId);
          if (data?.role === 'driver') setIsDriver(true);
        });
    });
    const interval = setInterval(fetchNearbyDrivers, 10000);
    return () => {
      clearInterval(interval);
      if (rideSubscription.current) supabase.removeChannel(rideSubscription.current);
      if (driverLocationSubscription.current) supabase.removeChannel(driverLocationSubscription.current);
      if (pulseLoopRef.current) pulseLoopRef.current.stop();
      if (destDebounceRef.current) clearTimeout(destDebounceRef.current);
      if (stopDebounceRef.current) clearTimeout(stopDebounceRef.current);
      if (pickupDebounceRef.current) clearTimeout(pickupDebounceRef.current);
    };
  }, []);

  const requestLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission Denied', 'Location permission is required.'); return; }
    getCurrentLocation();
  };

  const getCurrentLocation = async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setLocation(coords);
      locationRef.current = coords;
      setLoading(false);
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.05, longitudeDelta: 0.05 });
    } catch { setLoading(false); }
  };

  const fetchNearbyDrivers = async () => {
    try {
      const { data: drivers } = await supabase.from('drivers').select('*').eq('is_online', true).not('current_lat', 'is', null).not('current_lng', 'is', null);
      if (drivers) setNearbyDrivers(drivers);
    } catch (error) { console.error(error); }
  };

  const fetchDriverInfo = async (driverId: string) => {
    try {
      const { data: driver } = await supabase.from('drivers').select('*, profiles(full_name, phone)').eq('id', driverId).single();
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

      const latMin = Math.min(...regionZones.map((z: any) => z.boundary_lat_min));
      const latMax = Math.max(...regionZones.map((z: any) => z.boundary_lat_max));
      const lngMin = Math.min(...regionZones.map((z: any) => z.boundary_lng_min));
      const lngMax = Math.max(...regionZones.map((z: any) => z.boundary_lng_max));
      const viewbox = `${lngMin},${latMin},${lngMax},${latMax}`;
      viewboxRef.current = viewbox;
      regionCenterRef.current = { lat: (latMin + latMax) / 2, lng: (lngMin + lngMax) / 2 };
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
      console.log('Debounce fired, fetching suggestions for:', text);
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
    if (rideSubscription.current) await supabase.removeChannel(rideSubscription.current);
    const channel = supabase
      .channel(`ride-updates-${rideId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `id=eq.${rideId}` },
        async (payload) => {
          const ride = payload.new;
          setCurrentRide(ride);
          setRideStatus(ride.status);

          if (ride.status === 'accepted' && ride.driver_id) {
            await fetchDriverInfo(ride.driver_id);
            await subscribeToDriverLocation(ride.driver_id);
          } else if (ride.status === 'arrived_pickup') {
            setShowDriverCard(false);
            // Fetch driver name fresh — avoids stale closure from driverInfo state
            let bannerName = 'Your driver';
            if (ride.driver_id) {
              const { data: driverData } = await supabase
                .from('drivers')
                .select('profiles(full_name)')
                .eq('id', ride.driver_id)
                .single();
              bannerName = (driverData?.profiles as any)?.full_name ?? 'Your driver';
            }
            setArrivedBannerDriverName(bannerName);
            setShowArrivedBanner(true);
            Vibration.vibrate([0, 400, 150, 400]);
          } else if (ride.status === 'in_progress') {
            setShowArrivedBanner(false);
            setShowDriverCard(false);
            Alert.alert('Ride Started! 🎉', 'You are now on your way.');
          } else if (ride.status === 'payment_pending') {
            const newFare = ride.final_fare_ghs || ride.fare_ghs;
            setFinalFare(newFare);
            if (ride.final_fare_ghs && Math.abs(ride.final_fare_ghs - ride.fare_ghs) > 0.5) {
              setShowFareAcceptModal(true);
            } else {
              const baseFare = ride.estimated_fare || ride.fare_ghs;
              const diff = Math.round(Math.abs(newFare - baseFare) * 100) / 100;
              let fareMsg: string;
              if (diff > 0.5 && newFare > baseFare) {
                fareMsg = `Fare adjusted: +GHS ${diff.toFixed(2)} (longer route)\nFinal fare: GHS ${newFare.toFixed(2)}`;
              } else if (diff > 0.5 && newFare < baseFare) {
                fareMsg = `Fare reduced: -GHS ${diff.toFixed(2)} (shorter route)\nFinal fare: GHS ${newFare.toFixed(2)}`;
              } else {
                fareMsg = `Fare unchanged: GHS ${newFare.toFixed(2)}`;
              }
              Alert.alert(
                'Reached Destination!',
                `${fareMsg}\nPlease confirm payment.`,
                [
                  { text: 'Later', style: 'cancel' },
                  { text: ride.payment_method === 'cash' ? 'Cash Sent' : 'Confirm Payment', onPress: () => confirmPayment(ride, newFare) }
                ]
              );
            }
          } else if (ride.status === 'completed') {
            setShowArrivedBanner(false);
            setShowDriverCard(false);
            setShowFareAcceptModal(false);
            setCompletedRide(ride);
            setShowRatingModal(true);
            setCurrentRide(null);
            setRideStatus('');
            setRiderConfirmedPayment(false);
            setFinalFare(null);
            if (rideSubscription.current) supabase.removeChannel(rideSubscription.current);
            if (driverLocationSubscription.current) { supabase.removeChannel(driverLocationSubscription.current); driverLocationSubscription.current = null; }
            stopDriverTracking();
          } else if (ride.status === 'cancelled') {
            setShowArrivedBanner(false);
            setShowDriverCard(false);
            setShowFareAcceptModal(false);
            setCurrentRide(null);
            setRideStatus('');
            setDriverInfo(null);
            setEta(null);
            setFinalFare(null);
            if (rideSubscription.current) supabase.removeChannel(rideSubscription.current);
            if (driverLocationSubscription.current) { supabase.removeChannel(driverLocationSubscription.current); driverLocationSubscription.current = null; }
            stopDriverTracking();
          }
        });
    channel.subscribe();
    rideSubscription.current = channel;
  };

  const confirmPickup = async (rideId: string) => {
    const { error } = await supabase.from('rides').update({ status: 'in_progress' }).eq('id', rideId);
    if (error) { Alert.alert('Error', error.message); return; }
    if (currentRide?.driver_id) {
      const driverToken = await getDriverToken(currentRide.driver_id);
      if (driverToken) {
        await sendPushNotification(
          driverToken,
          '✅ Rider Confirmed Pickup!',
          'The rider has confirmed pickup. Ride has started!'
        );
      }
    }
  };

  const acceptNewFare = async () => {
    if (!currentRide) return;
    await supabase.from('rides').update({ fare_accepted: true }).eq('id', currentRide.id);
    setShowFareAcceptModal(false);
    Alert.alert(
      'Fare Accepted!',
      `New fare: GHS ${finalFare}. Please confirm payment.`,
      [
        { text: 'Later', style: 'cancel' },
        { text: currentRide.payment_method === 'cash' ? 'Cash Sent' : 'Confirm Payment', onPress: () => confirmPayment(currentRide, finalFare!) }
      ]
    );
  };

  const confirmPayment = async (ride: any, fare: number) => {
    setRiderConfirmedPayment(true);
    const { data: currentRideData } = await supabase.from('rides').select('driver_confirmed_payment').eq('id', ride.id).single();
    if (currentRideData?.driver_confirmed_payment) {
      await supabase.from('rides').update({ status: 'completed', completed_at: new Date().toISOString(), rider_confirmed_payment: true }).eq('id', ride.id);
    } else {
      await supabase.from('rides').update({ rider_confirmed_payment: true }).eq('id', ride.id);
      Alert.alert('Payment Confirmed!', 'Waiting for driver to confirm...');
    }
    if (ride.driver_id) {
      const driverToken = await getDriverToken(ride.driver_id);
      if (driverToken) {
        await sendPushNotification(
          driverToken,
          '💰 Payment Confirmed!',
          `Payment of GHS ${fare} confirmed via ${ride.payment_method === 'cash' ? 'Cash' : 'Go Cash'}.`
        );
      }
    }
  };

  const requestRide = async () => {
    if (!destination.trim()) { Alert.alert('Enter Destination', 'Please enter your final destination.'); return; }
    if (!location) { Alert.alert('Location Error', 'Could not get your location.'); return; }
    if (!fareEstimate) { Alert.alert('Estimate Fare', 'Please estimate fare first.'); return; }
    setRequesting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { Alert.alert('Error', 'Please login first.'); setRequesting(false); return; }
      const allStops = stops.map((stop, index) => ({ order: index + 1, address: stop, completed: false }));
      const { data: ride, error } = await supabase
        .from('rides')
        .insert([{
          rider_id: user.id,
          pickup_lat: pickupLat ?? location.latitude,
          pickup_lng: pickupLng ?? location.longitude,
          pickup_address: pickupLat ? pickupLocation : 'Current Location',
          dropoff_lat: selectedDestCoords?.lat ?? location.latitude + 0.01,
          dropoff_lng: selectedDestCoords?.lng ?? location.longitude + 0.01,
          dropoff_address: destination,
          stops: allStops, current_stop: 0,
          status: 'requested', fare_ghs: originalFare ?? fareEstimate,
          estimated_fare: fareEstimate,
          expected_distance_km: fareBreakdown?.expectedDistanceKm ?? null,
          payment_method: paymentMethod,
          created_at: new Date().toISOString(),
          ...(discountResult?.discount ? {
            discount_id: discountResult.discount.id,
            discount_amount: discountResult.discountAmount,
            discounted_fare: discountResult.finalFare,
          } : {}),
        }])
        .select().single();
      if (error) { Alert.alert('Error', error.message); }
      else {
        setCurrentRide(ride); setRideStatus('requested');
        await subscribeToRideUpdates(ride.id);
        await Promise.all(
          nearbyDrivers.map(async (driver: any) => {
            const driverToken = await getDriverToken(driver.id);
            if (driverToken) {
              await sendPushNotification(
                driverToken,
                '🛺 New Ride Request Near You!',
                `Pickup: ${ride.pickup_address} → ${ride.dropoff_address} | GHS ${ride.fare_ghs}`
              );
            }
          })
        );
        if (discountResult?.discount) await recordDiscountUse(discountResult.discount.id);
        Alert.alert('Ride Requested 🛺', stops.length > 0 ? `Finding a driver... ${stops.length} stop(s) added.` : 'Finding a nearby driver...');
        setDestination(''); setStops([]); setFareEstimate(null); setFareBreakdown(null); setDiscountResult(null); setOriginalFare(null);
        setPickupLocation('My Current Location'); setPickupLat(null); setPickupLng(null);
      }
    } catch (error) { Alert.alert('Error', 'Could not request ride.'); }
    finally { setRequesting(false); }
  };

  const cancelRide = async () => {
    if (!currentRide) return;
    await supabase.from('rides').update({ status: 'cancelled' }).eq('id', currentRide.id);
    setCurrentRide(null); setRideStatus(''); setDriverInfo(null);
    setShowDriverCard(false); setEta(null); setFinalFare(null);
    if (rideSubscription.current) await supabase.removeChannel(rideSubscription.current);
    if (driverLocationSubscription.current) { await supabase.removeChannel(driverLocationSubscription.current); driverLocationSubscription.current = null; }
    stopDriverTracking();
    Alert.alert('Ride Cancelled', 'Your ride has been cancelled.');
  };

  const submitRating = async () => {
    if (selectedRating === 0) { Alert.alert('Please select a rating'); return; }
    setSubmittingRating(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !completedRide || !driverInfo) return;
      await supabase.from('ratings').insert([{
        ride_id: completedRide.id, rated_by: user.id,
        rated_user: driverInfo.profile_id, score: selectedRating,
        created_at: new Date().toISOString(),
      }]);
      const { data: ratings } = await supabase.from('ratings').select('score').eq('rated_user', driverInfo.profile_id);
      if (ratings && ratings.length > 0) {
        const avgRating = ratings.reduce((sum: number, r: { score: number }) => sum + r.score, 0) / ratings.length;
        await supabase.from('drivers').update({ rating: Math.round(avgRating * 10) / 10 }).eq('id', driverInfo.id);
      }
      Alert.alert('Thank you!', `You rated your driver ${selectedRating} star${selectedRating > 1 ? 's' : ''}!`);
    } catch (error) { console.error('Error submitting rating:', error); }
    finally {
      setSubmittingRating(false); setShowRatingModal(false);
      setSelectedRating(0); setCompletedRide(null); setDriverInfo(null); setEta(null);
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

  const handleLogout = async () => { await supabase.auth.signOut(); router.replace('/'); };

  const getRideStatusLabel = () => {
    if (rideStatus === 'requested') return '🔍 Finding your Pragya...';
    if (rideStatus === 'accepted') {
      const parts = [routeDistance, eta ? `ETA: ${eta}` : null].filter(Boolean).join('  ·  ');
      return `🛺 Driver on the way!${parts ? `  ${parts}` : ''}`;
    }
    if (rideStatus === 'arrived_pickup') return '🛺 Driver has arrived!';
    if (rideStatus === 'in_progress') {
      return `🎉 Ride in progress${routeDistance ? `  ·  ${routeDistance} to go` : ''}${eta ? `  ·  ${eta}` : ''}`;
    }
    if (rideStatus === 'payment_pending') return '💰 Confirm payment';
    return '';
  };

  const displayFare = finalFare || currentRide?.discounted_fare || currentRide?.fare_ghs;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'height' : 'padding'}>
      <View style={styles.mapContainer}>
        <TouchableOpacity style={styles.bellBtn} onPress={() => router.push('/notifications' as any)}>
          <Text style={styles.bellIcon}>🔔</Text>
          {unreadCount > 0 ? (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unreadCount}</Text>
            </View>
          ) : null}
        </TouchableOpacity>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.loadingText}>Getting your location...</Text>
          </View>
        ) : (
          <MapView ref={mapRef} style={styles.map} mapType="standard" zoomEnabled={true} scrollEnabled={true}
            initialRegion={{ latitude: location?.latitude || 7.3349, longitude: location?.longitude || -2.3123, latitudeDelta: 0.05, longitudeDelta: 0.05 }}>
            {location ? (
              <Marker coordinate={location} title="You are here">
                <View style={styles.riderMarker}>
                  <View style={styles.riderMarkerInner} />
                </View>
              </Marker>
            ) : null}
            {nearbyDrivers.map((driver) => (
              <Marker key={driver.id} coordinate={{ latitude: driver.current_lat, longitude: driver.current_lng }}>
                <View style={styles.tricycleMarker}>
                  <Text style={styles.tricycleEmoji}>🛺</Text>
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
              <Polyline coordinates={routePoints} strokeColor="#1D9E75" strokeWidth={4} />
            ) : null}
          </MapView>
        )}
      </View>

      {/* Driver arrived banner — overlays the map, dismissible */}
      {showArrivedBanner && (
        <View style={styles.arrivedBanner}>
          <Text style={styles.arrivedBannerTitle}>🛺 Your driver has arrived!</Text>
          <Text style={styles.arrivedBannerSub}>
            {arrivedBannerDriverName} is waiting at your pickup location. Please head out now!
          </Text>
          <View style={styles.arrivedBannerActions}>
            <TouchableOpacity
              style={styles.arrivedConfirmBtn}
              onPress={() => {
                setShowArrivedBanner(false);
                if (currentRide) confirmPickup(currentRide.id);
              }}
            >
              <Text style={styles.arrivedConfirmText}>Confirm Pickup</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.arrivedDismissBtn} onPress={() => setShowArrivedBanner(false)}>
              <Text style={styles.arrivedDismissText}>✕ Dismiss</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {currentRide ? (
        <View style={styles.rideStatusBanner}>
          <Text style={styles.rideStatusText}>{getRideStatusLabel()}</Text>
          <Text style={styles.rideStatusSub}>To: {currentRide.dropoff_address}</Text>
          {(currentRide.stops?.length ?? 0) > 0 ? (
            <Text style={styles.rideStatusStops}>{`Stops: ${currentRide.stops.map((s: any) => s.address).join(' → ')}`}</Text>
          ) : null}
          <View style={styles.fareRow}>
            <Text style={styles.rideStatusFare}>GHS {displayFare}</Text>
            {!!finalFare && finalFare !== currentRide.fare_ghs ? (
              <Text style={styles.originalFare}>(est. GHS {currentRide.fare_ghs})</Text>
            ) : null}
          </View>
          <View style={styles.rideActions}>
            {rideStatus === 'requested' ? (
              <TouchableOpacity style={styles.cancelButton} onPress={cancelRide}>
                <Text style={styles.cancelButtonText}>Cancel Ride</Text>
              </TouchableOpacity>
            ) : null}
            {rideStatus === 'payment_pending' && !riderConfirmedPayment ? (
              <TouchableOpacity style={styles.confirmPaymentButton} onPress={() => confirmPayment(currentRide, displayFare)}>
                <Text style={styles.confirmPaymentText}>
                  {currentRide.payment_method === 'cash' ? 'Cash Sent' : 'Confirm Payment'}
                </Text>
              </TouchableOpacity>
            ) : null}
            {driverInfo && (rideStatus === 'accepted' || rideStatus === 'arrived_pickup') ? (
              <TouchableOpacity style={styles.viewDriverButton} onPress={() => setShowDriverCard(true)}>
                <Text style={styles.viewDriverButtonText}>View Driver</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      ) : null}

      {!currentRide ? (
        <ScrollView style={styles.bottomPanel}>
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
            {loadingPickupSuggestions ? <ActivityIndicator size="small" color="#1D9E75" style={styles.suggestionsLoader} /> : null}
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
              <TextInput style={styles.inputWithClear} placeholder="Enter final destination" value={destination} onChangeText={handleDestinationChange} placeholderTextColor={colors.subtext} />
              {destination.length > 0 ? (
                <TouchableOpacity style={styles.clearBtn} onPress={() => { setDestination(''); setDestinationSuggestions([]); setFareEstimate(0); setFareBreakdown(null); setDiscountResult(null); setOriginalFare(null); setSelectedDestCoords(null); }}>
                  <Text style={styles.clearBtnText}>✕</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            {loadingDestSuggestions ? <ActivityIndicator size="small" color="#2563eb" style={styles.suggestionsLoader} /> : null}
            {destinationSuggestions.length > 0 ? (
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
                          <Text style={styles.suggestionFare}>GHS {item.fare}</Text>
                        </View>
                      ) : (
                        <Text style={styles.suggestionText} numberOfLines={2}>🗺️ {item.label}</Text>
                      )}
                    </TouchableOpacity>
                  </React.Fragment>
                );
              })}
            </View>
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
                <TextInput style={styles.stopInput} placeholder="Add a stop (optional)" value={newStop} onChangeText={handleStopChange} placeholderTextColor={colors.subtext} />
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
            <ActivityIndicator color="#1D9E75" style={{ marginVertical: 12 }} />
          ) : null}
          {fareEstimate ? (
            <View style={styles.fareBadgeWrapper}>
              <View style={styles.fareBadge}>
                <Text style={styles.fareBadgeAmount}>GHS {fareEstimate.toFixed(2)}</Text>
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
          <View style={styles.actionGrid}>
            <TouchableOpacity style={[styles.actionCard, { backgroundColor: '#F0FAF6' }]} onPress={() => router.push('/rider/gocash')}>
              <Text style={styles.actionCardIcon}>💰</Text>
              <Text style={[styles.actionCardLabel, { color: '#1D9E75' }]}>My Wallet</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionCard, { backgroundColor: '#FBE9F0' }]} onPress={() => router.push('/support' as any)}>
              <Text style={styles.actionCardIcon}>🎧</Text>
              <Text style={[styles.actionCardLabel, { color: '#993556' }]}>Support</Text>
            </TouchableOpacity>
            {isDriver ? (
              <TouchableOpacity style={[styles.actionCard, { backgroundColor: '#E6F1FB' }]} onPress={() => router.replace('/driver/home' as any)}>
                <Text style={styles.actionCardIcon}>🛺</Text>
                <Text style={[styles.actionCardLabel, { color: '#185FA5' }]}>Driver Mode</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity style={[styles.actionCard, { backgroundColor: '#FFF0F0' }]} onPress={handleLogout}>
              <Text style={styles.actionCardIcon}>🚪</Text>
              <Text style={[styles.actionCardLabel, { color: '#DC2626' }]}>Logout</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : null}

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
                <Text style={styles.fareCompareOld}>GHS {currentRide?.fare_ghs}</Text>
              </View>
              <Text style={styles.fareArrow}>→</Text>
              <View style={styles.fareCompareItem}>
                <Text style={styles.fareCompareLabel}>Final</Text>
                <Text style={styles.fareCompareNew}>GHS {finalFare}</Text>
              </View>
            </View>
            {currentRide?.actual_distance_km ? (
              <Text style={styles.fareDistance}>{`Actual distance: ${currentRide.actual_distance_km} km`}</Text>
            ) : null}
            <TouchableOpacity style={styles.acceptFareButton} onPress={acceptNewFare}>
              <Text style={styles.acceptFareButtonText}>Accept & Pay GHS {finalFare}</Text>
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

      {/* Rating Modal */}
      <Modal visible={showRatingModal} transparent animationType="slide">
        <View style={[styles.modalOverlay, { paddingTop: insets.top }]}>
          <View style={[styles.ratingCard, { paddingBottom: insets.bottom + 16 }]}>
            <Text style={styles.ratingTitle}>Rate Your Ride</Text>
            <Text style={styles.ratingSubtitle}>How was your experience?</Text>
            {driverInfo?.photo_url ? (
              <Image source={{ uri: driverInfo.photo_url }} style={styles.ratingDriverPhoto} />
            ) : (
              <View style={styles.ratingDriverPhotoPlaceholder}><Text style={{ fontSize: 40 }}>👤</Text></View>
            )}
            {completedRide?.discount_amount > 0 ? (
              <View style={styles.receiptBox}>
                <Text style={styles.receiptRow}>Original fare: <Text style={styles.receiptValue}>GHS {completedRide.final_fare_ghs || completedRide.fare_ghs}</Text></Text>
                <Text style={styles.receiptRow}>Discount: <Text style={styles.receiptDiscount}>-GHS {completedRide.discount_amount}</Text></Text>
                <Text style={styles.receiptRowTotal}>You paid: <Text style={styles.receiptTotal}>GHS {completedRide.discounted_fare ?? (completedRide.fare_ghs - completedRide.discount_amount)}</Text></Text>
              </View>
            ) : (
              <Text style={styles.ratingFare}>Fare paid: GHS {completedRide?.final_fare_ghs || completedRide?.fare_ghs}</Text>
            )}
            <View style={styles.starsRow}>
              {[1, 2, 3, 4, 5].map((star) => (
                <TouchableOpacity key={star} onPress={() => setSelectedRating(star)}>
                  <Text style={[styles.star, selectedRating >= star && styles.starSelected]}>★</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.ratingLabel}>
              {selectedRating === 1 ? 'Poor' : selectedRating === 2 ? 'Fair' : selectedRating === 3 ? 'Good' : selectedRating === 4 ? 'Very Good' : selectedRating === 5 ? 'Excellent!' : 'Tap a star to rate'}
            </Text>
            <TouchableOpacity style={[styles.submitRatingButton, (selectedRating === 0 || submittingRating) && styles.buttonDisabled]} onPress={submitRating} disabled={selectedRating === 0 || submittingRating}>
              {submittingRating ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitRatingText}>Submit Rating</Text>}
            </TouchableOpacity>
            <TouchableOpacity style={styles.skipRatingButton} onPress={() => { setShowRatingModal(false); setSelectedRating(0); setCompletedRide(null); setDriverInfo(null); }}>
              <Text style={styles.skipRatingText}>Skip</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: c.background },
  container: { flex: 1, backgroundColor: c.background },
  mapContainer: { flex: 1, minHeight: 300 },
  map: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: c.subtext },
  rideStatusBanner: { backgroundColor: '#185FA5', padding: 16, margin: 10, borderRadius: 10 },
  rideStatusText: { fontSize: 15, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  rideStatusSub: { fontSize: 13, color: '#E6F1FB', marginBottom: 2 },
  rideStatusStops: { fontSize: 12, color: '#E6F1FB', marginBottom: 2, fontStyle: 'italic' },
  fareRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  rideStatusFare: { fontSize: 14, color: '#fff', fontWeight: 'bold' },
  originalFare: { fontSize: 11, color: '#E6F1FB' },
  rideActions: { flexDirection: 'row', gap: 10 },
  cancelButton: { flex: 1, backgroundColor: '#FF3B30', paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  cancelButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  confirmPaymentButton: { flex: 1, backgroundColor: '#1D9E75', paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  confirmPaymentText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  viewDriverButton: { flex: 1, backgroundColor: '#fff', paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  viewDriverButtonText: { color: '#185FA5', fontWeight: 'bold', fontSize: 14 },
  bottomPanel: { backgroundColor: c.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: 480, borderTopWidth: 1, borderTopColor: c.border },
  panelTitle: { fontSize: 18, fontWeight: 'bold', color: c.text, marginBottom: 4 },
  driversCount: { fontSize: 13, color: '#1D9E75', marginBottom: 12 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: c.subtext, marginBottom: 6 },
  input: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, backgroundColor: c.inputBg, color: c.text, marginBottom: 10 },
  pickupInputContainer: { position: 'relative', zIndex: 10000, backgroundColor: 'rgba(29,158,117,0.08)', borderWidth: 1, borderColor: 'rgba(29,158,117,0.2)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 2, marginBottom: 0 },
  pickupDisplay: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  pickupDisplayText: { flex: 1, fontSize: 14, fontWeight: '600' },
  pickupDisplayTextDefault: { color: '#1D9E75' },
  pickupDisplayTextCustom: { color: c.text },
  pickupTextInput: { borderWidth: 0, backgroundColor: 'transparent', paddingHorizontal: 4, paddingVertical: 0 },
  routeConnector: { paddingLeft: 16, paddingVertical: 3 },
  connectorContent: { alignItems: 'center', width: 12 },
  connectorDotGreen: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#1D9E75' },
  connectorLine: { width: 2, height: 14, backgroundColor: '#CBD5E1', marginVertical: 1 },
  connectorDotBlue: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#185FA5' },
  destInputContainer: { position: 'relative', zIndex: 9999, marginBottom: 10 },
  inputWrapper: { position: 'relative' },
  inputWithClear: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 16, paddingRight: 40, paddingVertical: 12, fontSize: 14, backgroundColor: c.inputBg, color: c.text },
  clearBtn: { position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center', paddingHorizontal: 4 },
  clearBtnText: { fontSize: 14, color: c.subtext, fontWeight: '600' },
  stopsContainer: { backgroundColor: c.inputBg, borderRadius: 8, padding: 10, marginBottom: 10 },
  stopsTitle: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8 },
  stopRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: c.border },
  stopNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#2563eb', color: '#fff', textAlign: 'center', lineHeight: 24, fontSize: 12, fontWeight: 'bold', marginRight: 10 },
  stopText: { flex: 1, fontSize: 13, color: c.text },
  removeStop: { fontSize: 16, color: '#FF3B30', paddingHorizontal: 8 },
  addStopRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  stopInput: { flex: 1, borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, backgroundColor: c.inputBg, color: c.text },
  addStopButton: { backgroundColor: '#2563eb', paddingHorizontal: 14, borderRadius: 8, justifyContent: 'center' },
  addStopButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  estimateButton: { backgroundColor: c.card, paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  estimateButtonText: { color: c.text, fontWeight: '600' },
  fareContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#E1F5EE', padding: 12, borderRadius: 8, marginBottom: 10 },
  fareInfo: { flex: 1, marginRight: 8 },
  fareLabel: { fontSize: 14, color: '#085041', fontWeight: '600' },
  fareNote: { fontSize: 11, color: '#1D9E75', marginTop: 1 },
  fareBadgeWrapper: { marginBottom: 12, alignItems: 'center' },
  fareBadge: { backgroundColor: '#1D9E75', borderRadius: 12, paddingVertical: 16, paddingHorizontal: 24, alignItems: 'center', width: '100%', shadowColor: '#1D9E75', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8, elevation: 6, marginBottom: 8 },
  fareBadgeOriginal: { fontSize: 14, color: 'rgba(255,255,255,0.6)', textDecorationLine: 'line-through', marginBottom: 2 },
  fareBadgeAmount: { fontSize: 28, fontWeight: 'bold', color: '#fff', marginBottom: 2 },
  fareBadgeLabel: { fontSize: 13, color: 'rgba(255,255,255,0.8)' },
  fareBreakdownText: { fontSize: 12, color: c.subtext, textAlign: 'center', marginBottom: 2 },
  fareDistanceText: { fontSize: 11, color: c.subtext, textAlign: 'center', marginBottom: 2 },
  fareBreakdown: { fontSize: 11, color: '#1D9E75', marginTop: 1 },
  fareSourceZone: { fontSize: 11, color: '#1D9E75', fontWeight: '600', marginTop: 2 },
  fareSourceDistance: { fontSize: 11, color: '#2563eb', fontWeight: '600', marginTop: 2 },
  discountMessage: { fontSize: 12, color: '#085041', fontWeight: '600', marginTop: 4 },
  fareAmountContainer: { alignItems: 'flex-end' },
  fareOriginal: { fontSize: 13, color: c.subtext, textDecorationLine: 'line-through', marginBottom: 2 },
  fareAmount: { fontSize: 18, fontWeight: 'bold', color: '#1D9E75' },
  paymentContainer: { marginBottom: 12 },
  paymentLabel: { fontSize: 13, fontWeight: '600', color: c.text, marginBottom: 8 },
  paymentOptions: { flexDirection: 'row', gap: 10 },
  paymentOption: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#E0E0E0', alignItems: 'center', backgroundColor: '#F5F5F5' },
  paymentActiveCash: { backgroundColor: '#1D9E75', borderColor: '#1D9E75' },
  paymentActiveMomo: { backgroundColor: '#185FA5', borderColor: '#185FA5' },
  paymentText: { fontSize: 14, fontWeight: '600', color: '#666' },
  paymentTextActive: { color: '#fff' },
  requestButton: { backgroundColor: '#1D9E75', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  buttonDisabled: { opacity: 0.6 },
  requestButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  actionGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  actionCard: { width: '47%', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 14, alignItems: 'center' },
  actionCardIcon: { fontSize: 28, marginBottom: 6 },
  actionCardLabel: { fontSize: 12, fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  fareAcceptCard: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  fareAcceptTitle: { fontSize: 20, fontWeight: 'bold', color: c.text, textAlign: 'center', marginBottom: 8 },
  fareAcceptSubtitle: { fontSize: 14, color: c.subtext, textAlign: 'center', marginBottom: 20 },
  fareCompare: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16, marginBottom: 12 },
  fareCompareItem: { alignItems: 'center' },
  fareCompareLabel: { fontSize: 12, color: c.subtext, marginBottom: 4 },
  fareCompareOld: { fontSize: 20, color: c.subtext, textDecorationLine: 'line-through' },
  fareCompareNew: { fontSize: 28, fontWeight: 'bold', color: '#1D9E75' },
  fareArrow: { fontSize: 20, color: c.subtext },
  fareDistance: { fontSize: 13, color: c.subtext, textAlign: 'center', marginBottom: 16 },
  acceptFareButton: { backgroundColor: '#1D9E75', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginBottom: 8 },
  acceptFareButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  fareAcceptNote: { fontSize: 12, color: c.subtext, textAlign: 'center' },
  driverCard: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  driverCardTitle: { fontSize: 18, fontWeight: 'bold', color: c.text, textAlign: 'center', marginBottom: 8 },
  etaBadge: { backgroundColor: '#E1F5EE', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4, alignSelf: 'center', marginBottom: 12 },
  etaText: { color: '#085041', fontWeight: '600', fontSize: 14 },
  driverPhotoSection: { alignItems: 'center', marginBottom: 12, position: 'relative' },
  driverPhoto: { width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: '#1D9E75' },
  driverPhotoPlaceholder: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#E1F5EE', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#1D9E75' },
  driverRatingBadge: { position: 'absolute', bottom: 0, right: '30%', backgroundColor: '#FFD60A', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  driverRatingText: { fontSize: 12, fontWeight: 'bold', color: '#333' },
  driverName: { fontSize: 20, fontWeight: 'bold', color: c.text, textAlign: 'center', marginBottom: 4 },
  driverRides: { fontSize: 13, color: c.subtext, textAlign: 'center', marginBottom: 16 },
  pragyaDetails: { backgroundColor: c.inputBg, borderRadius: 12, padding: 14, marginBottom: 16 },
  pragyaDetailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: c.border },
  pragyaDetailLabel: { fontSize: 13, color: c.subtext },
  pragyaDetailValue: { fontSize: 13, fontWeight: '600', color: c.text },
  pragyaColorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pragyaColorDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: c.border },
  closeCardButton: { backgroundColor: '#1D9E75', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  closeCardButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  ratingCard: { backgroundColor: c.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, alignItems: 'center' },
  ratingTitle: { fontSize: 22, fontWeight: 'bold', color: c.text, marginBottom: 8 },
  ratingSubtitle: { fontSize: 14, color: c.subtext, textAlign: 'center', marginBottom: 16 },
  ratingDriverPhoto: { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#1D9E75', marginBottom: 8 },
  ratingDriverPhotoPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#E1F5EE', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  ratingFare: { fontSize: 14, color: '#1D9E75', fontWeight: '600', marginBottom: 16 },
  receiptBox: { backgroundColor: '#F0FDF7', borderRadius: 8, padding: 12, marginBottom: 16, width: '100%' },
  receiptRow: { fontSize: 13, color: c.text, marginBottom: 4 },
  receiptValue: { fontWeight: '600', color: c.text },
  receiptDiscount: { fontWeight: '600', color: '#e53e3e' },
  receiptRowTotal: { fontSize: 14, color: '#085041', fontWeight: '700', marginTop: 4, borderTopWidth: 1, borderTopColor: '#C6F6E4', paddingTop: 4 },
  receiptTotal: { color: '#1D9E75' },
  starsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  star: { fontSize: 44, color: c.border },
  starSelected: { color: '#FFD60A' },
  ratingLabel: { fontSize: 14, color: c.subtext, marginBottom: 20, height: 20 },
  submitRatingButton: { backgroundColor: '#1D9E75', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 10, alignItems: 'center', width: '100%', marginBottom: 10 },
  submitRatingText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  skipRatingButton: { paddingVertical: 10 },
  skipRatingText: { color: c.subtext, fontSize: 14 },
  suggestionsCard: { position: 'absolute', top: 46, left: 0, right: 0, zIndex: 9999, backgroundColor: 'white', borderRadius: 12, elevation: 10, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.15, shadowRadius: 8, maxHeight: 300, overflow: 'hidden' },
  suggestionItem: { paddingHorizontal: 14, paddingVertical: 12 },
  suggestionItemZone: { backgroundColor: '#F0FDF7' },
  suggestionItemBorder: { borderBottomWidth: 0.5, borderBottomColor: c.border },
  suggestionRowZone: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  suggestionText: { fontSize: 13, color: c.text, lineHeight: 18 },
  suggestionTextZone: { fontSize: 13, color: '#085041', fontWeight: '600', flex: 1, marginRight: 8 },
  suggestionFare: { fontSize: 13, color: '#1D9E75', fontWeight: '700' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: c.subtext, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4, backgroundColor: c.inputBg, textTransform: 'uppercase', letterSpacing: 0.5 },
  suggestionsLoader: { alignSelf: 'center', marginBottom: 6 },
  riderMarker: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff', borderWidth: 3, borderColor: '#2563eb', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.3, shadowRadius: 2, elevation: 3 },
  riderMarkerInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#2563eb' },
  tricycleMarker: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1D9E75', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 4 },
  tricycleEmoji: { fontSize: 20 },
  trackingMarkerWrap: { width: 50, height: 50, justifyContent: 'center', alignItems: 'center' },
  pulseCircle: { position: 'absolute', width: 50, height: 50, borderRadius: 25, backgroundColor: '#1D9E75' },
  arrivedBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 20,
    backgroundColor: '#1D9E75',
    padding: 16,
    paddingTop: 14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 12,
  },
  arrivedBannerTitle: { fontSize: 17, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  arrivedBannerSub: { fontSize: 13, color: '#E1F5EE', lineHeight: 19, marginBottom: 12 },
  arrivedBannerActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  arrivedConfirmBtn: { flex: 1, backgroundColor: '#fff', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  arrivedConfirmText: { color: '#1D9E75', fontWeight: 'bold', fontSize: 14 },
  arrivedDismissBtn: { paddingVertical: 10, paddingHorizontal: 4 },
  arrivedDismissText: { color: 'rgba(255,255,255,0.75)', fontSize: 13, fontWeight: '600' },
  bellBtn: { position: 'absolute', top: 12, right: 12, zIndex: 10, width: 40, height: 40, borderRadius: 20, backgroundColor: c.card, justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.2, shadowRadius: 3, elevation: 5 },
  bellIcon: { fontSize: 20 },
  bellBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: '#FF3B30', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  bellBadgeText: { color: '#fff', fontSize: 9, fontWeight: 'bold' },
  });
}
