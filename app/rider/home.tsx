import { supabase } from '@/lib/supabase';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Pressable,
    ScrollView,
    StyleSheet,
    Text,
    TextInput,
    View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';

interface LocationCoords {
  latitude: number;
  longitude: number;
}

export default function RiderHomeScreen() {
  const router = useRouter();
  const [location, setLocation] = useState<LocationCoords | null>(null);
  const [destination, setDestination] = useState('');
  const [fareEstimate, setFareEstimate] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'momo' | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestingRide, setRequestingRide] = useState(false);

  useEffect(() => {
    getCurrentLocation();
  }, []);

  const getCurrentLocation = async () => {
    try {
      setLoading(true);
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'We need location permission to show the map');
        return;
      }

      const currentLocation = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      setLocation({
        latitude: currentLocation.coords.latitude,
        longitude: currentLocation.coords.longitude,
      });
    } catch (error) {
      console.error('Error getting location:', error);
      Alert.alert('Error', 'Failed to get your location');
    } finally {
      setLoading(false);
    }
  };

  const calculateFareEstimate = () => {
    if (!destination.trim()) {
      Alert.alert('Validation', 'Please enter a destination');
      return;
    }
    const baseFare = 5;
    const estimatedFare = baseFare + Math.random() * 15;
    setFareEstimate(Math.round(estimatedFare * 100) / 100);
  };

  const handleRequestRide = async () => {
    if (!destination.trim()) {
      Alert.alert('Validation', 'Please enter a destination');
      return;
    }

    if (!paymentMethod) {
      Alert.alert('Validation', 'Please select a payment method');
      return;
    }

    if (!location) {
      Alert.alert('Error', 'Location not available');
      return;
    }

    setRequestingRide(true);
    try {
      if (!supabase) return;

      const { data, error } = await supabase
        .from('rides')
        .insert([
          {
            rider_id: 'temp-rider-id',
            pickup_lat: location.latitude,
            pickup_lng: location.longitude,
            destination: destination,
            status: 'requested',
            payment_method: paymentMethod,
            estimated_fare: fareEstimate,
            created_at: new Date().toISOString(),
          },
        ])
        .select();

      if (error) {
        Alert.alert('Error', 'Failed to request ride: ' + error.message);
      } else {
        Alert.alert(
          'Ride Requested',
          `Your Pragya ride has been requested! Estimated fare: $${fareEstimate}`
        );
      }

      setDestination('');
      setPaymentMethod(null);
      setFareEstimate(0);
    } catch (error) {
      Alert.alert('Error', 'An unexpected error occurred');
      console.error(error);
    } finally {
      setRequestingRide(false);
    }
  };

  const handleSwitchToDriver = () => {
    router.replace('/driver');
  };

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        Alert.alert('Error', 'Failed to logout: ' + error.message);
      } else {
        router.replace('/');
      }
    } catch (error) {
      console.error('Logout error:', error);
      Alert.alert('Error', 'An unexpected error occurred during logout');
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {location && (
        <MapView
          style={styles.map}
          initialRegion={{
            latitude: location.latitude,
            longitude: location.longitude,
            latitudeDelta: 0.05,
            longitudeDelta: 0.05,
          }}
        >
          <Marker
            coordinate={location}
            title="Your Location"
            pinColor="blue"
          />
        </MapView>
      )}

      <ScrollView style={styles.bottomSheet} scrollEnabled={true}>
        <View style={styles.header}>
          <Text style={styles.title}>Request a Pragya</Text>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backButton}>← Back</Text>
          </Pressable>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Pickup Location</Text>
          <View style={styles.locationDisplay}>
            <Text style={styles.locationText}>
              {location
                ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
                : 'Getting location...'}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.label}>Destination</Text>
          <TextInput
            style={styles.input}
            placeholder="Enter destination"
            value={destination}
            onChangeText={setDestination}
            placeholderTextColor="#999"
          />
        </View>

        {destination.trim() && (
          <Pressable
            style={styles.estimateButton}
            onPress={calculateFareEstimate}
          >
            <Text style={styles.estimateButtonText}>Get Fare Estimate</Text>
          </Pressable>
        )}

        {fareEstimate > 0 && (
          <View style={styles.fareCard}>
            <Text style={styles.fareLabel}>Estimated Fare</Text>
            <Text style={styles.fareAmount}>${fareEstimate.toFixed(2)}</Text>
          </View>
        )}

        <View style={styles.section}>
          <Text style={styles.label}>Payment Method</Text>
          <View style={styles.paymentOptions}>
            <Pressable
              style={[
                styles.paymentButton,
                paymentMethod === 'cash' && styles.paymentButtonActive,
              ]}
              onPress={() => setPaymentMethod('cash')}
            >
              <Text
                style={[
                  styles.paymentButtonText,
                  paymentMethod === 'cash' && styles.paymentButtonTextActive,
                ]}
              >
                💵 Pay Cash
              </Text>
            </Pressable>

            <Pressable
              style={[
                styles.paymentButton,
                paymentMethod === 'momo' && styles.paymentButtonActive,
              ]}
              onPress={() => setPaymentMethod('momo')}
            >
              <Text
                style={[
                  styles.paymentButtonText,
                  paymentMethod === 'momo' && styles.paymentButtonTextActive,
                ]}
              >
                📱 Pay MoMo
              </Text>
            </Pressable>
          </View>
        </View>

        <Pressable
          style={[
            styles.requestButton,
            (requestingRide || !destination) && styles.requestButtonDisabled,
          ]}
          onPress={handleRequestRide}
          disabled={requestingRide || !destination}
        >
          {requestingRide ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.requestButtonText}>Request Pragya</Text>
          )}
        </Pressable>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <Pressable style={styles.actionButton} onPress={handleSwitchToDriver}>
            <Text style={styles.actionButtonText}>🚗 Switch to Driver Mode</Text>
          </Pressable>
          <Pressable style={[styles.actionButton, styles.logoutButton]} onPress={handleLogout}>
            <Text style={[styles.actionButtonText, styles.logoutButtonText]}>🚪 Logout</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    width: '100%',
    height: '40%',
  },
  bottomSheet: {
    flex: 1,
    backgroundColor: '#f9f9f9',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  backButton: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  section: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    backgroundColor: '#fff',
    color: '#333',
  },
  locationDisplay: {
    backgroundColor: '#E8F0FE',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#007AFF',
  },
  locationText: {
    fontSize: 14,
    color: '#007AFF',
    fontWeight: '500',
  },
  estimateButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 16,
  },
  estimateButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  fareCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    borderLeftWidth: 4,
    borderLeftColor: '#34C759',
  },
  fareLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '500',
  },
  fareAmount: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#34C759',
    marginTop: 4,
  },
  paymentOptions: {
    flexDirection: 'row',
    gap: 12,
  },
  paymentButton: {
    flex: 1,
    borderWidth: 2,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  paymentButtonActive: {
    borderColor: '#007AFF',
    backgroundColor: '#E8F0FE',
  },
  paymentButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  paymentButtonTextActive: {
    color: '#007AFF',
  },
  requestButton: {
    backgroundColor: '#FF6B6B',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginVertical: 20,
    marginBottom: 40,
  },
  requestButtonDisabled: {
    backgroundColor: '#ccc',
    opacity: 0.6,
  },
  requestButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  actionButton: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  logoutButton: {
    backgroundColor: '#FFE8E8',
    borderColor: '#FF6B6B',
  },
  logoutButtonText: {
    color: '#FF6B6B',
  },
});
