import { supabase } from '@/lib/supabase';
import { useTheme } from '@/lib/useTheme';
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

interface ZoneFare {
  id: string;
  zone_id: string;
  to_location: string;
  base_fare: number;
}

interface Zone {
  id: string;
  name: string;
}

function computeFarePreview(baseFare: number) {
  const multiplied = Math.round(baseFare * 4 * 100) / 100;
  const riderFare = Math.round(multiplied * 1.85 * 100) / 100;
  return { multiplied, riderFare };
}

export default function ZoneFaresPage() {
  const { colors } = useTheme();
  const styles = makeStyles(colors);

  const [zones, setZones] = useState<Zone[]>([]);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [fares, setFares] = useState<ZoneFare[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [newLocation, setNewLocation] = useState('');
  const [newBaseFare, setNewBaseFare] = useState('');

  useEffect(() => {
    loadZones();
  }, []);

  useEffect(() => {
    if (selectedZoneId) loadFares(selectedZoneId);
  }, [selectedZoneId]);

  const loadZones = async () => {
    const { data } = await supabase.from('zones').select('id, name').order('name');
    setZones(data ?? []);
    if (data && data.length > 0) setSelectedZoneId(data[0].id);
    setLoading(false);
  };

  const loadFares = async (zoneId: string) => {
    setLoading(true);
    const { data } = await supabase
      .from('zone_fares')
      .select('id, zone_id, to_location, base_fare')
      .eq('zone_id', zoneId)
      .order('to_location');
    setFares(data ?? []);
    setLoading(false);
  };

  const addFare = async () => {
    if (!selectedZoneId) return;
    if (!newLocation.trim()) { Alert.alert('Validation', 'Enter a destination name'); return; }
    const base = parseFloat(newBaseFare);
    if (isNaN(base) || base <= 0) { Alert.alert('Validation', 'Enter a valid base fare'); return; }
    setSaving(true);
    const { error } = await supabase.from('zone_fares').insert([{
      zone_id: selectedZoneId,
      to_location: newLocation.trim(),
      base_fare: base,
    }]);
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    setNewLocation('');
    setNewBaseFare('');
    loadFares(selectedZoneId);
  };

  const deleteFare = async (id: string) => {
    Alert.alert('Delete', 'Remove this fare?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive', onPress: async () => {
          await supabase.from('zone_fares').delete().eq('id', id);
          if (selectedZoneId) loadFares(selectedZoneId);
        }
      }
    ]);
  };

  const previewBase = parseFloat(newBaseFare) || 0;
  const { multiplied: previewMultiplied, riderFare: previewRiderFare } = computeFarePreview(previewBase);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.pageTitle}>Zone Fares</Text>
        <Text style={styles.formulaBox}>Rider pays: Base fare × 4 + 85%</Text>

        {/* Zone selector */}
        <Text style={styles.sectionLabel}>Select Zone</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.zoneRow}>
          {zones.map(z => (
            <TouchableOpacity
              key={z.id}
              style={[styles.zoneChip, selectedZoneId === z.id && styles.zoneChipActive]}
              onPress={() => setSelectedZoneId(z.id)}
            >
              <Text style={[styles.zoneChipText, selectedZoneId === z.id && styles.zoneChipTextActive]}>{z.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Add new fare */}
        <View style={styles.addCard}>
          <Text style={styles.addCardTitle}>Add New Route</Text>
          <TextInput
            style={styles.input}
            placeholder="Destination name"
            placeholderTextColor={colors.subtext}
            value={newLocation}
            onChangeText={setNewLocation}
          />
          <TextInput
            style={styles.input}
            placeholder="Base fare (GHS)"
            placeholderTextColor={colors.subtext}
            value={newBaseFare}
            onChangeText={setNewBaseFare}
            keyboardType="decimal-pad"
          />
          {previewBase > 0 && (
            <View style={styles.preview}>
              <Text style={styles.previewTitle}>Fare Preview</Text>
              <Text style={styles.previewRow}>Base fare: <Text style={styles.previewVal}>GHS {previewBase.toFixed(2)}</Text></Text>
              <Text style={styles.previewRow}>After × 4: <Text style={styles.previewVal}>GHS {previewMultiplied.toFixed(2)}</Text></Text>
              <Text style={styles.previewRow}>After + 85% <Text style={styles.previewHighlight}>(rider pays): GHS {previewRiderFare.toFixed(2)}</Text></Text>
            </View>
          )}
          <TouchableOpacity style={[styles.addBtn, saving && styles.btnDisabled]} onPress={addFare} disabled={saving}>
            {saving ? <ActivityIndicator color="#fff" /> : <Text style={styles.addBtnText}>Add Route</Text>}
          </TouchableOpacity>
        </View>

        {/* Fares table */}
        <Text style={styles.sectionLabel}>Routes ({fares.length})</Text>
        {loading ? (
          <ActivityIndicator color="#1D9E75" style={{ marginTop: 20 }} />
        ) : fares.length === 0 ? (
          <Text style={styles.emptyText}>No fares for this zone yet.</Text>
        ) : (
          <>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHeaderCell, { flex: 2 }]}>Destination</Text>
              <Text style={styles.tableHeaderCell}>Base</Text>
              <Text style={styles.tableHeaderCell}>×4</Text>
              <Text style={styles.tableHeaderCell}>Rider pays</Text>
              <Text style={[styles.tableHeaderCell, { width: 40 }]}></Text>
            </View>
            {fares.map(fare => {
              const { multiplied, riderFare } = computeFarePreview(fare.base_fare);
              return (
                <View key={fare.id} style={styles.tableRow}>
                  <Text style={[styles.tableCell, { flex: 2 }]} numberOfLines={1}>{fare.to_location}</Text>
                  <Text style={styles.tableCell}>{fare.base_fare.toFixed(2)}</Text>
                  <Text style={styles.tableCell}>{multiplied.toFixed(2)}</Text>
                  <Text style={[styles.tableCell, styles.tableCellHighlight]}>{riderFare.toFixed(2)}</Text>
                  <TouchableOpacity style={{ width: 40, alignItems: 'center' }} onPress={() => deleteFare(fare.id)}>
                    <Text style={styles.deleteBtn}>✕</Text>
                  </TouchableOpacity>
                </View>
              );
            })}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function makeStyles(c: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    safeArea: { flex: 1, backgroundColor: c.background },
    container: { padding: 16, paddingBottom: 40 },
    pageTitle: { fontSize: 22, fontWeight: '700', color: c.text, marginBottom: 6 },
    formulaBox: { fontSize: 13, color: '#085041', backgroundColor: '#E1F5EE', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, marginBottom: 16, fontWeight: '600' },
    sectionLabel: { fontSize: 13, fontWeight: '700', color: c.subtext, marginBottom: 8, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
    zoneRow: { marginBottom: 16 },
    zoneChip: { borderWidth: 1.5, borderColor: c.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, marginRight: 8, backgroundColor: c.card },
    zoneChipActive: { borderColor: '#1D9E75', backgroundColor: '#E1F5EE' },
    zoneChipText: { fontSize: 13, color: c.subtext, fontWeight: '600' },
    zoneChipTextActive: { color: '#085041' },
    addCard: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginBottom: 20 },
    addCardTitle: { fontSize: 15, fontWeight: '700', color: c.text, marginBottom: 12 },
    input: { borderWidth: 1, borderColor: c.border, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, color: c.text, backgroundColor: c.inputBg, marginBottom: 10 },
    preview: { backgroundColor: '#E1F5EE', borderRadius: 8, padding: 12, marginBottom: 12 },
    previewTitle: { fontSize: 12, fontWeight: '700', color: '#085041', marginBottom: 6 },
    previewRow: { fontSize: 13, color: '#085041', marginBottom: 3 },
    previewVal: { fontWeight: '600', color: '#085041' },
    previewHighlight: { fontWeight: '700', color: '#1D9E75' },
    addBtn: { backgroundColor: '#1D9E75', paddingVertical: 12, borderRadius: 8, alignItems: 'center' },
    btnDisabled: { opacity: 0.6 },
    addBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
    tableHeader: { flexDirection: 'row', backgroundColor: c.inputBg, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 4 },
    tableHeaderCell: { flex: 1, fontSize: 11, fontWeight: '700', color: c.subtext, textTransform: 'uppercase' },
    tableRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.card, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 10, marginBottom: 6 },
    tableCell: { flex: 1, fontSize: 13, color: c.text },
    tableCellHighlight: { color: '#1D9E75', fontWeight: '700' },
    deleteBtn: { color: '#FF3B30', fontSize: 14, fontWeight: '700' },
    emptyText: { color: c.subtext, fontSize: 14, textAlign: 'center', marginTop: 20 },
  });
}
