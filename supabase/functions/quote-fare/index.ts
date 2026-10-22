import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_STOPS_DEFAULT = 3;



const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const isValidLat = (v: unknown): v is number => isFiniteNumber(v) && v >= -90 && v <= 90;
const isValidLng = (v: unknown): v is number => isFiniteNumber(v) && v >= -180 && v <= 180;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function errorResponse(code: string, status: number): Response {
  return jsonResponse({ error: code }, status);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // --- Auth: identify rider via anon-key client with Authorization header ---
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return errorResponse('unauthorized', 401);

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) return errorResponse('unauthorized', 401);

    // Service-role client for all reads/writes below.
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // --- Input ---
    const body = await req.json().catch(() => ({}));
    const pickup_lat = body.pickup_lat;
    const pickup_lng = body.pickup_lng;
    const dropoff_lat = body.dropoff_lat;
    const dropoff_lng = body.dropoff_lng;
    const destination: string = typeof body.destination === 'string' ? body.destination.trim() : '';
    const stops_count: number = Number.isInteger(body.stops_count) ? body.stops_count : 0;

    if (!isValidLat(pickup_lat) || !isValidLng(pickup_lng)) {
      return errorResponse('invalid_pickup', 400);
    }
    if (!isValidLat(dropoff_lat) || !isValidLng(dropoff_lng)) {
      return errorResponse('destination_needs_location', 400);
    }
    if (!destination) {
      return errorResponse('destination_required', 400);
    }

    // platform_settings.max_stops lookup (default 3).
    let maxStops = MAX_STOPS_DEFAULT;
    try {
      const { data: platform } = await admin
        .from('platform_settings')
        .select('max_stops')
        .limit(1)
        .maybeSingle();
      if (platform?.max_stops != null) maxStops = platform.max_stops;
    } catch (e) {
      console.error('platform_settings lookup failed', (e as Error)?.message);
    }
    if (!Number.isInteger(stops_count) || stops_count < 0 || stops_count > maxStops) {
      return errorResponse('too_many_stops', 400);
    }

    // --- Zone (bounding box of pickup) ---
    const { data: zones, error: zonesError } = await admin
      .from('zones')
      .select('*')
      .not('boundary_lat_min', 'is', null)
      .not('boundary_lat_max', 'is', null)
      .not('boundary_lng_min', 'is', null)
      .not('boundary_lng_max', 'is', null);
    if (zonesError) {
      console.error('zones query failed', zonesError.message);
      return errorResponse('internal_error', 500);
    }
    let zoneId: string | null = null;
    if (zones && zones.length > 0) {
      for (const z of zones) {
        if (
          pickup_lat >= z.boundary_lat_min &&
          pickup_lat <= z.boundary_lat_max &&
          pickup_lng >= z.boundary_lng_min &&
          pickup_lng <= z.boundary_lng_max
        ) {
          zoneId = z.id;
          break;
        }
      }
    }

    // --- Distance via Google Routes API (the legacy Distance Matrix API is not
    //     enabled for this project). Road distance only, no traffic: cheapest tier. ---
    let distanceKm = 2;
    let distanceEstimated = true;
    const googleKey = Deno.env.get('GOOGLE_MAPS_SERVER_KEY') ?? '';
    if (googleKey) {
      try {
        const r = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': googleKey,
            'X-Goog-FieldMask': 'routes.distanceMeters',
          },
          body: JSON.stringify({
            origin: { location: { latLng: { latitude: pickup_lat, longitude: pickup_lng } } },
            destination: { location: { latLng: { latitude: dropoff_lat, longitude: dropoff_lng } } },
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_UNAWARE',
          }),
        });
        const d = await r.json();
        const meters = d?.routes?.[0]?.distanceMeters;
        if (r.ok && typeof meters === 'number' && meters > 0) {
          distanceKm = meters / 1000;
          distanceEstimated = false;
        } else if (r.ok) {
          // No drivable route found (e.g. a destination cars can't reach).
          console.error('routes_api no_route');
        } else {
          console.error('routes_api error', r.status, d?.error?.status, d?.error?.message);
        }
      } catch (e) {
        console.error('routes_api fetch failed', (e as Error)?.message);
      }
    } else {
      console.error('GOOGLE_MAPS_SERVER_KEY missing');
    }

    // --- Seat fare: one formula in the database (pragya_fare) ---
    //   minimum = seat fare × 4 × (1 + markup %), covering the first minimum_km;
    //   each km beyond = minimum ÷ minimum_km; + stop fee per stop; rounded UP to whole cedis.
    const { data: pf, error: pfError } = await admin.rpc('pragya_fare', {
      p_zone_id: zoneId,
      p_distance_km: distanceKm,
      p_stops: stops_count,
    });
    if (pfError || !pf || typeof pf.fare !== 'number') {
      console.error('pragya_fare failed', pfError?.message);
      return errorResponse('internal_error', 500);
    }
    const fareSource = 'seat_fare';
    const baseFare = Number(pf.seat_fare);          // stored in fare_quotes.base_fare
    const multipliedFare = Number(pf.minimum_fare); // kept for the app's breakdown shape
    const stopsCharge = Number(pf.stops_charge);
    const riderFare = Number(pf.fare);              // whole cedis

    // --- Discount (mirrors lib/discounts.ts) ---
    const nowIso = new Date().toISOString();
    const { data: discounts } = await admin
      .from('discounts')
      .select('*')
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`);

    const { count: rideCount } = await admin
      .from('rides')
      .select('id', { count: 'exact', head: true })
      .eq('rider_id', user.id)
      .eq('status', 'completed');
    const totalRides = rideCount ?? 0;

    let bestDiscount: any = null;
    let bestPercentage = 0;
    if (discounts) {
      for (const discount of discounts) {
        if (discount.max_uses && discount.uses_count >= discount.max_uses) continue;
        let applies = false;
        if (discount.type === 'new_user' && totalRides === 0) {
          applies = true;
        } else if (discount.type === 'destination' && discount.destination_keyword) {
          applies = destination.toLowerCase().includes(discount.destination_keyword.toLowerCase());
        } else if (discount.type === 'loyal_rider' && totalRides >= (discount.min_rides_for_loyalty || 10)) {
          applies = true;
        }
        if (applies && discount.percentage > bestPercentage) {
          bestDiscount = discount;
          bestPercentage = discount.percentage;
        }
      }
    }

    let discountAmount = 0;
    let finalFare = riderFare;
    let discountMessage: string | null = null;
    let discountId: string | null = null;
    if (bestDiscount) {
      // Whole cedis: the rider's price is rounded UP; the discount is whatever is left.
      finalFare = Math.ceil(riderFare * (1 - Number(bestDiscount.percentage) / 100));
      discountAmount = riderFare - finalFare;
      discountId = bestDiscount.id;
      if (bestDiscount.type === 'new_user') {
        discountMessage = `🎁 New rider discount: ${bestDiscount.percentage}% off your first ride!`;
      } else if (bestDiscount.type === 'destination') {
        discountMessage = `📍 ${bestDiscount.name}: ${bestDiscount.percentage}% off`;
      } else if (bestDiscount.type === 'loyal_rider') {
        discountMessage = `⭐ Loyal rider discount: ${bestDiscount.percentage}% off!`;
      }
    }

    const breakdown =
      `Minimum GHS ${pf.minimum_fare} (first ${pf.minimum_km} km)` +
      (Number(pf.extra_km) > 0 ? ` + ${pf.extra_km} km × GHS ${pf.per_km_rate}` : '') +
      (stops_count > 0 ? ` + stops GHS ${stopsCharge}` : '') +
      ` = GHS ${riderFare}`;

    // --- Persist quote (expires_at from column default = now() + 10 min) ---
    const { data: quote, error: insertError } = await admin
      .from('fare_quotes')
      .insert({
        rider_id: user.id,
        zone_id: zoneId,
        pickup_lat,
        pickup_lng,
        dropoff_lat,
        dropoff_lng,
        destination_text: destination,
        stops_count,
        distance_km: Math.round(distanceKm * 100) / 100,
        fare_source: fareSource,
        base_fare: baseFare,
        rider_fare: riderFare,
        discount_id: discountId,
        discount_amount: discountAmount,
        final_fare: finalFare,
      })
      .select('id, expires_at')
      .single();

    if (insertError || !quote) {
      console.error('fare_quotes insert failed', insertError?.message);
      return errorResponse('internal_error', 500);
    }

    return jsonResponse({
      quote_id: quote.id,
      expires_at: quote.expires_at,
      zone_id: zoneId,
      distance_km: Math.round(distanceKm * 100) / 100,
      distance_estimated: distanceEstimated,
      fare_source: fareSource,
      base_fare: baseFare,
      multiplied_fare: multipliedFare,
      stops_charge: stopsCharge,
      rider_fare: riderFare,
      discount_amount: discountAmount,
      discount_message: discountMessage,
      final_fare: finalFare,
      breakdown,
    });
  } catch (err) {
    console.error('quote-fare uncaught', (err as Error)?.message);
    return errorResponse('internal_error', 500);
  }
});