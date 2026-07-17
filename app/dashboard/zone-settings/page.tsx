import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/theme';
import React, { useEffect, useState } from 'react';
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
import { SafeAreaView } from 'react-native-safe-area-context';

interface ZoneSettings {
  id: string;
  zone_id: string;
  zone_name?: string;
  stop_fee: number;
  fallback_per_km: number;
}

interface Zone {
  id: string;
  name: string;
}

export default function ZoneSettingsPage() {
  const theme = useTheme();
  const styles = makeStyles(theme);

  const [zones, setZones] = useState<Zone[]>([]);
  const [settings, setSettings] = useState<ZoneSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, { stop_fee: string; fallback_per_km: string }>>({});

  useEffect(() => {
    loadAll();
  }, []);

  const loadAll = async () => {
    setLoading(true);
    const [{ data: zonesData }, { data: settingsData }] = await Promise.all([
      supabase.from('zones').select('id, name').order('name'),
      supabase.from('zone_settings').select('id, zone_id, stop_fee, fallback_per_km'),
    ]);
    setZones(zonesData ?? []);
    setSettings(settingsData ?? []);
    const initial: Record<string, { stop_fee: string; fallback_per_km: string }> = {};
    for (const s of settingsData ?? []) {
      initial[s.zone_id] = {
        stop_fee: String(s.stop_fee ?? ''),
        fallback_per_km: String(s.fallback_per_km ?? ''),
      };
    }
    setEdits(initial);
    setLoading(false);
  };

  const getSettingForZone = (zoneId: string) =>
    settings.find(s => s.zone_id === zoneId);

  const updateEdit = (zoneId: string, field: 'stop_fee' | 'fallback_per_km', value: string) => {
    setEdits(prev => ({ ...prev, [zoneId]: { ...prev[zoneId], [field]: value } }));
  };

  const saveZone = async (zoneId: string) => {
    const edit = edits[zoneId];
    if (!edit) return;
    const stopFee = parseFloat(edit.stop_fee);
    const fallback = parseFloat(edit.fallback_per_km);
    if (isNaN(stopFee) || stopFee < 0) { Alert.alert('Validation', 'Enter a valid stop fee'); return; }
    if (isNaN(fallback) || fallback <= 0) { Alert.alert('Validation', 'Enter a valid fallback rate'); return; }
    setSaving(zoneId);
    const existing = getSettingForZone(zoneId);
    if (existing) {
      const { error } = await supabase
        .from('zone_settings')
        .update({ stop_fee: stopFee, fallback_per_km: fallback })
        .eq('zone_id', zoneId);
      if (error) Alert.alert('Error', error.message);
    } else {
      const { error } = await supabase
        .from('zone_settings')
        .insert([{ zone_id: zoneId, stop_fee: stopFee, fallback_per_km: fallback }]);
      if (error) Alert.alert('Error', error.message);
    }
    setSaving(null);
    loadAll();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.pageTitle}>Zone Settings</Text>

        {/* Formula info */}
        <View style={styles.formulaCard}>
          <Text style={styles.formulaTitle}>Fare Formula</Text>
          <Text style={styles.formulaLine}>Rider pays: Base fare × 4 + 85%</Text>
          <Text style={styles.formulaExample}>Example: GHS 5 base → GHS 20 × 1.85 = GHS 37.00</Text>
          <Text style={styles.formulaNote}>
            The base fare is set per route in Zone Fares. The formula applies automatically — no platform percentage field needed.
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator color="#1D9E75" style={{ marginTop: 30 }} />
        ) : (
          zones.map(zone => {
            const edit = edits[zone.id] ?? { stop_fee: '', fallback_per_km: '' };
            const isSaving = saving === zone.id;
            return (
              <View key={zone.id} style={styles.zoneCard}>
                <Text style={styles.zoneName}>{zone.name}</Text>

                <Text style={styles.fieldLabel}>Stop Fee (GHS per stop)</Text>
                <TextInput
                  style={styles.input}
                  value={edit.stop_fee}
                  onChangeText={v => updateEdit(zone.id, 'stop_fee', v)}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 2.00"
                  placeholderTextColor={theme.placeholder}
                />

                <Text style={styles.fieldLabel}>Fallback Rate (GHS/km, when no zone fare matched)</Text>
                <TextInput
                  style={styles.input}
                  value={edit.fallback_per_km}
                  onChangeText={v => updateEdit(zone.id, 'fallback_per_km', v)}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 1.50"
                  placeholderTextColor={theme.placeholder}
                />

                <TouchableOpacity
                  style={[styles.saveBtn, isSaving && styles.btnDisabled]}
                  onPress={() => saveZone(zone.id)}
                  disabled={isSaving}
                >
                  {isSaving
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={styles.saveBtnText}>Save {zone.name}</Text>}
                </TouchableOpacity>
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 40 },
    pageTitle: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 16 },
    formulaCard: { backgroundColor: '#E1F5EE', borderRadius: 12, padding: 16, marginBottom: 20 },
    formulaTitle: { fontSize: 14, fontWeight: '700', color: '#085041', marginBottom: 6 },
    formulaLine: { fontSize: 15, fontWeight: '700', color: '#1D9E75', marginBottom: 4 },
    formulaExample: { fontSize: 13, color: '#085041', marginBottom: 6 },
    formulaNote: { fontSize: 12, color: '#4A7C6A', lineHeight: 18 },
    zoneCard: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 14 },
    zoneName: { fontSize: 16, fontWeight: '700', color: c.text, marginBottom: 12 },
    fieldLabel: { fontSize: 12, fontWeight: '600', color: c.textSecondary, marginBottom: 6 },
    input: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: c.text, backgroundColor: c.input, marginBottom: 12 },
    saveBtn: { backgroundColor: '#1D9E75', paddingVertical: 12, borderRadius: 8, alignItems: 'center', marginTop: 4 },
    btnDisabled: { opacity: 0.6 },
    saveBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  });
}
