import { supabase } from '@/lib/supabase';

export interface FareResult {
  baseFare: number;
  multipliedFare: number;
  riderFare: number;
  expectedDistanceKm: number;
  source: 'zone_table' | 'distance';
  breakdown: string;
}

export interface FinalFareResult {
  finalFare: number;
  difference: number;
  increased: boolean;
}

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';

async function getGoogleDistance(
  pickupLat: number,
  pickupLng: number,
  destLat: number,
  destLng: number
): Promise<number | null> {
  try {
    const url = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${pickupLat},${pickupLng}&destinations=${destLat},${destLng}&key=${GOOGLE_MAPS_API_KEY}&mode=driving`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.status === 'OK' && data.rows?.[0]?.elements?.[0]?.status === 'OK') {
      return data.rows[0].elements[0].distance.value / 1000;
    }
  } catch (e) {
    console.warn('Distance Matrix error:', e);
  }
  return null;
}

export async function calculateZoneFare(
  zoneId: string | null,
  destination: string,
  _stops: number,
  pickupLat: number,
  pickupLng: number,
  destLat?: number,
  destLng?: number
): Promise<FareResult> {
  let fallbackPerKm = 1.5;

  if (zoneId) {
    const { data: settings } = await supabase
      .from('zone_settings')
      .select('fallback_per_km')
      .eq('zone_id', zoneId)
      .single();
    if (settings) {
      fallbackPerKm = settings.fallback_per_km ?? 1.5;
    }
  }

  // STEP 3: Get expected distance from Google Distance Matrix
  let expectedDistanceKm = 2;
  if (destLat !== undefined && destLng !== undefined) {
    const googleDist = await getGoogleDistance(pickupLat, pickupLng, destLat, destLng);
    if (googleDist !== null) expectedDistanceKm = googleDist;
  }

  // STEP 1: Look up base fare from zone_fares table
  if (zoneId && destination.trim()) {
    const { data: fareMatch } = await supabase
      .from('zone_fares')
      .select('base_fare, to_location')
      .eq('zone_id', zoneId)
      .ilike('to_location', `%${destination.trim()}%`)
      .limit(1)
      .single();

    if (fareMatch) {
      const baseFare = Math.round(fareMatch.base_fare * 100) / 100;
      // STEP 2: Calculate rider price: baseFare × 4 × 1.85
      const multipliedFare = Math.round(baseFare * 4 * 100) / 100;
      const riderFare = Math.round(multipliedFare * 1.85 * 100) / 100;
      return {
        baseFare,
        multipliedFare,
        riderFare,
        expectedDistanceKm,
        source: 'zone_table',
        breakdown: `Base GHS ${baseFare} × 4 = GHS ${multipliedFare} + 85% = GHS ${riderFare}`,
      };
    }
  }

  // Fallback: distance-based base fare
  const baseFare = Math.round(expectedDistanceKm * fallbackPerKm * 100) / 100;
  const multipliedFare = Math.round(baseFare * 4 * 100) / 100;
  const riderFare = Math.round(multipliedFare * 1.85 * 100) / 100;
  return {
    baseFare,
    multipliedFare,
    riderFare,
    expectedDistanceKm,
    source: 'distance',
    breakdown: `Base GHS ${baseFare} × 4 = GHS ${multipliedFare} + 85% = GHS ${riderFare}`,
  };
}

export function calculateFinalFare(
  originalFare: number,
  expectedDistanceKm: number,
  actualDistanceKm: number
): FinalFareResult {
  if (expectedDistanceKm <= 0) {
    return { finalFare: originalFare, difference: 0, increased: false };
  }
  const ratio = Math.max(0.5, Math.min(2.0, actualDistanceKm / expectedDistanceKm));
  const finalFare = Math.round(originalFare * ratio * 100) / 100;
  return {
    finalFare,
    difference: Math.round((finalFare - originalFare) * 100) / 100,
    increased: finalFare > originalFare,
  };
}

export async function getFareSuggestions(
  zoneId: string | string[] | null,
  query: string
): Promise<{ to_location: string; base_fare: number; rider_fare: number }[]> {
  if (!zoneId || !query.trim()) return [];
  const ids = Array.isArray(zoneId) ? zoneId : [zoneId];
  if (ids.length === 0) return [];
  const { data } = await supabase
    .from('zone_fares')
    .select('to_location, base_fare')
    .in('zone_id', ids)
    .ilike('to_location', `%${query.trim()}%`)
    .limit(8);
  return (data ?? []).map((row: { to_location: string; base_fare: number }) => ({
    to_location: row.to_location,
    base_fare: row.base_fare,
    rider_fare: Math.round(row.base_fare * 4 * 1.85 * 100) / 100,
  }));
}
