import { supabase } from '@/lib/supabase';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';

export default function DriverHomeScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dailyEarnings, setDailyEarnings] = useState(0);
  const [totalRides, setTotalRides] = useState(0);
  const [rating, setRating] = useState(0);
  const [activeRide, setActiveRide] = useState<any>(null);
  const [rideStatus, setRideStatus] = useState('');
  const locationInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const rideSubscription = useRef<any>(null);

  useEffect(() => {
    requestLocationPermission();
    fetchDriverStats();
    return () => {
      if (locationInterval.current) clearInterval(locationInterval.current);
      if (rideSubscription.current) supabase.removeChannel(rideSubscription.current);
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
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    } catch {
      setLoading(false);
    }
  };

  const fetchDriverStats = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: driver } = await supabase
        .from('drivers')
        .select('*')
        .eq('profile_id', user.id)
        .single();

      if (driver) {
        setRating(driver.rating || 0);
        setTotalRides(driver.total_rides || 0);
        setIsOnline(driver.is_online || false);
        if (driver.is_online) await subscribeToRideRequests(driver.id);
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const { data: payments } = await supabase
        .from('payments')
        .select('amount_ghs')
        .eq('status', 'success')
        .gte('created_at', today.toISOString());

      if (payments) {
        const total = payments.reduce((sum, p) => sum + (p.amount_ghs || 0), 0);
        setDailyEarnings(total);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  };

  const subscribeToRideRequests = async (driverId: string) => {
    try {
      if (rideSubscription.current) {
        await supabase.removeChannel(rideSubscription.current);
        rideSubscription.current = null;
      }

      const channel = supabase
        .channel(`ride-requests-${driverId}-${Date.now()}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'rides',
        }, async (payload) => {
          console.log('New ride request received:', payload.new);
          const ride = payload.new;
          if (ride.status === 'requested') {
            Alert.alert(
              '🛺 New Ride Request!',
              `Pickup: ${ride.pickup_address}\nTo: ${ride.dropoff_address}\nFare: GHS ${ride.fare_ghs}`,
              [
                {
                  text: 'Decline',
                  style: 'cancel',
                },
                {
                  text: 'Accept ✓',
                  onPress: async () => {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (!user) return;
                    const { data: driver } = await supabase
                      .from('drivers')
                      .select('id')
                      .eq('profile_id', user.id)
                      .single();
                    if (!driver) return;
                    const { error } = await supabase
                      .from('rides')
                      .update({ driver_id: driver.id, status: 'accepted' })
                      .eq('id', ride.id)
                      .eq('status', 'requested');
                    if (error) {
                      Alert.alert('Error', error.message);
                      return;
                    }
                    setActiveRide(ride);
                    setRideStatus('accepted');
                    Alert.alert('Ride Accepted!', 'Head to the pickup location.');
                  },
                },
              ]
            );
          }
        });

      await channel.subscribe((status) => {
        console.log('Subscription status:', status);
      });
      rideSubscription.current = channel;
      console.log('Subscribed to ride requests for driver:', driverId);
    } catch (error) {
      console.error('Subscription error:', error);
    }
  };

  const toggleOnlineStatus = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: driver } = await supabase
        .from('drivers')
        .select('id')
        .eq('profile_id', user.id)
        .single();

      if (!driver) {
        Alert.alert('Error', 'Driver profile not found.');
        return;
      }

      const newStatus = !isOnline;
      setIsOnline(newStatus);

      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setLocation(coords);

      await supabase
        .from('drivers')
        .update({ is_online: newStatus, current_lat: coords.latitude, current_lng: coords.longitude })
        .eq('id', driver.id);

      if (newStatus) {
        await subscribeToRideRequests(driver.id);
        locationInterval.current = setInterval(async () => {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setLocation(coords);
          await supabase
            .from('drivers')
            .update({ current_lat: coords.latitude, current_lng: coords.longitude })
            .eq('id', driver.id);
        }, 5000);
        Alert.alert('You are Online!', 'You will now receive ride requests.');
      } else {
        if (locationInterval.current) clearInterval(locationInterval.current);
        if (rideSubscription.current) {
          await supabase.removeChannel(rideSubscription.current);
          rideSubscription.current = null;
        }
        Alert.alert('You are Offline', 'You will not receive ride requests.');
      }
    } catch (error) {
      Alert.alert('Error', 'Could not update status.');
    }
  };

  const advanceRideStatus = async () => {
    if (!activeRide) return;
    const statusFlow: { [key: string]: string } = {
      accepted: 'in_progress',
      in_progress: 'completed',
    };
    const nextStatus = statusFlow[rideStatus];
    if (!nextStatus) return;

    const { error } = await supabase
      .from('rides')
      .update({
        status: nextStatus,
        ...(nextStatus === 'completed' ? { completed_at: new Date().toISOString() } : {}),
      })
      .eq('id', activeRide.id);

    if (error) { Alert.alert('Error', error.message); return; }

    setRideStatus(nextStatus);
    if (nextStatus === 'completed') {
      Alert.alert(
        'Ride Completed! 🎉',
        `Fare: GHS ${activeRide.fare_ghs}\nPayment: ${activeRide.payment_method?.toUpperCase()}`,
        [{ text: 'Done', onPress: () => { setActiveRide(null); setRideStatus(''); setDailyEarnings(prev => prev + activeRide.fare_ghs); setTotalRides(prev => prev + 1); } }]
      );
    }
  };

  const getStatusLabel = () => {
    if (rideStatus === 'accepted') return 'Heading to Pickup';
    if (rideStatus === 'in_progress') return 'Rider On Board';
    return '';
  };

  const getNextButtonLabel = () => {
    if (rideStatus === 'accepted') return 'Picked Up Rider →';
    if (rideStatus === 'in_progress') return 'Complete Ride ✓';
    return '';
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.replace('/');
  };

  return (
    <View style={styles.container}>
      {/* Stats Bar */}
      <View style={styles.statsBar}>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>GHS {dailyEarnings.toFixed(2)}</Text>
          <Text style={styles.statLabel}>Today's Earnings</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>{totalRides}</Text>
          <Text style={styles.statLabel}>Total Rides</Text>
        </View>
        <View style={styles.statItem}>
          <Text style={styles.statValue}>⭐ {rating.toFixed(1)}</Text>
          <Text style={styles.statLabel}>Rating</Text>
        </View>
      </View>

      {/* Active Ride Banner */}
      {activeRide && (
        <View style={styles.activeBanner}>
          <Text style={styles.activeBannerTitle}>🛺 {getStatusLabel()}</Text>
          <Text style={styles.activeBannerText}>To: {activeRide.dropoff_address}</Text>
          <Text style={styles.activeBannerFare}>
            GHS {activeRide.fare_ghs} · {activeRide.payment_method?.toUpperCase()}
          </Text>
          <TouchableOpacity style={styles.advanceButton} onPress={advanceRideStatus}>
            <Text style={styles.advanceButtonText}>{getNextButtonLabel()}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Map */}
      <View style={styles.mapContainer}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1D9E75" />
            <Text style={styles.loadingText}>Getting your location...</Text>
          </View>
        ) : (
          <MapView
            ref={mapRef}
            style={styles.map}
            initialRegion={{
              latitude: location?.latitude || 7.3349,
              longitude: location?.longitude || -2.3123,
              latitudeDelta: 0.01,
              longitudeDelta: 0.01,
            }}
          >
            <UrlTile
              urlTemplate="https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png"
              maximumZ={19}
              flipY={false}
            />
            {location && (
              <Marker
                coordinate={location}
                title="You are here"
                pinColor={isOnline ? '#1D9E75' : '#999'}
              />
            )}
          </MapView>
        )}
      </View>

      {/* Bottom Panel */}
      <View style={styles.bottomPanel}>
        <TouchableOpacity
          style={[styles.onlineButton, isOnline ? styles.onlineActive : styles.onlineInactive]}
          onPress={toggleOnlineStatus}
          disabled={!!activeRide}
        >
          <Text style={styles.onlineButtonText}>
            {isOnline ? '🟢 Go Offline' : '⚫ Go Online'}
          </Text>
        </TouchableOpacity>
        <View style={styles.actionRow}>
          <TouchableOpacity style={styles.switchButton} onPress={() => router.replace('/rider')}>
            <Text style={styles.switchButtonText}>Switch to Rider</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
            <Text style={styles.logoutButtonText}>Logout</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  statsBar: {
    flexDirection: 'row',
    backgroundColor: '#1D9E75',
    paddingVertical: 12,
    paddingHorizontal: 16,
    justifyContent: 'space-between',
  },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  statLabel: { fontSize: 11, color: '#E1F5EE', marginTop: 2 },
  activeBanner: { backgroundColor: '#185FA5', padding: 14, margin: 10, borderRadius: 10 },
  activeBannerTitle: { fontSize: 16, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  activeBannerText: { fontSize: 13, color: '#E6F1FB', marginBottom: 2 },
  activeBannerFare: { fontSize: 13, color: '#E6F1FB', marginBottom: 10 },
  advanceButton: { backgroundColor: '#fff', paddingVertical: 8, borderRadius: 8, alignItems: 'center' },
  advanceButtonText: { color: '#185FA5', fontWeight: 'bold', fontSize: 14 },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: '#666' },
  bottomPanel: { backgroundColor: '#fff', padding: 16, borderTopWidth: 1, borderTopColor: '#eee' },
  onlineButton: { paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  onlineActive: { backgroundColor: '#FF3B30' },
  onlineInactive: { backgroundColor: '#1D9E75' },
  onlineButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  actionRow: { flexDirection: 'row', gap: 10 },
  switchButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#E6F1FB' },
  switchButtonText: { color: '#185FA5', fontWeight: '600', fontSize: 14 },
  logoutButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#FFE5E5' },
  logoutButtonText: { color: '#FF3B30', fontWeight: '600', fontSize: 14 },
});