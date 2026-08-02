// Content below is app-generated boilerplate for development purposes — it has not
// been reviewed by a lawyer. Have counsel review this against Ghana's Data Protection
// Act, 2012 (Act 843) and consumer protection requirements before shipping to production.

import { useTheme } from '@/lib/theme';
import { Feather } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import {
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export const TERMS_ACCEPTED_KEY = 'pendingTermsAcceptance';
export const TERMS_VERSION = '1.0';

export default function TermsScreen() {
  const theme = useTheme();
  const styles = makeStyles(theme);
  const router = useRouter();

  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
    const isBottom = layoutMeasurement.height + contentOffset.y >= contentSize.height - 20;
    if (isBottom) setHasScrolledToBottom(true);

    const scrollable = contentSize.height - layoutMeasurement.height;
    const progress = scrollable > 0 ? Math.min(1, Math.max(0, contentOffset.y / scrollable)) : 1;
    setScrollProgress(progress);
  };

  const handleDecline = () => {
    router.replace('/');
  };

  const handleAccept = async () => {
    if (!hasScrolledToBottom) return;
    // The signing-up user doesn't have a profiles row (or an auth session) yet at this
    // point — that only exists after register.tsx's supabase.auth.signUp() succeeds.
    // Stash acceptance here; register.tsx checks this flag before allowing submission,
    // then writes it to the newly-created profile and clears the flag.
    await AsyncStorage.setItem(TERMS_ACCEPTED_KEY, JSON.stringify({
      accepted: true,
      version: TERMS_VERSION,
      acceptedAt: new Date().toISOString(),
    }));
    router.push('/auth/register' as any);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Terms &amp; Privacy</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.round(scrollProgress * 100)}%` }]} />
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={handleScroll}
        scrollEventThrottle={32}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.docTitle}>PragyaGo Terms of Service</Text>
        <Text style={styles.docMeta}>Version {TERMS_VERSION} · Last updated {new Date().toLocaleDateString()}</Text>

        <Text style={styles.h2}>1. Acceptance of Terms</Text>
        <Text style={styles.p}>
          By creating a PragyaGo account, you agree to be bound by these Terms of Service and our
          Privacy Policy below. If you do not agree, do not create an account or use the app.
        </Text>

        <Text style={styles.h2}>2. The Service</Text>
        <Text style={styles.p}>
          PragyaGo connects riders with independent tricycle ("Pragya") drivers for on-demand
          transportation within supported zones in Ghana. PragyaGo is a technology platform — rides
          are provided by independent drivers, not by PragyaGo directly.
        </Text>

        <Text style={styles.h2}>3. Accounts</Text>
        <Text style={styles.p}>
          You must provide accurate registration information and keep your login credentials
          confidential. Drivers must additionally provide a valid Ghana Card ID, vehicle plate
          number, and pass vehicle document verification before accepting rides.
        </Text>

        <Text style={styles.h2}>4. Fares &amp; Payments</Text>
        <Text style={styles.p}>
          Fares are calculated per zone and shown as an estimate before you request a ride; the
          final fare may adjust based on actual distance travelled. Payment is made by cash directly
          to the driver, or by Go Cash (PragyaGo's in-app wallet). PragyaGo retains a commission on
          completed rides, which drivers are responsible for settling.
        </Text>

        <Text style={styles.h2}>5. Cancellations</Text>
        <Text style={styles.p}>
          Riders and drivers may cancel a ride before it starts. Repeated cancellations or no-shows
          may affect your ability to use the platform.
        </Text>

        <Text style={styles.h2}>6. Driver Conduct &amp; Verification</Text>
        <Text style={styles.p}>
          Drivers must maintain valid vehicle documentation (license, insurance, roadworthy
          certificate) and keep their vehicle in safe operating condition. PragyaGo may suspend
          drivers who fail verification, accumulate unresolved safety reports, or leave commission
          unpaid.
        </Text>

        <Text style={styles.h2}>7. Account Deletion</Text>
        <Text style={styles.p}>
          You can delete your account at any time from within the app, under{' '}
          <Text style={styles.bold}>Settings → Privacy → Delete Account</Text>. Deletion requires
          confirming your password. Details:
        </Text>
        <View style={styles.bulletList}>
          <Text style={styles.bullet}>• A 30-day grace period applies — logging back in during this window cancels the deletion and restores your account.</Text>
          <Text style={styles.bullet}>• Go Cash balances of GH₵15.00 or more are refunded to your Mobile Money number within 3–5 business days.</Text>
          <Text style={styles.bullet}>• Go Cash balances below GH₵15.00 are forfeited on deletion.</Text>
          <Text style={styles.bullet}>• Payment records are retained for 7 years as required by the Ghana Revenue Authority.</Text>
          <Text style={styles.bullet}>• Ride records are anonymized (stripped of identifying rider/driver info) and retained for 2 years for safety and fraud-prevention purposes.</Text>
          <Text style={styles.bullet}>• Drivers with unpaid commission owed cannot delete their account until it is settled.</Text>
          <Text style={styles.bullet}>• Accounts with an active or in-progress ride cannot be deleted until the ride is completed or cancelled.</Text>
        </View>

        <Text style={styles.h2}>8. Liability</Text>
        <Text style={styles.p}>
          PragyaGo is not liable for the acts or omissions of independent drivers. Use the platform
          at your own risk and follow all applicable road safety laws.
        </Text>

        <Text style={styles.h2}>9. Changes to These Terms</Text>
        <Text style={styles.p}>
          We may update these Terms from time to time. Continued use of the app after changes take
          effect constitutes acceptance of the revised Terms.
        </Text>

        <View style={styles.sectionDivider} />

        <Text style={styles.docTitle}>PragyaGo Privacy Policy</Text>
        <Text style={styles.docMeta}>Version {TERMS_VERSION} · Last updated {new Date().toLocaleDateString()}</Text>

        <Text style={styles.h2}>1. Information We Collect</Text>
        <Text style={styles.p}>
          Name, phone number, email, and (for drivers) Ghana Card ID and vehicle details; live
          location while using the app to match riders with nearby drivers and track active rides;
          ride history, fares, and payment records; and device push-notification tokens.
        </Text>

        <Text style={styles.h2}>2. How We Use Your Information</Text>
        <Text style={styles.p}>
          To connect riders with drivers, calculate fares, process Go Cash payments, send ride and
          account notifications, verify driver documents, and improve the safety and reliability of
          the service.
        </Text>

        <Text style={styles.h2}>3. Data Sharing</Text>
        <Text style={styles.p}>
          Your name, phone number, and live location are shared with the other party of an active
          ride (rider ↔ driver) only for the duration of that ride. We do not sell your personal
          information to third parties.
        </Text>

        <Text style={styles.h2}>4. Data Retention</Text>
        <View style={styles.bulletList}>
          <Text style={styles.bullet}>• Payment records: retained 7 years (Ghana Revenue Authority requirement).</Text>
          <Text style={styles.bullet}>• Ride records: anonymized and retained 2 years after account deletion.</Text>
          <Text style={styles.bullet}>• Profile and personal information: deleted after the 30-day grace period following a deletion request.</Text>
        </View>

        <Text style={styles.h2}>5. Your Rights</Text>
        <Text style={styles.p}>
          You may access, correct, or request deletion of your personal information at any time. To
          delete your account, go to Settings → Privacy → Delete Account within the app.
        </Text>

        <Text style={styles.h2}>6. Contact</Text>
        <Text style={styles.p}>
          Questions about this policy can be sent to support@pragyago.com.
        </Text>

        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={styles.footer}>
        {!hasScrolledToBottom && (
          <Text style={styles.scrollHint}>Scroll to the bottom to continue</Text>
        )}
        <View style={styles.buttonRow}>
          <TouchableOpacity style={styles.declineBtn} onPress={handleDecline}>
            <Text style={styles.declineBtnText}>Decline</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.acceptBtn, !hasScrolledToBottom && styles.acceptBtnDisabled]}
            onPress={handleAccept}
            disabled={!hasScrolledToBottom}
          >
            <Feather name="check" size={16} color="#fff" />
            <Text style={styles.acceptBtnText}>Accept &amp; Continue</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    header: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
    headerTitle: { fontSize: 20, fontWeight: '700', color: c.text, marginBottom: 10 },
    progressTrack: { height: 4, borderRadius: 2, backgroundColor: c.background2, overflow: 'hidden' },
    progressFill: { height: 4, borderRadius: 2, backgroundColor: c.green },
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 20, paddingTop: 20 },
    docTitle: { fontSize: 18, fontWeight: '800', color: c.text, marginBottom: 4 },
    docMeta: { fontSize: 12, color: c.textMuted, marginBottom: 16 },
    h2: { fontSize: 14, fontWeight: '700', color: c.text, marginTop: 16, marginBottom: 6 },
    p: { fontSize: 13, color: c.textSecondary, lineHeight: 21 },
    bold: { fontWeight: '700', color: c.text },
    bulletList: { marginTop: 4 },
    bullet: { fontSize: 13, color: c.textSecondary, lineHeight: 21, marginBottom: 4 },
    sectionDivider: { height: 1, backgroundColor: c.border, marginVertical: 28 },
    footer: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 16, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border, backgroundColor: c.card },
    scrollHint: { fontSize: 12, color: c.textMuted, textAlign: 'center', marginBottom: 10 },
    buttonRow: { flexDirection: 'row', gap: 12 },
    declineBtn: { flex: 1, paddingVertical: 15, borderRadius: 12, alignItems: 'center', backgroundColor: c.background2 },
    declineBtnText: { fontSize: 15, fontWeight: '600', color: c.textSecondary },
    acceptBtn: { flex: 2, flexDirection: 'row', gap: 8, paddingVertical: 15, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: c.green },
    acceptBtnDisabled: { opacity: 0.4 },
    acceptBtnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
  });
}
