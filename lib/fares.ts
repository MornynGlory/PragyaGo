import { supabase } from '@/lib/supabase';

export interface FareResult {
  baseFare: number;
  platformFee: number;
  stopFee: number;
  totalFare: number;
  source: 'zone_table' | 'distance';
  message: string;
}

export async function calculateZoneFare(
  zoneId: string | null,
  destination: string,
  stops: number,
  distanceKm: number
): Promise<FareResult> {
  let percentage = 15;
  let stopFeePerStop = 5.0;
  let fallbackPerKm = 1.5;

  if (zoneId) {
    const { data: settings } = await supabase
      .from('zone_settings')
      .select('platform_percentage, stop_fee, fallback_per_km')
      .eq('zone_id', zoneId)
      .single();
    if (settings) {
      percentage = settings.platform_percentage ?? 15;
      stopFeePerStop = settings.stop_fee ?? 5.0;
      fallbackPerKm = settings.fallback_per_km ?? 1.5;
    }
  }

  const stopFee = Math.round(stops * stopFeePerStop * 10) / 10;

  if (zoneId && destination.trim()) {
    const { data: fareMatch } = await supabase
      .from('zone_fares')
      .select('base_fare, to_location')
      .eq('zone_id', zoneId)
      .ilike('to_location', `%${destination.trim()}%`)
      .limit(1)
      .single();

    if (fareMatch) {
      const baseFare = Math.round(fareMatch.base_fare * 10) / 10;
      const platformFee = Math.round(baseFare * percentage / 100 * 10) / 10;
      const totalFare = Math.round((baseFare + platformFee + stopFee) * 10) / 10;
      return { baseFare, platformFee, stopFee, totalFare, source: 'zone_table', message: `Fixed fare to ${fareMatch.to_location}` };
    }
  }

  const baseFare = Math.round((3 + distanceKm * fallbackPerKm) * 10) / 10;
  const platformFee = Math.round(baseFare * percentage / 100 * 10) / 10;
  const totalFare = Math.round((baseFare + platformFee + stopFee) * 10) / 10;
  return { baseFare, platformFee, stopFee, totalFare, source: 'distance', message: `Estimated based on ~${distanceKm.toFixed(1)}km distance` };
}

export async function getFareSuggestions(
  zoneId: string | null,
  query: string
): Promise<{ to_location: string; base_fare: number }[]> {
  if (!zoneId || !query.trim()) return [];
  const { data } = await supabase
    .from('zone_fares')
    .select('to_location, base_fare')
    .eq('zone_id', zoneId)
    .ilike('to_location', `%${query.trim()}%`)
    .limit(8);
  return data ?? [];
}
