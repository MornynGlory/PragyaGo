import { supabase } from '@/lib/supabase';
import { getDriverToken, getRiderToken, sendPushNotification } from '@/lib/notifications';
import { calculateFinalFare } from '@/lib/fares';
import { useTheme } from '@/lib/useTheme';
import { autoAssignDriverZone } from '@/lib/zones';
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
import MapView, { Marker } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};


export default function DriverHomeScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dailyEarnings, setDailyEarnings] = useState(0);
  const [totalRides, setTotalRides] = useState(0);
  const [rating, setRating] = useState(0);
  const [activeRide, setActiveRide] = useState<any>(null);
  const [rideStatus, setRideStatus] = useState('');
  const [driverConfirmedPayment, setDriverConfirmedPayment] = useState(false);
  const [currentStopIndex, setCurrentStopIndex] = useState(0);
  const [pickupLocation, setPickupLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [recalculatedFare, setRecalculatedFare] = useState<number | null>(null);
  const locationInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const rideSubscription = useRef<any>(null);
  const locationRef = useRef<{ latitude: number; longitude: number } | null>(null);
  const [currentZoneId, setCurrentZoneId] = useState<string | null>(null);
  const currentZoneIdRef = useRef<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isLocked, setIsLocked] = useState(false);
  const [commissionOwed, setCommissionOwed] = useState(0);

  useEffect(() => {
    requestLocationPermission();
    fetchDriverStats();
    fetchUnreadCount();
    return () => {
      if (locationInterval.current) clearInterval(locationInterval.current);
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
      locationRef.current = coords;
      setLoading(false);
      mapRef.current?.animateToRegion({ ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 });
    } catch { setLoading(false); }
  };

  const fetchDriverStats = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: driver } = await supabase.from('drivers').select('*').eq('profile_id', user.id).single();
      if (driver) {
        setRating(driver.rating || 0);
        setTotalRides(driver.total_rides || 0);
        setIsOnline(driver.is_online || false);
        setCurrentZoneId(driver.zone_id || null);
        currentZoneIdRef.current = driver.zone_id || null;

        const dbCommission = driver.commission_owed ?? 0;
        const dbLocked = driver.is_locked || false;
        setCommissionOwed(dbCommission);
        // Lock is only effective when commission_owed > 0; repair stale flag if needed
        if (dbLocked && dbCommission === 0) {
          await supabase.from('drivers').update({ is_locked: false }).eq('id', driver.id);
          setIsLocked(false);
        } else {
          setIsLocked(dbLocked);
        }

        if (driver.is_online) await subscribeToRideRequests(driver.id);
      }
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const { data: payments } = await supabase.from('payments').select('amount_ghs').eq('status', 'success').gte('created_at', today.toISOString());
      if (payments) setDailyEarnings(payments.reduce((sum, p) => sum + (p.amount_ghs || 0), 0));
    } catch (error) { console.error('Error fetching stats:', error); }
  };

  const subscribeToRideRequests = async (driverId: string) => {
    try {
      if (rideSubscription.current) { await supabase.removeChannel(rideSubscription.current); rideSubscription.current = null; }
      const channel = supabase
        .channel(`ride-requests-${driverId}-${Date.now()}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'rides' }, async (payload) => {
          const ride = payload.new;
          if (ride.status === 'requested') {
            const requestFare = (ride.discounted_fare && ride.discounted_fare > 0 ? ride.discounted_fare : null) ?? ride.fare_ghs;
            const stopsInfo = ride.stops?.length > 0 ? `\nStops: ${ride.stops.map((s: any) => s.address).join(' → ')}` : '';
            const driverToken = await getDriverToken(driverId);
            if (driverToken) {
              await sendPushNotification(
                driverToken,
                '🛺 New Ride Request!',
                `Pickup: ${ride.pickup_address} → ${ride.dropoff_address} | GHS ${requestFare}`
              );
            }
            Alert.alert(
              'New Ride Request!',
              `Pickup: ${ride.pickup_address}\nTo: ${ride.dropoff_address}${stopsInfo}\nEstimated Fare: GHS ${requestFare}`,
              [
                { text: 'Decline', style: 'cancel' },
                { text: 'Accept', onPress: async () => {
                  const { data: { user } } = await supabase.auth.getUser();
                  if (!user) return;
                  const { data: driver } = await supabase.from('drivers').select('id').eq('profile_id', user.id).single();
                  if (!driver) return;
                  const { error } = await supabase.from('rides').update({ driver_id: driver.id, status: 'accepted' }).eq('id', ride.id).eq('status', 'requested');
                  if (error) { Alert.alert('Error', error.message); return; }
                  setActiveRide(ride);
                  setRideStatus('accepted');
                  setCurrentStopIndex(0);
                  setRecalculatedFare(null);
                  const riderToken = await getRiderToken(ride.rider_id);
                  if (riderToken) {
                    await sendPushNotification(
                      riderToken,
                      'Driver Found! 🛺',
                      'Your Pragya driver is on the way. ETA ~5 mins.'
                    );
                  }
                  Alert.alert('Ride Accepted!', 'Head to the pickup location.');
                }},
              ]
            );
          }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rides', filter: `driver_id=eq.${driverId}` }, async (payload) => {
          const ride = payload.new;
          setActiveRide(ride);
          setRideStatus(ride.status);
          if (ride.status === 'in_progress') {
            if (locationRef.current) setPickupLocation(locationRef.current);
            Alert.alert('Rider Confirmed!', 'Ride has started.');
          }
          if (ride.status === 'completed') {
            const actualFare = (ride.discounted_fare && ride.discounted_fare > 0 ? ride.discounted_fare : null) ?? ride.final_fare_ghs ?? ride.fare_ghs;
            setDailyEarnings(prev => prev + actualFare);
            setTotalRides(prev => prev + 1);
            setActiveRide(null); setRideStatus('');
            setDriverConfirmedPayment(false); setCurrentStopIndex(0);
            setPickupLocation(null); setRecalculatedFare(null);
            const riderToken = await getRiderToken(ride.rider_id);
            if (riderToken) {
              await sendPushNotification(
                riderToken,
                'Ride Complete! ✅',
                `Your ride is complete. Total fare: GHS ${actualFare}. Thank you for riding with PragyaGo!`
              );
            }
            const today = new Date().toISOString().split('T')[0];
            const isCash = ride.payment_method === 'cash';
            const { data: existingReport } = await supabase
              .from('driver_daily_reports')
              .select('*')
              .eq('driver_id', driverId)
              .eq('report_date', today)
              .single();
            if (existingReport) {
              const newCashCollected = existingReport.total_cash_collected + (isCash ? actualFare : 0);
              const newGoCashEarned = existingReport.total_go_cash_earned + (!isCash ? actualFare : 0);
              await supabase.from('driver_daily_reports').update({
                total_cash_rides: existingReport.total_cash_rides + (isCash ? 1 : 0),
                total_cash_collected: newCashCollected,
                total_go_cash_rides: existingReport.total_go_cash_rides + (!isCash ? 1 : 0),
                total_go_cash_earned: newGoCashEarned,
                commission_owed: Math.round((newCashCollected + newGoCashEarned) * 0.15 * 100) / 100,
              }).eq('id', existingReport.id);
            } else {
              await supabase.from('driver_daily_reports').insert([{
                driver_id: driverId,
                report_date: today,
                total_cash_rides: isCash ? 1 : 0,
                total_cash_collected: isCash ? actualFare : 0,
                total_go_cash_rides: !isCash ? 1 : 0,
                total_go_cash_earned: !isCash ? actualFare : 0,
                commission_owed: Math.round(actualFare * 0.15 * 100) / 100,
                commission_paid: false,
              }]);
            }
            Alert.alert('Ride Complete!', `GHS ${actualFare} earned!`);

            // Re-check commission_owed; auto-unlock if it has been cleared
            const { data: freshDriver } = await supabase
              .from('drivers')
              .select('commission_owed, is_locked')
              .eq('id', driverId)
              .single();
            if (freshDriver) {
              const owedNow = freshDriver.commission_owed ?? 0;
              setCommissionOwed(owedNow);
              if (owedNow === 0 && freshDriver.is_locked) {
                await supabase.from('drivers').update({ is_locked: false }).eq('id', driverId);
                setIsLocked(false);
              } else {
                setIsLocked(freshDriver.is_locked || false);
              }
            }

            await subscribeToRideRequests(driverId);
          }
        });
      await channel.subscribe((status) => console.log('Subscription status:', status));
      rideSubscription.current = channel;
    } catch (error) { console.error('Subscription error:', error); }
  };

  const toggleOnlineStatus = async () => {
    // Dual-condition lock: only block when BOTH is_locked=true AND commission_owed > 0
    if (isLocked && commissionOwed > 0) {
      Alert.alert(
        '🔒 Account Locked',
        `You have GHS ${commissionOwed.toFixed(2)} in unpaid commission. Please top up your wallet to settle it and unlock your account.`,
        [{ text: 'Go to Wallet', onPress: () => router.push('/driver/wallet' as any) }, { text: 'Cancel', style: 'cancel' }]
      );
      return;
    }
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: driver } = await supabase.from('drivers').select('id').eq('profile_id', user.id).single();
      if (!driver) { Alert.alert('Error', 'Driver profile not found.'); return; }
      const newStatus = !isOnline;
      setIsOnline(newStatus);
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      setLocation(coords);
      locationRef.current = coords;
      await supabase.from('drivers').update({ is_online: newStatus, current_lat: coords.latitude, current_lng: coords.longitude }).eq('id', driver.id);
      const zoneResult = await autoAssignDriverZone(driver.id, coords.latitude, coords.longitude, currentZoneIdRef.current);
      if (zoneResult.changed && zoneResult.newZone) {
        setCurrentZoneId(zoneResult.newZone.id);
        currentZoneIdRef.current = zoneResult.newZone.id;
        Alert.alert('Zone Updated', 'You are now in ' + zoneResult.newZone.name);
      }
      if (newStatus) {
        await subscribeToRideRequests(driver.id);
        locationInterval.current = setInterval(async () => {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
          setLocation(coords);
          locationRef.current = coords;
          await supabase.from('drivers').update({ current_lat: coords.latitude, current_lng: coords.longitude }).eq('id', driver.id);
          const zoneResult = await autoAssignDriverZone(driver.id, coords.latitude, coords.longitude, currentZoneIdRef.current);
          if (zoneResult.changed && zoneResult.newZone) {
            setCurrentZoneId(zoneResult.newZone.id);
            currentZoneIdRef.current = zoneResult.newZone.id;
            Alert.alert('Zone Updated', 'You are now in ' + zoneResult.newZone.name);
          }
        }, 5000);
        Alert.alert('You are Online!', 'You will now receive ride requests.');
      } else {
        if (locationInterval.current) clearInterval(locationInterval.current);
        if (rideSubscription.current) { await supabase.removeChannel(rideSubscription.current); rideSubscription.current = null; }
        Alert.alert('You are Offline', 'You will not receive ride requests.');
      }
    } catch (error) { Alert.alert('Error', 'Could not update status.'); }
  };

  const arrivedAtPickup = async () => {
    if (!activeRide) return;
    const { error } = await supabase.from('rides').update({ status: 'arrived_pickup' }).eq('id', activeRide.id);
    if (error) { Alert.alert('Error', error.message); return; }
    setRideStatus('arrived_pickup');

    // Fetch driver's own name for the notification message
    let driverName = 'Your driver';
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
      if (profile?.full_name) driverName = profile.full_name;
    }

    // Push notification to rider
    const riderToken = await getRiderToken(activeRide.rider_id);
    if (riderToken) {
      await sendPushNotification(
        riderToken,
        '🛺 Your Driver Has Arrived!',
        `Your Pragya driver ${driverName} has arrived at your pickup location. Please come out!`
      );
    }

    // In-app notification record for rider's notification feed
    await supabase.from('user_notifications').insert({
      user_id: activeRide.rider_id,
      title: 'Driver Has Arrived!',
      message: `Your driver ${driverName} is waiting for you at ${activeRide.pickup_address}`,
      type: 'ride_update',
      is_read: false,
      created_at: new Date().toISOString(),
    });

    Alert.alert('Arrived at Pickup!', "Rider has been notified that you've arrived.");
  };

  const arrivedAtStop = async () => {
    if (!activeRide) return;
    const stops = activeRide.stops || [];
    const nextStopIndex = currentStopIndex + 1;
    const updatedStops = stops.map((stop: any, index: number) =>
      index === currentStopIndex ? { ...stop, completed: true } : stop
    );
    await supabase.from('rides').update({ stops: updatedStops, current_stop: nextStopIndex }).eq('id', activeRide.id);
    setCurrentStopIndex(nextStopIndex);
    setActiveRide({ ...activeRide, stops: updatedStops });
    if (nextStopIndex < stops.length) {
      Alert.alert('Stop Completed!', `Moving to next stop: ${stops[nextStopIndex].address}`);
    } else {
      Alert.alert('All Stops Done!', 'Now head to the final destination.');
    }
  };

  const reachedDestination = async () => {
    if (!activeRide || !location) return;

    const startLat = activeRide.pickup_lat;
    const startLng = activeRide.pickup_lng;
    const actualDistanceKm = calculateDistance(startLat, startLng, location.latitude, location.longitude);
    const actualDistanceRounded = Math.round(actualDistanceKm * 100) / 100;

    const originalFare = activeRide.estimated_fare || activeRide.fare_ghs;
    const expectedDistanceKm = activeRide.expected_distance_km ?? actualDistanceKm;
    const { finalFare: newFare, increased } = calculateFinalFare(originalFare, expectedDistanceKm, actualDistanceKm);
    const fareDiff = Math.round(Math.abs(newFare - originalFare) * 100) / 100;

    setRecalculatedFare(newFare);

    await supabase.from('rides').update({
      actual_dropoff_lat: location.latitude,
      actual_dropoff_lng: location.longitude,
      actual_distance_km: actualDistanceRounded,
      final_fare_ghs: newFare,
      status: 'payment_pending',
    }).eq('id', activeRide.id);

    setRideStatus('payment_pending');

    if (fareDiff > 0.5 && increased) {
      Alert.alert(
        'Fare Recalculated',
        `Fare adjusted: +GHS ${fareDiff.toFixed(2)} (longer route)\nFinal fare: GHS ${newFare.toFixed(2)}\n\nWaiting for rider to accept.`
      );
    } else if (fareDiff > 0.5 && !increased) {
      Alert.alert(
        'Fare Recalculated',
        `Fare reduced: -GHS ${fareDiff.toFixed(2)} (shorter route)\nFinal fare: GHS ${newFare.toFixed(2)}\n\nWaiting for rider to accept.`
      );
    } else {
      Alert.alert('Destination Reached!', `Fare unchanged: GHS ${newFare.toFixed(2)}\nConfirm payment with rider.`);
    }
  };

  const confirmPaymentReceived = async () => {
    if (!activeRide) return;
    setDriverConfirmedPayment(true);
    const { data: ride } = await supabase.from('rides').select('rider_confirmed_payment, fare_accepted').eq('id', activeRide.id).single();

    if (!ride?.fare_accepted && recalculatedFare !== activeRide.fare_ghs) {
      Alert.alert('Waiting', 'Waiting for rider to accept the recalculated fare...');
      await supabase.from('rides').update({ driver_confirmed_payment: true }).eq('id', activeRide.id);
      return;
    }

    if (ride?.rider_confirmed_payment) {
      await supabase.from('rides').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', activeRide.id);
    } else {
      await supabase.from('rides').update({ driver_confirmed_payment: true }).eq('id', activeRide.id);
      Alert.alert('Payment Confirmed!', 'Waiting for rider to confirm...');
    }
  };

  const reportBreakdown = () => {
    Alert.alert(
      'Report Vehicle Breakdown?',
      'By reporting a breakdown you confirm your Pragya has broken down and cannot complete this ride. Important: The rider will NOT be charged. You will still owe PragyaGo the commission for this ride. This will be deducted from your wallet.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report Breakdown',
          style: 'destructive',
          onPress: async () => {
            if (!activeRide) return;
            try {
              const { data: { user } } = await supabase.auth.getUser();
              if (!user) return;

              const [{ data: driverProfile }, { data: driverRecord }, { data: riderProfile }] = await Promise.all([
                supabase.from('profiles').select('full_name').eq('id', user.id).single(),
                supabase.from('drivers').select('id, commission_owed').eq('profile_id', user.id).single(),
                supabase.from('profiles').select('full_name').eq('id', activeRide.rider_id).single(),
              ]);

              const driverName = driverProfile?.full_name ?? 'Unknown Driver';
              const riderName = riderProfile?.full_name ?? 'Unknown Rider';
              const commission = Math.round(activeRide.fare_ghs * 0.15 * 100) / 100;

              await supabase.from('rides').update({
                status: 'cancelled',
                cancellation_reason: 'driver_breakdown',
              }).eq('id', activeRide.id);

              await supabase.from('user_notifications').insert({
                user_id: activeRide.rider_id,
                title: 'Driver Breakdown',
                message: "Your driver's vehicle has broken down. You will not be charged for this ride. We apologize for the inconvenience.",
                type: 'ride_update',
                is_read: false,
                created_at: new Date().toISOString(),
              });

              const { data: admins } = await supabase.from('profiles').select('id').eq('role', 'admin');
              if (admins && admins.length > 0) {
                await supabase.from('user_notifications').insert(
                  admins.map((admin: { id: string }) => ({
                    user_id: admin.id,
                    title: 'Driver Breakdown Reported',
                    message: `Driver breakdown reported on ride ${activeRide.id}. Driver: ${driverName}. Rider: ${riderName}. Commission: GHS ${commission.toFixed(2)}`,
                    type: 'admin_alert',
                    is_read: false,
                    created_at: new Date().toISOString(),
                  }))
                );
              }

              if (driverRecord) {
                await supabase.from('drivers').update({
                  commission_owed: (driverRecord.commission_owed ?? 0) + commission,
                }).eq('id', driverRecord.id);
              }

              setActiveRide(null);
              setRideStatus('');

              Alert.alert(
                'Breakdown Reported',
                `The rider has been notified. Commission of GHS ${commission.toFixed(2)} has been added to your account.`
              );
            } catch (error) {
              console.error('Breakdown report error:', error);
              Alert.alert('Error', 'Failed to report breakdown. Please try again.');
            }
          },
        },
      ]
    );
  };

  const getStatusLabel = () => {
    if (rideStatus === 'accepted') return 'Heading to Pickup';
    if (rideStatus === 'arrived_pickup') return 'Arrived — Waiting for Rider';
    if (rideStatus === 'in_progress') {
      const stops = activeRide?.stops || [];
      if (stops.length > 0 && currentStopIndex < stops.length) return `Stop ${currentStopIndex + 1}: ${stops[currentStopIndex].address}`;
      return 'Heading to Final Destination';
    }
    if (rideStatus === 'payment_pending') return 'Confirm Payment';
    return '';
  };

  const hasMoreStops = () => {
    const stops = activeRide?.stops || [];
    return rideStatus === 'in_progress' && currentStopIndex < stops.length;
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

  const activeRideFare = (activeRide?.discounted_fare && activeRide?.discounted_fare > 0 ? activeRide?.discounted_fare : null) ?? activeRide?.fare_ghs;
  const displayFare = recalculatedFare || activeRideFare;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
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
          <Text style={styles.statValue}>★ {rating.toFixed(1)}</Text>
          <Text style={styles.statLabel}>Rating</Text>
        </View>
        <TouchableOpacity style={styles.bellBtn} onPress={() => router.push('/notifications' as any)}>
          <Text style={styles.bellIcon}>🔔</Text>
          {unreadCount > 0 && (
            <View style={styles.bellBadge}>
              <Text style={styles.bellBadgeText}>{unreadCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {activeRide && (
        <View style={styles.activeBanner}>
          <Text style={styles.activeBannerTitle}>{getStatusLabel()}</Text>
          <Text style={styles.activeBannerText}>To: {activeRide.dropoff_address}</Text>
          {activeRide.stops?.length > 0 && (
            <Text style={styles.activeBannerStops}>
              {activeRide.stops.filter((s: any) => s.completed).length}/{activeRide.stops.length} stops completed
            </Text>
          )}
          <View style={styles.fareRow}>
            <Text style={styles.activeBannerFare}>GHS {displayFare}</Text>
            <Text style={styles.activeBannerPayment}>{activeRide.payment_method?.toUpperCase()}</Text>
          </View>

          {rideStatus === 'accepted' && (
            <TouchableOpacity style={styles.actionBtn} onPress={arrivedAtPickup}>
              <Text style={styles.actionBtnText}>Arrived at Pickup</Text>
            </TouchableOpacity>
          )}
          {rideStatus === 'arrived_pickup' && (
            <View style={styles.waitingBadge}>
              <Text style={styles.waitingText}>Waiting for rider to confirm pickup...</Text>
            </View>
          )}
          {rideStatus === 'in_progress' && (
            <>
              {hasMoreStops() ? (
                <TouchableOpacity style={styles.actionBtn} onPress={arrivedAtStop}>
                  <Text style={styles.actionBtnText}>Arrived at Stop {currentStopIndex + 1}</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#1D9E75' }]} onPress={reachedDestination}>
                  <Text style={styles.actionBtnText}>Reached Final Destination</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.breakdownBtn} onPress={reportBreakdown}>
                <Text style={styles.breakdownBtnText}>⚠️ Report Breakdown</Text>
              </TouchableOpacity>
            </>
          )}
          {rideStatus === 'payment_pending' && (
            <View>
              <Text style={styles.paymentInstructions}>
                {activeRide.payment_method === 'cash'
                  ? `Collect GHS ${displayFare} cash from rider`
                  : `Go Cash: GHS ${displayFare}`}
              </Text>
              {!driverConfirmedPayment ? (
                <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#1D9E75' }]} onPress={confirmPaymentReceived}>
                  <Text style={styles.actionBtnText}>
                    {activeRide.payment_method === 'cash' ? 'Cash Received' : 'Confirm Payment'}
                  </Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.waitingBadge}>
                  <Text style={styles.waitingText}>Waiting for rider to confirm payment...</Text>
                </View>
              )}
            </View>
          )}
        </View>
      )}

      <View style={styles.mapContainer}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#1D9E75" />
            <Text style={styles.loadingText}>Getting your location...</Text>
          </View>
        ) : (
          <MapView ref={mapRef} style={styles.map} mapType="standard" zoomEnabled={true} scrollEnabled={true}
            initialRegion={{ latitude: location?.latitude || 7.3349, longitude: location?.longitude || -2.3123, latitudeDelta: 0.01, longitudeDelta: 0.01 }}>
            {location && (
              <Marker coordinate={location} title="You are here">
                <View style={[styles.tricycleMarker, !isOnline && styles.tricycleMarkerOffline]}>
                  <Text style={styles.tricycleEmoji}>🛺</Text>
                </View>
              </Marker>
            )}
          </MapView>
        )}
      </View>

      {!activeRide && (
        <View style={[styles.bottomPanel, { paddingBottom: insets.bottom + 16 }]}>
          {isLocked && commissionOwed > 0 && (
            <TouchableOpacity
              style={styles.lockBanner}
              onPress={() => router.push('/driver/wallet' as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.lockBannerText}>
                🔒 Account locked — GHS {commissionOwed.toFixed(2)} commission owed. Tap to pay.
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[
              styles.onlineButton,
              isOnline ? styles.onlineActive : styles.onlineInactive,
              isLocked && commissionOwed > 0 && styles.onlineDisabled,
            ]}
            onPress={toggleOnlineStatus}
          >
            <Text style={styles.onlineButtonText}>{isOnline ? 'Go Offline' : 'Go Online'}</Text>
          </TouchableOpacity>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.walletButton} onPress={() => router.push('/driver/wallet' as any)}>
              <Text style={styles.walletButtonText}>💰 Wallet</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.profileButton} onPress={() => router.push('/driver/profile')}>
              <Text style={styles.profileButtonText}>Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.reportButton} onPress={() => router.push('/driver/report')}>
              <Text style={styles.reportButtonText}>Report</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.switchButton} onPress={() => router.replace('/rider/home' as any)}>
              <Text style={styles.switchButtonText}>👤 Rider Mode</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.supportButton} onPress={() => router.push('/support' as any)}>
              <Text style={styles.supportButtonText}>🎧 Support</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutButtonText}>Logout</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#1D9E75' },
  container: { flex: 1, backgroundColor: c.background },
  statsBar: { flexDirection: 'row', backgroundColor: '#1D9E75', paddingVertical: 12, paddingHorizontal: 16, justifyContent: 'space-between' },
  statItem: { alignItems: 'center' },
  statValue: { fontSize: 16, fontWeight: 'bold', color: '#fff' },
  statLabel: { fontSize: 11, color: '#E1F5EE', marginTop: 2 },
  activeBanner: { backgroundColor: '#185FA5', padding: 14, margin: 10, borderRadius: 10 },
  activeBannerTitle: { fontSize: 15, fontWeight: 'bold', color: '#fff', marginBottom: 4 },
  activeBannerText: { fontSize: 13, color: '#E6F1FB', marginBottom: 2 },
  activeBannerStops: { fontSize: 12, color: '#E6F1FB', marginBottom: 2, fontStyle: 'italic' },
  fareRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  activeBannerFare: { fontSize: 14, color: '#fff', fontWeight: 'bold' },
  originalFare: { fontSize: 11, color: '#E6F1FB', fontWeight: 'normal' },
  activeBannerPayment: { fontSize: 12, color: '#E6F1FB' },
  actionBtn: { backgroundColor: '#fff', paddingVertical: 10, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  actionBtnText: { color: '#185FA5', fontWeight: 'bold', fontSize: 14 },
  breakdownBtn: { backgroundColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderColor: '#FF6B35', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 8 },
  breakdownBtnText: { color: '#FF6B35', fontWeight: '700', fontSize: 14 },
  waitingBadge: { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: 8, borderRadius: 8, alignItems: 'center', marginTop: 4 },
  waitingText: { color: '#E6F1FB', fontSize: 13, fontStyle: 'italic' },
  paymentInstructions: { color: '#fff', fontSize: 13, marginBottom: 8, textAlign: 'center' },
  mapContainer: { flex: 1 },
  map: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 12, fontSize: 14, color: c.subtext },
  bottomPanel: { backgroundColor: c.card, padding: 16, borderTopWidth: 1, borderTopColor: c.border },
  onlineButton: { paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginBottom: 10 },
  onlineActive: { backgroundColor: '#FF3B30' },
  onlineInactive: { backgroundColor: '#1D9E75' },
  onlineButtonText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  actionRow: { flexDirection: 'row', gap: 8 },
  profileButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#EEEDFE' },
  profileButtonText: { color: '#534AB7', fontWeight: '600', fontSize: 12 },
  reportButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#FAEEDA' },
  reportButtonText: { color: '#854F0B', fontWeight: '600', fontSize: 12 },
  walletButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#E1F5EE' },
  walletButtonText: { color: '#085041', fontWeight: '600', fontSize: 12 },
  supportButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#FBEAF0' },
  supportButtonText: { color: '#993556', fontWeight: '600', fontSize: 12 },
  switchButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#E6F1FB' },
  switchButtonText: { color: '#185FA5', fontWeight: '600', fontSize: 12 },
  logoutButton: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', backgroundColor: '#FFE5E5' },
  logoutButtonText: { color: '#FF3B30', fontWeight: '600', fontSize: 12 },
  tricycleMarker: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1D9E75', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 3, elevation: 4 },
  tricycleMarkerOffline: { backgroundColor: '#999' },
  tricycleEmoji: { fontSize: 20 },
  lockBanner: { backgroundColor: '#FF3B30', borderRadius: 8, padding: 10, marginBottom: 8, alignItems: 'center' },
  lockBannerText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  onlineDisabled: { opacity: 0.5 },
  bellBtn: { justifyContent: 'center', alignItems: 'center', position: 'relative', width: 36, height: 36 },
  bellIcon: { fontSize: 22 },
  bellBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: '#FF3B30', borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  bellBadgeText: { color: '#fff', fontSize: 9, fontWeight: 'bold' },
  });
}
