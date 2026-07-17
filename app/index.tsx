import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import { useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function LandingScreen() {
  const theme = useTheme();
  const router = useRouter();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuthState();
    try {
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        async (_event, session) => {
          if (session?.user?.id) {
            await fetchUserRole(session.user.id);
          } else {
            setLoading(false);
          }
        }
      );
      return () => { try { subscription?.unsubscribe(); } catch {} };
    } catch {
      setLoading(false);
    }
  }, []);

  const checkAuthState = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user?.id) {
        await fetchUserRole(session.user.id);
      } else {
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  };

  const fetchUserRole = async (userId: string) => {
    if (!userId) { setLoading(false); return; }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, suspended, suspension_reason')
        .eq('id', userId)
        .single();

      if (error || !data?.role) { setLoading(false); return; }

      if (data.suspended) {
        const reason = data.suspension_reason ?? 'No reason provided.';
        await supabase.auth.signOut();
        setLoading(false);
        Alert.alert('Account Suspended', `Your account has been suspended.\n\nReason: ${reason}\n\nPlease contact PragyaGo support.`);
        return;
      }

      if (data.role === 'driver') {
        const { data: driver } = await supabase
          .from('drivers')
          .select('verification_status')
          .eq('profile_id', userId)
          .single();
        const status = driver?.verification_status;
        if (status === 'pending') router.replace('/auth/pending' as any);
        else if (status === 'rejected') router.replace('/auth/rejected' as any);
        else router.replace('/driver/home' as any);
      } else {
        router.replace('/rider/home' as any);
      }
    } catch {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loadingScreen}>
        <View style={styles.glowOrb} />
        <Image source={require('@/assets/images/icon.png')} style={styles.loadingLogo} />
        <ActivityIndicator size="large" color="#1D9E75" style={{ marginTop: 28 }} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      {/* Background decorations */}
      <View style={styles.bgCircleTopRight} />
      <View style={styles.bgCircleBottomLeft} />
      <View style={styles.bgCircleMidRight} />

      {/* Top: logo + brand + pills */}
      <View style={styles.topSection}>
        <View style={styles.logoWrapper}>
          <View style={styles.logoGlow} />
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>
        <Text style={styles.brandName}>PragyaGo</Text>
        <Text style={styles.tagline}>Your Pragya, Anytime. Anywhere.</Text>

        <View style={styles.pillsRow}>
          <View style={styles.pill}>
            <Text style={styles.pillText}>📍 Live Tracking</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>💰 Fair Fares</Text>
          </View>
          <View style={styles.pill}>
            <Text style={styles.pillText}>🪪 Safe Rides</Text>
          </View>
        </View>
      </View>

      {/* Bottom: CTA */}
      <View style={styles.bottomSection}>
        <Pressable
          style={({ pressed }) => [styles.getStartedBtn, pressed && styles.btnPressed]}
          onPress={() => router.push('/auth/register')}
        >
          <Text style={styles.getStartedText}>Get Started</Text>
        </Pressable>

        <View style={styles.signInRow}>
          <Text style={styles.signInPrompt}>Already have an account? </Text>
          <Pressable onPress={() => router.push('/auth/login')}>
            <Text style={styles.signInLink}>Sign In</Text>
          </Pressable>
        </View>

        <Text style={styles.footerText}>Ghana's first tricycle ride-hailing platform</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#0D1F2D',
    paddingHorizontal: 40,
    paddingVertical: 60,
    justifyContent: 'space-between',
  },

  /* Loading */
  loadingScreen: {
    flex: 1,
    backgroundColor: '#0D1F2D',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingLogo: {
    width: 100,
    height: 100,
    borderRadius: 24,
  },
  glowOrb: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: 'rgba(29,158,117,0.08)',
    shadowColor: '#1D9E75',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 60,
  },

  /* Background circles */
  bgCircleTopRight: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(29,158,117,0.06)',
    top: -80,
    right: -80,
  },
  bgCircleBottomLeft: {
    position: 'absolute',
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: 'rgba(24,95,165,0.07)',
    bottom: 60,
    left: -70,
  },
  bgCircleMidRight: {
    position: 'absolute',
    width: 180,
    height: 180,
    borderRadius: 90,
    backgroundColor: 'rgba(29,158,117,0.04)',
    top: '42%',
    right: -50,
  },

  /* Top section */
  topSection: {
    alignItems: 'center',
  },
  logoWrapper: {
    width: 120,
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  logoGlow: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: 'rgba(29,158,117,0.12)',
  },
  logo: {
    width: 120,
    height: 120,
    borderRadius: 28,
    backgroundColor: 'transparent',
  },
  brandName: {
    fontSize: 42,
    fontWeight: '900',
    color: '#FFFFFF',
    letterSpacing: -1,
    marginBottom: 8,
  },
  tagline: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1D9E75',
    marginBottom: 32,
  },
  pillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
  },
  pill: {
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 100,
    backgroundColor: 'rgba(29,158,117,0.15)',
    borderWidth: 1,
    borderColor: 'rgba(29,158,117,0.3)',
  },
  pillText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#4ECCA3',
  },

  /* Bottom section */
  bottomSection: {
    gap: 16,
  },
  getStartedBtn: {
    backgroundColor: '#1D9E75',
    borderRadius: 14,
    paddingVertical: 18,
    alignItems: 'center',
    shadowColor: '#1D9E75',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
  },
  btnPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }],
  },
  getStartedText: {
    fontSize: 17,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  signInRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signInPrompt: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.5)',
  },
  signInLink: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1D9E75',
  },
  footerText: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.3)',
    textAlign: 'center',
  },
});
