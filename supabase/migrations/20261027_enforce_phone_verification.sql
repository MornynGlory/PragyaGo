-- =====================================================================
-- PragyaGo: phone verification is enforced on the SERVER (2026-10-27)
--  1. Nobody can mark their own phone verified, change their role, or lift a
--     suspension from the app. Changing the phone number resets verification.
--     (Edge Functions and server functions are unaffected.)
--  2. Unverified riders can't book; unverified drivers can't accept rides.
--  3. Keeps the existing test accounts usable.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- 1. Guard on profiles
create or replace function public.profiles_guard()
returns trigger
language plpgsql
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.phone_verified := false;
      new.suspended := false;
      new.suspension_reason := null;
    else
      new.role              := old.role;
      new.suspended         := old.suspended;
      new.suspension_reason := old.suspension_reason;
      new.phone_verified    := old.phone_verified;
      if new.phone is distinct from old.phone then
        new.phone_verified := false;   -- a new number must be verified again
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard
  before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- 2. Booking and accepting require a verified phone
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
  -- Only riders with a verified phone may book.
  if not exists (select 1 from profiles where id = auth.uid() and phone_verified) then
    return json_build_object('success', false, 'error', 'phone_not_verified');
  end if;

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

create or replace function public.accept_ride(p_ride_id uuid, p_driver_id uuid, p_profile_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ride rides%rowtype;
begin
  if not exists (
    select 1 from drivers where id = p_driver_id and profile_id = auth.uid()
  ) then
    return json_build_object('success', false, 'error', 'Not authorised');
  end if;

  -- Only drivers with a verified phone may accept rides.
  if not exists (select 1 from profiles where id = auth.uid() and phone_verified) then
    return json_build_object('success', false, 'error', 'phone_not_verified');
  end if;

  if exists (
    select 1 from ride_cancellations
    where ride_id = p_ride_id and driver_id = p_driver_id
  ) then
    return json_build_object('success', false, 'error', 'You cancelled this ride earlier');
  end if;

  select * into v_ride
  from rides
  where id = p_ride_id
    and status = 'requested'
  for update;

  if not found then
    return json_build_object('success', false, 'error', 'Ride is no longer available');
  end if;

  update rides
  set status      = 'accepted',
      driver_id   = p_driver_id,
      accepted_at = now()
  where id = p_ride_id
    and status = 'requested';

  return json_build_object('success', true, 'ride_id', p_ride_id);
end;
$function$;

-- 3. Existing test accounts (rider 0240000000, driver 0241234567) stay usable
update public.profiles set phone_verified = true
where phone in ('0240000000', '0241234567');

-- 4. Check
select phone, role, phone_verified from public.profiles
where phone in ('0240000000', '0241234567');
