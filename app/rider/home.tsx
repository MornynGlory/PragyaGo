import { supabase } from '@/lib/supabase';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, UrlTile } from 'react-native-maps';

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
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [destination, setDestination] = useState('');
  const [stops, setStops] = useState<string[]>([]);
  const [newStop, setNewStop] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'momo'>('cash');
  const [nearbyDrivers, setNearbyDrivers] = useState<any[]>([]);
  const [fareEstimate, setFareEstimate] = useState<number | null>(null);
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

  useEffect(() => {
    requestLocationPermission();
    fetchNearbyDrivers();
    const interval = setInterval(fetchNearbyDrivers, 10000);
    return () => {
      clearInterval(interval);
      if (rideSubscription.current) supabase.removeChannel(rideSubscription.current);
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

  const addStop = () => {
    if (!newStop.trim()) { Alert.alert('Enter a stop location'); return; }
    if (stops.length >= 3) { Alert.alert('Maximum 3 stops allowed'); return; }
    setStops([...stops, newStop.trim()]);
    setNewStop('');
    if (fareEstimate) setFareEstimate(prev => prev ? prev + 2 : prev);
  };

  const removeStop = (index: number) => {
    setStops(stops.filter((_, i) => i !== index));
    if (fareEstimate) setFareEstimate(prev => prev ? prev - 2 : prev);
  };

  const estimateFare = () => {
    if (!destination.trim()) { Alert.alert('Enter Destination', 'Please enter your final destination.'); return; }
    const estimatedKm = Math.random() * 5 + 1;
    const baseFare = 3 + estimatedKm * 1.5;
    const stopsFare = stops.length * 2;
    setFareEstimate(Math.round((baseFare + stopsFare) * 10) / 10);
  };

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
          } else if (ride.status === 'arrived_pickup') {
            setShowDriverCard(false);
            Alert.alert(
              'Driver Arrived! 🛺',
              'Your Pragya driver has arrived. Please confirm pickup.',
              [{ text: 'Confirm Pickup', onPress: () => confirmPickup(ride.id) }]
            );
          } else if (ride.status === 'in_progress') {
            setShowDriverCard(false);
            Alert.alert('Ride Started! 🎉', 'You are now on your way.');
          } else if (ride.status === 'payment_pending') {
            const newFare = ride.final_fare_ghs || ride.fare_ghs;
            setFinalFare(newFare);
            // Show fare acceptance if fare changed
            if (ride.final_fare_ghs && Math.abs(ride.final_fare_ghs - ride.fare_ghs) > 0.5) {
              setShowFareAcceptModal(true);
            } else {
              // Same fare, show payment confirmation directly
              Alert.alert(
                'Reached Destination!',
                `Fare: GHS ${newFare}\nPlease confirm payment.`,
                [
                  { text: 'Later', style: 'cancel' },
                  { text: ride.payment_method === 'cash' ? 'Cash Sent' : 'Confirm Payment', onPress: () => confirmPayment(ride, newFare) }
                ]
              );
            }
          } else if (ride.status === 'completed') {
            setShowDriverCard(false);
            setShowFareAcceptModal(false);
            setCompletedRide(ride);
            setShowRatingModal(true);
            setCurrentRide(null);
            setRideStatus('');
            setRiderConfirmedPayment(false);
            setFinalFare(null);
            if (rideSubscription.current) supabase.removeChannel(rideSubscription.current);
          }
        });
    await channel.subscribe();
    rideSubscription.current = channel;
  };

  const confirmPickup = async (rideId: string) => {
    const { error } = await supabase.from('rides').update({ status: 'in_progress' }).eq('id', rideId);
    if (error) Alert.alert('Error', error.message);
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
          pickup_lat: location.latitude, pickup_lng: location.longitude,
          pickup_address: 'Current Location',
          dropoff_lat: location.latitude + 0.01, dropoff_lng: location.longitude + 0.01,
          dropoff_address: destination,
          stops: allStops, current_stop: 0,
          status: 'requested', fare_ghs: fareEstimate,
          payment_method: paymentMethod,
          created_at: new Date().toISOString(),
        }])
        .select().single();
      if (error) { Alert.alert('Error', error.message); }
      else {
        setCurrentRide(ride); setRideStatus('requested');
        await subscribeToRideUpdates(ride.id);
        Alert.alert('Ride Requested 🛺', stops.length > 0 ? `Finding a driver... ${stops.length} stop(s) added.` : 'Finding a nearby driver...');
        setDestination(''); setStops([]); setFareEstimate(null);
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
        const avgRating = ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length;
        await supabase.from('drivers').update({ rating: Math.round(avgRating * 10) / 10 }).eq('id', driverInfo.id);
      }
      Alert.alert('Thank you!', `You rated your driver ${selectedRating} star${selectedRating > 1 ? 's' : ''}!`);
    } catch (error) { console.error('Error submitting rating:', error); }
    finally {
      setSubmittingRating(false); setShowRatingModal(false);
      setSelectedRating(0); setCompletedRide(null); setDriverInfo(null); setEta(null);
    }
  };

  const handleLogout = async () => { await supabase.auth.signOut(); router.replace('/'); };

  const getRideStatusLabel = () => {
    if (rideStatus === 'requested') return '🔍 Finding your Pragya...';
    if (rideStatus === 'accepted') return `🛺 Driver on the way! ${eta ? `ETA: ${eta}` : ''}`;
    if (rideStatus === 'arrived_pickup') return '🛺 Driver has arrived!';
    if (rideStatus === 'in_progress') return '🎉 Ride in progress';
    if (rideStatus === 'payment_pending') return '💰 Confirm payment';
    return '';
  };

  const displayFare = finalFare || currentRide?.fare_ghs;

  return (
    <View style={styles.container}>
      <View style={styles.mapContainer}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#2563eb" />
            <Text style={styles.loadingText}>Getting your location...</Text>
          </View>
        ) : (
          <MapView ref={mapRef} style={styles.map}
            initialRegion={{ latitude: location?.latitude || 7.3349, longitude: location?.longitude || -2.3123, latitudeDelta: 0.05, longitudeDelta: 0.05 }}>
            <UrlTile urlTemplate="https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png" maximumZ={19} flipY={false} />
            {location && <Marker coordinate={location} title="You are here" pinColor="#2563eb" />}
            {nearbyDrivers.map((driver) => (
              <Marker key={driver.id} coordinate={{ latitude: driver.current_lat, longitude: driver.current_lng }} pinColor="#1D9E75" />
            ))}
          </MapView>
        )}
      </View>

      {currentRide && (
        <View style={styles.rideStatusBanner}>
          <Text style={styles.rideStatusText}>{getRideStatusLabel()}</Text>
          <Text style={styles.rideStatusSub}>To: {currentRide.dropoff_address}</Text>
          {currentRide.stops?.length > 0 && (
            <Text style={styles.rideStatusStops}>Stops: {currentRide.stops.map((s: any) => s.address).join(' → ')}</Text>
          )}
          <View style={styles.fareRow}>
            <Text style={styles.rideStatusFare}>GHS {displayFare}</Text>
            {finalFare && finalFare !== currentRide.fare_ghs && (
              <Text style={styles.originalFare}>(est. GHS {currentRide.fare_ghs})</Text>
            )}
          </View>
          <View style={styles.rideActions}>
            {rideStatus === 'requested' && (
              <TouchableOpacity style={styles.cancelButton} onPress={cancelRide}>
                <Text style={styles.cancelButtonText}>Cancel Ride</Text>
              </TouchableOpacity>
            )}
            {rideStatus === 'payment_pending' && !riderConfirmedPayment && (
              <TouchableOpacity style={styles.confirmPaymentButton} onPress={() => confirmPayment(currentRide, displayFare)}>
                <Text style={styles.confirmPaymentText}>
                  {currentRide.payment_method === 'cash' ? 'Cash Sent' : 'Confirm Payment'}
                </Text>
              </TouchableOpacity>
            )}
            {driverInfo && (rideStatus === 'accepted' || rideStatus === 'arrived_pickup') && (
              <TouchableOpacity style={styles.viewDriverButton} onPress={() => setShowDriverCard(true)}>
                <Text style={styles.viewDriverButtonText}>View Driver</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {!currentRide && (
        <ScrollView style={styles.bottomPanel}>
          <Text style={styles.panelTitle}>Where do you want to go?</Text>
          <Text style={styles.driversCount}>
            {nearbyDrivers.length > 0 ? `🛺 ${nearbyDrivers.length} Pragya driver${nearbyDrivers.length > 1 ? 's' : ''} nearby` : '😔 No drivers nearby right now'}
          </Text>
          <Text style={styles.inputLabel}>Final Destination</Text>
          <TextInput style={styles.input} placeholder="Enter final destination" value={destination} onChangeText={setDestination} placeholderTextColor="#999" />
          {stops.length > 0 && (
            <View style={styles.stopsContainer}>
              <Text style={styles.stopsTitle}>Stops ({stops.length}/3)</Text>
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
          )}
          {stops.length < 3 && (
            <View style={styles.addStopRow}>
              <TextInput style={styles.stopInput} placeholder="Add a stop (optional)" value={newStop} onChangeText={setNewStop} placeholderTextColor="#999" />
              <TouchableOpacity style={styles.addStopButton} onPress={addStop}>
                <Text style={styles.addStopButtonText}>+ Add</Text>
              </TouchableOpacity>
            </View>
          )}
          {!fareEstimate && (
            <TouchableOpacity onPress={estimateFare} style={styles.estimateButton}>
              <Text style={styles.estimateButtonText}>Estimate Fare</Text>
            </TouchableOpacity>
          )}
          {fareEstimate && (
            <View style={styles.fareContainer}>
              <View>
                <Text style={styles.fareLabel}>Estimated Fare</Text>
                <Text style={styles.fareNote}>Final fare based on actual distance</Text>
                {stops.length > 0 && <Text style={styles.fareBreakdown}>Includes {stops.length} stop{stops.length > 1 ? 's' : ''} (+GHS {stops.length * 2})</Text>}
              </View>
              <Text style={styles.fareAmount}>GHS {fareEstimate}</Text>
            </View>
          )}
          <View style={styles.paymentContainer}>
            <Text style={styles.paymentLabel}>Payment Method</Text>
            <View style={styles.paymentOptions}>
              <TouchableOpacity style={[styles.paymentOption, paymentMethod === 'cash' && styles.paymentActive]} onPress={() => setPaymentMethod('cash')}>
                <Text style={[styles.paymentText, paymentMethod === 'cash' && styles.paymentTextActive]}>Cash</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.paymentOption, paymentMethod === 'momo' && styles.paymentActive]} onPress={() => setPaymentMethod('momo')}>
                <Text style={[styles.paymentText, paymentMethod === 'momo' && styles.paymentTextActive]}>Go Cash</Text>
              </TouchableOpacity>
            </View>
          </View>
          <TouchableOpacity style={[styles.requestButton, requesting && styles.buttonDisabled]} onPress={requestRide} disabled={requesting}>
            {requesting ? <ActivityIndicator color="#fff" /> : <Text style={styles.requestButtonText}>🛺 Request Pragya</Text>}
          </TouchableOpacity>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.walletButton} onPress={() => router.push('/rider/gocash')}>
              <Text style={styles.walletButtonText}>💰 My Wallet</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.switchButton} onPress={() => Alert.alert('Want to become a Driver?', 'To register as a Pragya driver, visit any PragyaGo office or station near you with your Ghana Card and vehicle details.\n\nOur offices are open Monday to Friday, 8am - 5pm.', [{ text: 'OK' }])}>
              <Text style={styles.switchButtonText}>Become a Driver</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      )}

      {/* Fare Accept Modal */}
      <Modal visible={showFareAcceptModal} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.fareAcceptCard}>
            <Text style={styles.fareAcceptTitle}>Fare Updated</Text>
            <Text style={styles.fareAcceptSubtitle}>Based on your actual trip distance, the fare has been recalculated.</Text>
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
            {currentRide?.actual_distance_km && (
              <Text style={styles.fareDistance}>Actual distance: {currentRide.actual_distance_km} km</Text>
            )}
            <TouchableOpacity style={styles.acceptFareButton} onPress={acceptNewFare}>
              <Text style={styles.acceptFareButtonText}>Accept & Pay GHS {finalFare}</Text>
            </TouchableOpacity>
            <Text style={styles.fareAcceptNote}>By accepting, you agree to pay the updated fare.</Text>
          </View>
        </View>
      </Modal>

      {/* Driver Card Modal */}
      <Modal visible={showDriverCard} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={styles.driverCard}>
            <Text style={styles.driverCardTitle}>Your Driver</Text>
            {eta && <View style={styles.etaBadge}><Text style={styles.etaText}>ETA: {eta}</Text></View>}
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
        <View style={styles.modalOverlay}>
          <View style={styles.ratingCard}>
            <Text style={styles.ratingTitle}>Rate Your Ride</Text>
            <Text style={styles.ratingSubtitle}>How was your experience?</Text>
            {driverInfo?.photo_url ? (
              <Image source={{ uri: driverInfo.photo_url }} style={styles.ratingDriverPhoto} />
            ) : (
              <View style={styles.ratingDriverPhotoPlaceholder}><Text style={{ fontSize: 40 }}>👤</Text></View>
            )}
            <Text style={styles.ratingFare}>Fare paid: GHS {completedRide?.final_fare_ghs || completedRide?.fare_ghs}</Text>
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
  bottomPanel: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, maxHeight: 480, borderTopWidth: 1, borderTopColor: '#eee' },
  panelTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', marginBottom: 4 },
  driversCount: { fontSize: 13, color: '#1D9E75', marginBottom: 12 },
  inputLabel: { fontSize: 13, fontWeight: '600', color: '#666', marginBottom: 6 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 12, fontSize: 14, backgroundColor: '#f9f9f9', color: '#333', marginBottom: 10 },
  stopsContainer: { backgroundColor: '#f9f9f9', borderRadius: 8, padding: 10, marginBottom: 10 },
  stopsTitle: { fontSize: 13, fontWeight: '600', color: '#333', marginBottom: 8 },
  stopRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  stopNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#2563eb', color: '#fff', textAlign: 'center', lineHeight: 24, fontSize: 12, fontWeight: 'bold', marginRight: 10 },
  stopText: { flex: 1, fontSize: 13, color: '#333' },
  removeStop: { fontSize: 16, color: '#FF3B30', paddingHorizontal: 8 },
  addStopRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  stopInput: { flex: 1, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, backgroundColor: '#f9f9f9', color: '#333' },
  addStopButton: { backgroundColor: '#2563eb', paddingHorizontal: 14, borderRadius: 8, justifyContent: 'center' },
  addStopButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  estimateButton: { backgroundColor: '#f0f0f0', paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginBottom: 10 },
  estimateButtonText: { color: '#333', fontWeight: '600' },
  fareContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#E1F5EE', padding: 12, borderRadius: 8, marginBottom: 10 },
  fareLabel: { fontSize: 14, color: '#085041', fontWeight: '600' },
  fareNote: { fontSize: 11, color: '#1D9E75', marginTop: 1 },
  fareBreakdown: { fontSize: 11, color: '#1D9E75', marginTop: 1 },
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
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  fareAcceptCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  fareAcceptTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', textAlign: 'center', marginBottom: 8 },
  fareAcceptSubtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 20 },
  fareCompare: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 16, marginBottom: 12 },
  fareCompareItem: { alignItems: 'center' },
  fareCompareLabel: { fontSize: 12, color: '#999', marginBottom: 4 },
  fareCompareOld: { fontSize: 20, color: '#999', textDecorationLine: 'line-through' },
  fareCompareNew: { fontSize: 28, fontWeight: 'bold', color: '#1D9E75' },
  fareArrow: { fontSize: 20, color: '#999' },
  fareDistance: { fontSize: 13, color: '#666', textAlign: 'center', marginBottom: 16 },
  acceptFareButton: { backgroundColor: '#1D9E75', paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginBottom: 8 },
  acceptFareButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  fareAcceptNote: { fontSize: 12, color: '#999', textAlign: 'center' },
  driverCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24 },
  driverCardTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', textAlign: 'center', marginBottom: 8 },
  etaBadge: { backgroundColor: '#E1F5EE', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 4, alignSelf: 'center', marginBottom: 12 },
  etaText: { color: '#085041', fontWeight: '600', fontSize: 14 },
  driverPhotoSection: { alignItems: 'center', marginBottom: 12, position: 'relative' },
  driverPhoto: { width: 90, height: 90, borderRadius: 45, borderWidth: 3, borderColor: '#1D9E75' },
  driverPhotoPlaceholder: { width: 90, height: 90, borderRadius: 45, backgroundColor: '#E1F5EE', justifyContent: 'center', alignItems: 'center', borderWidth: 3, borderColor: '#1D9E75' },
  driverRatingBadge: { position: 'absolute', bottom: 0, right: '30%', backgroundColor: '#FFD60A', borderRadius: 12, paddingHorizontal: 8, paddingVertical: 2 },
  driverRatingText: { fontSize: 12, fontWeight: 'bold', color: '#333' },
  driverName: { fontSize: 20, fontWeight: 'bold', color: '#333', textAlign: 'center', marginBottom: 4 },
  driverRides: { fontSize: 13, color: '#999', textAlign: 'center', marginBottom: 16 },
  pragyaDetails: { backgroundColor: '#f9f9f9', borderRadius: 12, padding: 14, marginBottom: 16 },
  pragyaDetailRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: '#eee' },
  pragyaDetailLabel: { fontSize: 13, color: '#666' },
  pragyaDetailValue: { fontSize: 13, fontWeight: '600', color: '#333' },
  pragyaColorRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pragyaColorDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: '#ddd' },
  closeCardButton: { backgroundColor: '#1D9E75', paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  closeCardButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  ratingCard: { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, alignItems: 'center' },
  ratingTitle: { fontSize: 22, fontWeight: 'bold', color: '#333', marginBottom: 8 },
  ratingSubtitle: { fontSize: 14, color: '#666', textAlign: 'center', marginBottom: 16 },
  ratingDriverPhoto: { width: 80, height: 80, borderRadius: 40, borderWidth: 3, borderColor: '#1D9E75', marginBottom: 8 },
  ratingDriverPhotoPlaceholder: { width: 80, height: 80, borderRadius: 40, backgroundColor: '#E1F5EE', justifyContent: 'center', alignItems: 'center', marginBottom: 8 },
  ratingFare: { fontSize: 14, color: '#1D9E75', fontWeight: '600', marginBottom: 16 },
  starsRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  star: { fontSize: 44, color: '#ddd' },
  starSelected: { color: '#FFD60A' },
  ratingLabel: { fontSize: 14, color: '#666', marginBottom: 20, height: 20 },
  submitRatingButton: { backgroundColor: '#1D9E75', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 10, alignItems: 'center', width: '100%', marginBottom: 10 },
  submitRatingText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  skipRatingButton: { paddingVertical: 10 },
  skipRatingText: { color: '#999', fontSize: 14 },
});
