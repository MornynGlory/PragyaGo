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
    Switch,
    Text,
    View,
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';

interface LocationCoords {
  latitude: number;
  longitude: number;
}

export default function DriverHomeScreen() {
  const router = useRouter();
  const [location, setLocation] = useState<LocationCoords | null>(null);
  const [isOnline, setIsOnline] = useState(false);
  const [loading, setLoading] = useState(false);
  const [dailyEarnings, setDailyEarnings] = useState(0);
  const [totalRides, setTotalRides] = useState(0);
  const [rating, setRating] = useState(0);

  useEffect(() => {
    getCurrentLocation();
    fetchDriverStats();
  }, []);

  useEffect(() => {
    if (isOnline) {
      updateDriverStatus(true);
    }
  }, [isOnline]);

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

  const fetchDriverStats = async () => {
    try {
      if (!supabase) return;

      const { data, error } = await supabase
        .from('drivers')
        .select('daily_earnings, total_rides, rating')
        .eq('id', 'temp-driver-id')
        .single();

      if (error) {
        console.log('Stats fetch error:', error);
        setDailyEarnings(245.5);
        setTotalRides(12);
        setRating(4.8);
      } else {
        setDailyEarnings(data?.daily_earnings || 0);
        setTotalRides(data?.total_rides || 0);
        setRating(data?.rating || 0);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
      setDailyEarnings(245.5);
      setTotalRides(12);
      setRating(4.8);
    }
  };

  const updateDriverStatus = async (online: boolean) => {
    try {
      if (!supabase) return;

      const { error } = await supabase
        .from('drivers')
        .update({ online })
        .eq('id', 'temp-driver-id');

      if (error) {
        console.log('Status update error:', error);
        Alert.alert('Notice', online ? 'You are now online' : 'You are now offline');
      } else {
        Alert.alert('Success', online ? 'You are now online' : 'You are now offline');
      }
    } catch (error) {
      Alert.alert('Notice', online ? 'You are now online' : 'You are now offline');
      console.error('Error updating status:', error);
    }
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

  const handleSwitchToRider = () => {
    router.replace('/rider');
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator size="large" color="#34C759" />
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
            pinColor={isOnline ? 'green' : 'gray'}
          />
        </MapView>
      )}

      <ScrollView style={styles.bottomSheet} scrollEnabled={true}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Driver Dashboard</Text>
            <Text style={styles.subtitle}>
              {isOnline ? '🟢 Online' : '⚫ Offline'}
            </Text>
          </View>
          <Pressable onPress={() => router.back()}>
            <Text style={styles.backButton}>← Back</Text>
          </Pressable>
        </View>

        <View style={styles.statusCard}>
          <View style={styles.statusContent}>
            <Text style={styles.statusLabel}>Go Online/Offline</Text>
            <Text style={styles.statusSubtitle}>
              {isOnline ? 'You are available for rides' : 'You are not accepting rides'}
            </Text>
          </View>
          <Switch
            style={styles.toggle}
            value={isOnline}
            onValueChange={setIsOnline}
            trackColor={{ false: '#ccc', true: '#81C784' }}
            thumbColor={isOnline ? '#34C759' : '#fff'}
          />
        </View>

        <View style={styles.statsContainer}>
          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Daily Earnings</Text>
            <Text style={styles.statValue}>${dailyEarnings.toFixed(2)}</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Total Rides</Text>
            <Text style={styles.statValue}>{totalRides}</Text>
          </View>

          <View style={styles.statCard}>
            <Text style={styles.statLabel}>Rating</Text>
            <Text style={styles.statValue}>⭐ {rating.toFixed(1)}</Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Your Location</Text>
          <View style={styles.locationDisplay}>
            <Text style={styles.locationText}>
              {location
                ? `${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
                : 'Getting location...'}
            </Text>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <Pressable style={styles.actionButton}>
            <Text style={styles.actionButtonText}>📞 Support</Text>
          </Pressable>
          <Pressable style={styles.actionButton}>
            <Text style={styles.actionButtonText}>📊 View Earnings</Text>
          </Pressable>
          <Pressable style={styles.actionButton}>
            <Text style={styles.actionButtonText}>⚙️ Settings</Text>
          </Pressable>
          <Pressable style={styles.actionButton} onPress={handleSwitchToRider}>
            <Text style={styles.actionButtonText}>🚗 Switch to Rider Mode</Text>
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
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  backButton: {
    fontSize: 16,
    color: '#34C759',
    fontWeight: '600',
  },
  statusCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  statusContent: {
    flex: 1,
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  statusSubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 4,
  },
  toggle: {
    marginLeft: 12,
  },
  statsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
    gap: 10,
  },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  statLabel: {
    fontSize: 12,
    color: '#999',
    fontWeight: '500',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#34C759',
    marginTop: 6,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  locationDisplay: {
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#34C759',
  },
  locationText: {
    fontSize: 14,
    color: '#34C759',
    fontWeight: '500',
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
