-- =====================================================================
-- PragyaGo: Server-side fares (step 2a of 4)
-- Adds fare quotes + a function that creates a ride from a quote.
-- NOTHING in the current app uses these yet, so it is safe to run now.
-- Also: ride completion now applies the discount rule
--   (commission on the FULL fare; the discount comes out of the driver's share).
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. fare_quotes
--    Written ONLY by the quote-fare Edge Function (service role).
--    A rider can read their own quotes; nobody can write them from the app.
-- ---------------------------------------------------------------------
create table if not exists public.fare_quotes (
  id               uuid primary key default gen_random_uuid(),
  rider_id         uuid not null references auth.users(id) on delete cascade,
  zone_id          uuid references public.zones(id),
  pickup_lat       numeric not null,
  pickup_lng       numeric not null,
  dropoff_lat      numeric not null,
  dropoff_lng      numeric not null,
  destination_text text not null,
  stops_count      integer not null default 0,
  distance_km      numeric not null,
  fare_source      text not null,            -- 'zone_table' | 'distance'
  base_fare        numeric not null,
  rider_fare       numeric not null,         -- full fare (commission is based on this)
  discount_id      uuid references public.discounts(id),
  discount_amount  numeric not null default 0,
  final_fare       numeric not null,         -- what the rider pays
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '10 minutes',
  used_at          timestamptz,
  ride_id          uuid references public.rides(id)
);

create index if not exists fare_quotes_rider_idx on public.fare_quotes (rider_id, created_at desc);

alter table public.fare_quotes enable row level security;

drop policy if exists "riders read own quotes" on public.fare_quotes;
create policy "riders read own quotes"
  on public.fare_quotes for select
  using (rider_id = auth.uid());


-- ---------------------------------------------------------------------
-- 2. create_ride_from_quote
--    The ONLY way the new app will create rides. The price is copied from
--    the quote; the phone never sends a price.
-- ---------------------------------------------------------------------
create or replace function public.create_ride_from_quote(
  p_quote_id        uuid,
  p_pickup_address  text,
  p_dropoff_address text,
  p_stops           jsonb,
  p_payment_method  text
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_quote fare_quotes%rowtype;
  v_ride  rides%rowtype;
begin
  select * into v_quote
  from fare_quotes
  where id = p_quote_id
  for update;

  if not found or v_quote.rider_id is distinct from auth.uid() then
    return json_build_object('success', false, 'error', 'quote_not_found');
  end if;
  if v_quote.used_at is not null then
    return json_build_object('success', false, 'error', 'quote_used');
  end if;
  if v_quote.expires_at < now() then
    return json_build_object('success', false, 'error', 'quote_expired');
  end if;

  -- Discount: re-check it still has uses left, then count the use atomically.
  if v_quote.discount_id is not null then
    update discounts
    set uses_count = coalesce(uses_count, 0) + 1
    where id = v_quote.discount_id
      and is_active
      and (max_uses is null or coalesce(uses_count, 0) < max_uses);
    if not found then
      return json_build_object('success', false, 'error', 'discount_unavailable');
    end if;
  end if;

  insert into rides (
    rider_id, pickup_lat, pickup_lng, pickup_address,
    dropoff_lat, dropoff_lng, dropoff_address,
    stops, current_stop, status,
    fare_ghs, estimated_fare, expected_distance_km,
    payment_method, zone_id,
    discount_id, discount_amount, discounted_fare,
    created_at
  ) values (
    v_quote.rider_id, v_quote.pickup_lat, v_quote.pickup_lng, p_pickup_address,
    v_quote.dropoff_lat, v_quote.dropoff_lng, p_dropoff_address,
    coalesce(p_stops, '[]'::jsonb), 0, 'requested',
    v_quote.rider_fare, v_quote.final_fare, v_quote.distance_km,
    -- payment_method is an enum; json_populate_record converts the text to
    -- whatever the column's type is, so we don't depend on the enum's name.
    (json_populate_record(null::rides, json_build_object('payment_method', p_payment_method))).payment_method,
    v_quote.zone_id,
    v_quote.discount_id,
    case when v_quote.discount_id is null then null else v_quote.discount_amount end,
    case when v_quote.discount_id is null then null else v_quote.final_fare end,
    now()
  )
  returning * into v_ride;

  update fare_quotes set used_at = now(), ride_id = v_ride.id where id = p_quote_id;

  return json_build_object('success', true, 'ride', row_to_json(v_ride));
end;
$function$;

revoke all on function public.create_ride_from_quote(uuid, text, text, jsonb, text) from public, anon;
grant execute on function public.create_ride_from_quote(uuid, text, text, jsonb, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. complete_ride_and_deduct_commission — discount rule
--    Same as before except ONE line: driver earnings now subtract the
--    discount.  Example: fare 20, discount 5, 10% commission
--      commission = 2 (10% of 20), driver earns 20 - 5 - 2 = 13.
-- ---------------------------------------------------------------------
create or replace function complete_ride_and_deduct_commission(
  p_ride_id uuid,
  p_driver_id uuid
)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ride rides%rowtype;
  v_fare numeric;
  v_commission numeric;
  v_earnings numeric;
  v_commission_rate numeric;
begin
  if not exists (select 1 from drivers where id = p_driver_id and profile_id = auth.uid()) then
    return json_build_object('success', false, 'error', 'Not your driver record');
  end if;

  select * into v_ride from rides where id = p_ride_id for update;
  if not found then
    return json_build_object('success', false, 'error', 'Ride not found');
  end if;

  if v_ride.driver_id is distinct from p_driver_id then
    return json_build_object('success', false, 'error', 'Ride does not belong to this driver');
  end if;

  if v_ride.status = 'cancelled' then
    return json_build_object('success', false, 'error', 'Ride was cancelled');
  end if;

  if exists (select 1 from commission_payments where ride_id = p_ride_id) then
    return json_build_object('success', false, 'error', 'Ride already settled');
  end if;

  select commission_rate into v_commission_rate from platform_settings limit 1;
  v_commission_rate := coalesce(v_commission_rate, 15) / 100;

  v_fare := coalesce(v_ride.fare_ghs::numeric, 0);
  v_commission := round(v_fare * v_commission_rate, 2);
  -- CHANGED: the discount comes out of the driver's share, not the commission.
  v_earnings := v_fare - coalesce(v_ride.discount_amount, 0) - v_commission;

  update rides set
    status = 'completed',
    driver_confirmed_payment = true,
    completed_at = coalesce(completed_at, now()),
    final_fare_ghs = v_fare
  where id = p_ride_id;

  update drivers set
    wallet_balance = coalesce(wallet_balance, 0) + v_earnings,
    commission_owed = coalesce(commission_owed, 0) + v_commission
  where id = p_driver_id;

  insert into commission_payments (driver_id, ride_id, amount, status, paid_at, payment_method)
  values (p_driver_id, p_ride_id, v_commission, 'pending', now(), 'auto_deduction');

  insert into driver_wallet_transactions (driver_id, amount, type, description, balance_after)
  select p_driver_id, v_earnings, 'earning',
    'Ride earnings (after ' || round(v_commission_rate * 100) || '% commission)',
    wallet_balance
  from drivers where id = p_driver_id;

  return json_build_object(
    'success', true,
    'fare', v_fare,
    'commission', v_commission,
    'earnings', v_earnings
  );
end;
$$;

revoke all on function complete_ride_and_deduct_commission(uuid, uuid) from public, anon;
grant execute on function complete_ride_and_deduct_commission(uuid, uuid) to authenticated;


-- ---------------------------------------------------------------------
-- 4. Check: should list fare_quotes, create_ride_from_quote,
--    complete_ride_and_deduct_commission
-- ---------------------------------------------------------------------
select to_regclass('public.fare_quotes')::text as created
union all
select proname from pg_proc
where proname in ('create_ride_from_quote', 'complete_ride_and_deduct_commission');