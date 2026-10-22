-- =====================================================================
-- PragyaGo: seat-fare pricing
--   Minimum fare  = seat fare × 4 seats × (1 + markup %)      e.g. 5 × 4 × 1.90 = GH₵ 38
--   The minimum covers the first `minimum_fare_km` (default 3 km).
--   Each km beyond = minimum fare ÷ minimum_fare_km           e.g. 38 ÷ 3 = GH₵ 12.67/km
--   + stop fee per extra stop. Total rounded UP to a whole cedi (no pesewas).
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- 1. Settings
--    Per zone (zone admin): the official fare for one seat.
alter table public.zone_settings
  add column if not exists seat_fare numeric not null default 5;

--    Platform-wide (super admin only — platform_settings is server-write-only).
alter table public.platform_settings
  add column if not exists fare_markup_percent numeric not null default 90,
  add column if not exists minimum_fare_km     numeric not null default 3;

-- 2. The one fare formula. Used by the quote-fare Edge Function now, and by the
--    end-of-trip distance adjustment later, so both always agree.
create or replace function public.pragya_fare(
  p_zone_id     uuid,
  p_distance_km numeric,
  p_stops       integer default 0
)
returns json
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  c_seats      constant integer := 4;          -- one rider books the whole Pragya
  v_seat_fare  numeric;
  v_stop_fee   numeric;
  v_markup     numeric;
  v_min_km     numeric;
  v_min_fare   numeric;
  v_per_km     numeric;
  v_extra_km   numeric;
  v_stops      numeric;
  v_raw        numeric;
begin
  select seat_fare, stop_fee into v_seat_fare, v_stop_fee
  from zone_settings where zone_id = p_zone_id;

  select fare_markup_percent, minimum_fare_km into v_markup, v_min_km
  from platform_settings limit 1;

  v_seat_fare := coalesce(v_seat_fare, 5);
  v_stop_fee  := coalesce(v_stop_fee, 2);
  v_markup    := coalesce(v_markup, 90);
  v_min_km    := case when coalesce(v_min_km, 0) > 0 then v_min_km else 3 end;

  v_min_fare := v_seat_fare * c_seats * (1 + v_markup / 100);
  v_per_km   := v_min_fare / v_min_km;
  v_extra_km := greatest(coalesce(p_distance_km, 0) - v_min_km, 0);
  v_stops    := greatest(coalesce(p_stops, 0), 0) * v_stop_fee;
  v_raw      := v_min_fare + v_extra_km * v_per_km + v_stops;

  return json_build_object(
    'seat_fare',      v_seat_fare,
    'seats',          c_seats,
    'markup_percent', v_markup,
    'minimum_fare',   ceil(v_min_fare),
    'minimum_km',     v_min_km,
    'per_km_rate',    round(v_per_km, 2),
    'distance_km',    round(coalesce(p_distance_km, 0), 2),
    'extra_km',       round(v_extra_km, 2),
    'stops_charge',   round(v_stops, 2),
    'fare',           ceil(v_raw)          -- whole cedis, rounded up
  );
end;
$function$;

revoke all on function public.pragya_fare(uuid, numeric, integer) from public, anon, authenticated;
grant execute on function public.pragya_fare(uuid, numeric, integer) to service_role;

-- 3. Check with Sunyani's settings: expect 38, 38, 64, 102 (no stops).
select d as km,
       (public.pragya_fare((select id from zones where name = 'Sunyani'), d, 0) ->> 'fare') as fare_ghs
from unnest(array[0.5, 3, 5, 8]::numeric[]) as d;