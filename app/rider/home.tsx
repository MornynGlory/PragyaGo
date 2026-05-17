import { supabase } from '@/lib/supabase';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';

export default function RiderHomeScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);

  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [destination, setDestination] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'momo'>('cash');
  const [nearbyDrivers, setNearbyDrivers] = useState<any[]>([]);
  const [fareEstimate, setFareEstimate] = useState<number | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [currentRide, setCurrentRide] = useState<any>(null);
  const [rideStatus, setRideStatus] = useState('');
  const rideSubscription = useRef<any>(null);

  useEffect(() => {
    requestLocationPermission();
    fetchNearbyDrivers();
    const interval = setInterval(fetchNearbyDrivers, 10000);

    return () => {
      clearInterval(interval);
      if (rideSubscription.current) {
        supabase.removeChannel(rideSubscription.current);
      }
    };
  }, []);

  const requestLocationPermission = async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'Location permission is required.');
      return;
    }
    getCurrentLocation();
  };

  const getCurrentLocation = async () => {
    try {
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setLocation(coords);
      setLoading(false);
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.05, longitudeDelta: 0.05 });
    } catch (error) {
      setLoading(false);
      Alert.alert('Error', 'Could not get your location.');
    }
  };

  const fetchNearbyDrivers = async () => {
    try {
      const { data: drivers } = await supabase
        .from('drivers')
        .select('*')
        .eq('is_online', true)
        .not('current_lat', 'is', null)
        .not('current_lng', 'is', null);
      if (drivers) setNearbyDrivers(drivers);
    } catch (error) {
      console.error(error);
    }
  };

  const estimateFare = () => {
    if (!destination.trim()) {
      Alert.alert('Enter Destination', 'Please enter where you want to go.');
      return;
    }
    const estimatedKm = Math.random() * 5 + 1;
    const fare = 3 + estimatedKm * 1.5;
    setFareEstimate(Math.round(fare * 10) / 10);
  };

  const subscribeToRideUpdates = async (rideId: string) => {
    if (rideSubscription.current) {
      await supabase.removeChannel(rideSubscription.current);
    }
    const channel = supabase
      .channel(`ride-updates-${rideId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'rides',
        filter: `id=eq.${rideId}`,
      }, (payload) => {
        const ride = payload.new;
        setCurrentRide(ride);
        setRideStatus(ride.status);
        if (ride.status === 'accepted') {
          Alert.alert('Driver Found! 🛺', 'A driver has accepted your ride!');
        } else if (ride.status === 'in_progress') {
          Alert.alert('On Your Way! 🎉', 'Your ride has started.');
        } else if (ride.status === 'completed') {
          Alert.alert('Ride Complete!', `Fare: GHS ${ride.fare_ghs}\nThank you for using PragyaGo!`);
          setCurrentRide(null);
          setRideStatus('');
          if (rideSubscription.current) supabase.removeChannel(rideSubscription.current);
        }
      });
    await channel.subscribe();
    rideSubscription.current = channel;
  };

  const requestRide = async () => {
    if (!destination.trim()) {
      Alert.alert('Enter Destination', 'Please enter where you want to go.');
      return;
    }
    if (!location) {
      Alert.alert('Location Error', 'Could not get your location.');
      return;
    }
    if (!fareEstimate) {
      Alert.alert('Estimate Fare', 'Please estimate fare first.');
      return;
    }

    setRequesting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        Alert.alert('Error', 'Please login first.');
        setRequesting(false);
        return;
      }

      const { data: ride, error } = await supabase
        .from('rides')
        .insert([{
          rider_id: user.id,
          pickup_lat: location.latitude,
          pickup_lng: location.longitude,
          pickup_address: 'Current Location',
          dropoff_lat: location.latitude + 0.01,
          dropoff_lng: location.longitude + 0.01,
          dropoff_address: destination,
          status: 'requested',
          fare_ghs: fareEstimate,
          payment_method: paymentMethod,
          created_at: new Date().toISOString(),
        }])
        .select()
        .single();

      if (error) {
        Alert.alert('Error', error.message);
      } else {
        setCurrentRide(ride);
        setRideStatus('requested');
        await subscribeToRideUpdates(ride.id);
        Alert.alert('Ride Requested 🛺', 'Finding a nearby driver...');
        setDestination('');
        setFareEstimate(null);
      }
    } catch (error) {
      Alert.alert('Error', 'Could not request ride.');
    } finally {
      setRequesting(false);
    }
  };

  const cancelRide = async () => {
    if (!currentRide) return;
    await supabase.from('rides').update({ status: 'cancelled' }).eq('id', currentRide.id);
    setCurrentRide(null);
    setRideStatus('');
    if (rideSubscription.current) await supabase.removeChannel(rideSubscription.current);
    Alert.alert('Ride Cancelled', 'Your ride has been cancelled.');
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/');
  };

  const getRideStatusLabel = () => {
    if (rideStatus === 'requested') return '🔍 Finding your Pragya...';
    if (rideStatus === 'accepted') return '🛺 Driver is on the way!';
    if (rideStatus === 'in_progress') return '🎉 You are on your way!';
    return '';
  };

  return (
    <View style={styles.container}>
      {/* Map */}
      <View style={styles.mapContainer}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.loadingText}>Getting your location...</Text>
          </View>
        ) : (
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={{
              latitude: location?.latitude || 7.3349,
              longitude: location?.longitude || -2.3123,
              latitudeDelta: 0.05,
              longitudeDelta: 0.05,
            }}
          >
            <UrlTile
              urlTemplate="https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"
              maximumZ={19}
              flipY={false}
            />
            {location && (
              <Marker coordinate={location} title="You are here" pinColor="#2563eb" />
            )}
            {nearbyDrivers.map((driver) => (
              <Marker
                key={driver.id}
                coordinate={{ latitude: driver.current_lat, longitude: driver.current_lng }}
                pinColor="#1D9E75"
              />
            ))}
          </MapView>
        )}
      </View>

      {/* Active Ride Status */}
      {currentRide && (
        <View style={styles.rideStatusBanner}>
          <Text style={styles.rideStatusText}>{getRideStatusLabel()}</Text>
          <Text style={styles.rideStatusSub}>To: {currentRide.dropoff_address}</Text>
          <Text style={styles.rideStatusFare}>GHS {currentRide.fare_ghs} · {currentRide.payment_method?.toUpperCase()}</Text>
          {rideStatus === 'requested' && (
            <TouchableOpacity style={styles.cancelButton} onPress={cancelRide}>
              <Text style={styles.cancelButtonText}>Cancel Ride</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {/* Bottom Panel */}
      {!currentRide && (
        <ScrollView style={styles.bottomPanel}>
          <Text style={styles.panelTitle}>Where do you want to go?</Text>
          <Text style={styles.driversCount}>
            {nearbyDrivers.length > 0
              ? `🛺 ${nearbyDrivers.length} Pragya driver${nearbyDrivers.length > 1 ? 's' : ''} nearby`
              : '😔 No drivers nearby right now'}
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Enter destination"
            value={destination}
            onChangeText={setDestination}
            placeholderTextColor="#999"
            onSubmitEditing={estimateFare}
          />

          {!fareEstimate && (
            <TouchableOpacity onPress={estimateFare} style={styles.estimateButton}>
              <Text style={styles.estimateButtonText}>Estimate Fare</Text>
            </TouchableOpacity>
          )}

          {fareEstimate && (
            <View style={styles.fareContainer}>
              <Text style={styles.fareLabel}>Estimated Fare</Text>
              <Text style={styles.fareAmount}>GHS {fareEstimate}</Text>
            </View>
          )}

          {/* Payment Method */}
          <View style={styles.paymentContainer}>
            <Text style={styles.paymentLabel}>Payment Method</Text>
            <View style={styles.paymentOptions}>
              <TouchableOpacity
                style={[styles.paymentOption, paymentMethod === 'cash' && styles.paymentActive]}
                onPress={() => setPaymentMethod('cash')}
              >
                <Text style={[styles.paymentText, paymentMethod === 'cash' && styles.paymentTextActive]}>Cash</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.paymentOption, paymentMethod === 'momo' && styles.paymentActive]}
                onPress={() => setPaymentMethod('momo')}
              >
                <Text style={[styles.paymentText, paymentMethod === 'momo' && styles.paymentTextActive]}>Go Cash</Text>
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity
            style={[styles.requestButton, requesting && styles.buttonDisabled]}
            onPress={requestRide}
            disabled={requesting}
          >
            {requesting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.requestButtonText}>🛺 Request Pragya</Text>
            )}
          </TouchableOpacity>

          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.walletButton}
              onPress={() => router.push('/rider/gocash')}
            >
              <Text style={styles.walletButtonText}>💰 My Wallet</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.switchButton}
              onPress={() => router.replace('/driver')}
            >
              <Text style={styles.switchButtonText}>Switch to Driver</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  mapContainer: { flex: 1, minHeight: 300 },
  map: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  rideStatusBanner: { backgroundColor: '#185FA5', padding: 16, margin: 10, borderRadius: 10 },
  rideStatusText: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  rideStatusSub: { fontSize: 13, color: '#E6F1FB', marginBottom: 2 },
  rideStatusFare: { fontSize: 13, color: '#E6F1FB', marginBottom: 10 },
  cancelButton: { backgroundColor: '#FF3B30', paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  cancelButtonText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  bottomPanel: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: 420,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  panelTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 4 },
  driversCount: { fontSize: 13, color: '#1D9E75', marginBottom: 12 },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    fontSize: 14,
    backgroundColor: '#f9f9f9',
    color: '#333',
    marginBottom: 10,
  },
  estimateButton: { backgroundColor: '#f0f0f0', paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  estimateButtonText: { color: '#333', fontWeight: '600' },
  fareContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#E1F5EE', padding: 12, borderRadius: 8, marginBottom: 10 },
  fareLabel: { fontSize: 14, color: '#085041' },
  fareAmount: { fontSize: 18, fontWeight: 'bold', color: '#1D9E75' },
  paymentContainer: { marginBottom: 12 },
  paymentLabel: { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 8 },
  paymentOptions: { flexDirection: 'row', gap: 10 },
  paymentOption: { flex: 1, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#ddd', alignItems: 'center', backgroundColor: '#fff' },
  paymentActive: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  paymentText: { fontSize: 14, fontWeight: '600', color: '#333' },
  paymentTextActive: { color: '#fff' },
  requestButton: { backgroundColor: '#2563eb', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  buttonDisabled: { opacity: 0.6 },
  requestButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  walletButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#E1F5EE' },
  walletButtonText: { color: '#1D9E75', fontWeight: '600', fontSize: 14 },
  switchButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#E6F1FB' },
  switchButtonText: { color: '#185FA5', fontWeight: '600', fontSize: 14 },
  logoutButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#FFE5E5' },
  logoutButtonText: { color: '#FF3B30', fontWeight: '600', fontSize: 14 },
});
