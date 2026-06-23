import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';

export default function LandingScreen() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string | null>(null);

  useEffect(() => {
    checkAuthState();

    // Listen for auth changes
    try {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          if (session?.user?.id) {
            // User is logged in, fetch their role and navigate
            await fetchUserRole(session.user.id);
          } else {
            // User is not logged in
            setUserRole(null);
            setLoading(false);
          }
        }
      );

      return () => {
        try {
          subscription?.unsubscribe();
        } catch (error) {
          console.error('Error unsubscribing:', error);
        }
      };
    } catch (error) {
      console.error('Error setting up auth listener:', error);
      setLoading(false);
    }
  }, []);

  const checkAuthState = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();

      if (session?.user?.id) {
        // User is logged in
        await fetchUserRole(session.user.id);
      } else {
        // User is not logged in
        setUserRole(null);
        setLoading(false);
      }
    } catch (error) {
      console.error('Error checking auth state:', error);
      setUserRole(null);
      setLoading(false);
    }
  };

  const fetchUserRole = async (userId: string) => {
    if (!userId) {
      setUserRole(null);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, suspended, suspension_reason, phone_verified, phone')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching user role:', error);
        setUserRole(null);
        setLoading(false);
      } else if (data?.role) {
        if (data.suspended) {
          const reason = data.suspension_reason ?? 'No reason provided.';
          await supabase.auth.signOut();
          setUserRole(null);
          setLoading(false);
          Alert.alert(
            'Account Suspended',
            `Your account has been suspended. Reason: ${reason}\n\nPlease contact PragyaGo support for assistance.`
          );
          return;
        }
        setUserRole(data.role);
        if (data.role === 'driver') {
          const { data: driver } = await supabase
            .from('drivers')
            .select('verification_status')
            .eq('profile_id', userId)
            .single();
          const status = driver?.verification_status;
          if (status === 'pending') {
            router.replace('/auth/pending' as any);
          } else if (status === 'rejected') {
            router.replace('/auth/rejected' as any);
          } else {
            router.replace('/driver/home' as any);
          }
        } else {
          if (data.phone_verified) {
            router.replace('/rider/home' as any);
          } else {
            router.replace({
              pathname: '/auth/verify-phone',
              params: { phone: data.phone ?? '' },
            } as any);
          }
        }
      } else {
        setUserRole(null);
        setLoading(false);
      }
    } catch (error) {
      console.error('Error fetching role:', error);
      setUserRole(null);
      setLoading(false);
    }
  };

  const handleLoginPress = () => {
    router.push('/auth/login');
  };

  const handleRegisterPress = () => {
    router.push('/auth/register');
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centerContent]}>
        <ActivityIndicator size="large" color="#007AFF" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.welcomeTitle}>Welcome to PragyaGo</Text>
        <Text style={styles.welcomeSubtitle}>Your trusted ride-sharing platform</Text>

        <View style={styles.featureContainer}>
          <Text style={styles.featureItem}>🚗 Quick & Reliable Rides</Text>
          <Text style={styles.featureItem}>💰 Affordable Fares</Text>
          <Text style={styles.featureItem}>🔒 Safe & Secure</Text>
        </View>
      </View>

      <View style={styles.buttonContainer}>
        <Pressable style={styles.loginButton} onPress={handleLoginPress}>
          <Text style={styles.loginButtonText}>Login</Text>
        </Pressable>

        <Pressable style={styles.registerButton} onPress={handleRegisterPress}>
          <Text style={styles.registerButtonText}>Register</Text>
        </Pressable>

        <Text style={styles.termsText}>
          By continuing, you agree to our Terms of Service and Privacy Policy
        </Text>
      </View>
    </View>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: c.background,
      paddingHorizontal: 20,
      paddingVertical: 20,
      justifyContent: 'space-between',
    },
    centerContent: {
      justifyContent: 'center',
      alignItems: 'center',
    },
    content: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      paddingTop: 40,
    },
    welcomeTitle: {
      fontSize: 36,
      fontWeight: 'bold',
      color: c.text,
      textAlign: 'center',
      marginBottom: 12,
    },
    welcomeSubtitle: {
      fontSize: 18,
      color: c.subtext,
      textAlign: 'center',
      marginBottom: 48,
    },
    featureContainer: {
      backgroundColor: c.card,
      borderRadius: 12,
      padding: 24,
      gap: 16,
    },
    featureItem: {
      fontSize: 16,
      color: c.text,
      fontWeight: '500',
      textAlign: 'center',
    },
    buttonContainer: {
      paddingBottom: 20,
    },
    loginButton: {
      width: '100%',
      paddingVertical: 14,
      paddingHorizontal: 20,
      backgroundColor: '#007AFF',
      borderRadius: 8,
      alignItems: 'center',
      marginBottom: 12,
    },
    loginButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: '#fff',
    },
    registerButton: {
      width: '100%',
      paddingVertical: 14,
      paddingHorizontal: 20,
      backgroundColor: c.card,
      borderRadius: 8,
      alignItems: 'center',
      marginBottom: 20,
    },
    registerButtonText: {
      fontSize: 16,
      fontWeight: '600',
      color: c.text,
    },
    termsText: {
      fontSize: 12,
      color: c.subtext,
      textAlign: 'center',
      lineHeight: 18,
    },
  });
}
