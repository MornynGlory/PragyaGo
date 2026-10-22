import { supabase } from '@/lib/supabase';

export interface FareResult {
  baseFare: number;
  multipliedFare: number;
  riderFare: number;
  expectedDistanceKm: number;
  source: 'zone_table' | 'distance';
  breakdown: string;
}

const FARE_MULTIPLIER = 4;
const FARE_MARKUP = 1.85;

// Escape LIKE wildcards so user input is matched literally
const escapeForLike = (str: string): string =>
  str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

export async function getFareSuggestions(
  zoneId: string | string[] | null,
  query: string
): Promise<{ to_location: string; base_fare: number; rider_fare: number }[]> {
  if (!zoneId || !query.trim()) return [];
  const ids = Array.isArray(zoneId) ? zoneId : [zoneId];
  if (ids.length === 0) return [];
  const safeQuery = escapeForLike(query.trim());
  const { data } = await supabase
    .from('zone_fares')
    .select('to_location, base_fare')
    .in('zone_id', ids)
    .ilike('to_location', `%${safeQuery}%`)
    .limit(8);
  return (data ?? []).map((row: { to_location: string; base_fare: number }) => ({
    to_location: row.to_location,
    base_fare: row.base_fare,
    rider_fare: Math.round(row.base_fare * FARE_MULTIPLIER * FARE_MARKUP * 100) / 100,
  }));
}
