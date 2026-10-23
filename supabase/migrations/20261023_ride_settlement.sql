-- =====================================================================
-- PragyaGo: ride settlement fix (2026-10-23)
--   * Cash & MoMo rides: driver keeps the money; commission is added to
--     commission_owed and collected at midnight (auto_collect_commission).
--   * Go Cash rides: rider's Go Cash → driver's go_cash_earnings (withdrawable);
--     commission is taken immediately from that credit.
--   * Every ride stores its own sales record (fare, discount, rider paid,
--     commission, driver earnings) for drivers and vehicle owners.
--   * process_go_cash_payment: rider, amount and ride now come from the server.
--   * settle_stuck_rides works (rides.updated_at + no login needed).
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- 1. Rides: updated_at (kept current automatically) + the per-ride sales record
alter table public.rides
  add column if not exists updated_at          timestamptz,
  add column if not exists rider_paid_ghs      numeric,
  add column if not exists commission_ghs      numeric,
  add column if not exists driver_earnings_ghs numeric,
  add column if not exists go_cash_paid_at     timestamptz;

-- Existing rides: best known "last changed" time (runs before the trigger exists).
drop trigger if exists rides_touch_updated_at on public.rides;
update public.rides
set updated_at = coalesce(completed_at, started_at, accepted_at, created_at, now())
where updated_at is null;

alter table public.rides alter column updated_at set default now();
alter table public.rides alter column updated_at set not null;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger rides_touch_updated_at
  before update on public.rides
  for each row execute function public.touch_updated_at();

-- 2. Wallet history may record Go Cash earnings (the app already shows 'earning' as +)
alter table public.driver_wallet_transactions
  drop constraint if exists driver_wallet_transactions_type_check;
alter table public.driver_wallet_transactions
  add constraint driver_wallet_transactions_type_check
  check (type = any (array['topup', 'commission_deduction', 'refund', 'earning']));

-- 3. The settlement itself. No login check here: only called by the two
--    functions below (driver button, stuck-ride job), never by the app directly.
create or replace function public.settle_ride(p_ride_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ride        rides%rowtype;
  v_rate        numeric;
  v_fare        numeric;
  v_discount    numeric;
  v_paid        numeric;
  v_commission  numeric;
  v_earnings    numeric;
  v_balance     numeric;
begin
  select * into v_ride from rides where id = p_ride_id for update;
  if not found then
    return json_build_object('success', false, 'error', 'Ride not found');
  end if;
  if v_ride.status = 'cancelled' then
    return json_build_object('success', false, 'error', 'Ride was cancelled');
  end if;
  if v_ride.driver_id is null then
    return json_build_object('success', false, 'error', 'Ride has no driver');
  end if;
  if exists (select 1 from commission_payments where ride_id = p_ride_id) then
    return json_build_object('success', false, 'error', 'Ride already settled');
  end if;
  if v_ride.payment_method::text = 'go_cash' and v_ride.go_cash_paid_at is null then
    return json_build_object('success', false, 'error', 'Go Cash payment not received yet');
  end if;

  select commission_rate into v_rate from platform_settings limit 1;
  v_rate := coalesce(v_rate, 15) / 100;

  v_fare       := coalesce(v_ride.fare_ghs, 0);
  v_discount   := coalesce(v_ride.discount_amount, 0);
  v_paid       := v_fare - v_discount;                 -- what the rider actually paid
  v_commission := round(v_fare * v_rate, 2);           -- commission on the FULL fare
  v_earnings   := v_paid - v_commission;               -- the discount comes out of the driver's share

  if v_ride.payment_method::text = 'go_cash' then
    -- Rider's Go Cash goes to the driver's withdrawable Go Cash earnings...
    update drivers set go_cash_earnings = coalesce(go_cash_earnings, 0) + v_paid
    where id = v_ride.driver_id
    returning go_cash_earnings into v_balance;

    insert into driver_wallet_transactions (driver_id, amount, type, description, balance_after)
    values (v_ride.driver_id, v_paid, 'earning', 'Go Cash fare', v_balance);

    -- ...and commission is taken straight away, so it can't be withdrawn first.
    update drivers set go_cash_earnings = go_cash_earnings - v_commission
    where id = v_ride.driver_id
    returning go_cash_earnings into v_balance;

    insert into driver_wallet_transactions (driver_id, amount, type, description, balance_after)
    values (v_ride.driver_id, v_commission, 'commission_deduction',
            'Commission (' || round(v_rate * 100) || '%) on Go Cash ride', v_balance);

    insert into commission_payments (driver_id, ride_id, amount, status, paid_at, payment_method)
    values (v_ride.driver_id, p_ride_id, v_commission, 'paid', now(), 'go_cash_auto');
  else
    -- Cash / MoMo: the driver already has the money. Commission is owed and
    -- collected at midnight by auto_collect_commission().
    update drivers set commission_owed = coalesce(commission_owed, 0) + v_commission
    where id = v_ride.driver_id;

    insert into commission_payments (driver_id, ride_id, amount, status, paid_at, payment_method)
    values (v_ride.driver_id, p_ride_id, v_commission, 'pending', now(), 'auto_deduction');
  end if;

  update rides set
    status                   = 'completed',
    driver_confirmed_payment = true,
    completed_at             = coalesce(completed_at, now()),
    final_fare_ghs           = v_fare,
    rider_paid_ghs           = v_paid,
    commission_ghs           = v_commission,
    driver_earnings_ghs      = v_earnings
  where id = p_ride_id;

  return json_build_object(
    'success',    true,
    'fare',       v_fare,
    'rider_paid', v_paid,
    'commission', v_commission,
    'earnings',   v_earnings
  );
end;
$function$;

revoke all on function public.settle_ride(uuid) from public, anon, authenticated;

-- 4. The driver's "Confirm payment received" button (same name and inputs as before)
create or replace function public.complete_ride_and_deduct_commission(p_ride_id uuid, p_driver_id uuid)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from drivers where id = p_driver_id and profile_id = auth.uid()) then
    return json_build_object('success', false, 'error', 'Not your driver record');
  end if;
  if not exists (select 1 from rides where id = p_ride_id and driver_id = p_driver_id) then
    return json_build_object('success', false, 'error', 'Ride does not belong to this driver');
  end if;
  return settle_ride(p_ride_id);
end;
$function$;

revoke all on function public.complete_ride_and_deduct_commission(uuid, uuid) from public, anon;
grant execute on function public.complete_ride_and_deduct_commission(uuid, uuid) to authenticated;

-- 5. Rider pays with Go Cash (same name and inputs, so the app needs no change).
--    The rider, the amount and the ride now come from the server, not the phone.
create or replace function public.process_go_cash_payment(
  p_ride_id uuid, p_rider_id uuid, p_driver_id uuid, p_amount numeric
)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_ride    rides%rowtype;
  v_amount  numeric;
  v_balance numeric;
begin
  select * into v_ride from rides where id = p_ride_id for update;
  if not found or v_ride.rider_id is distinct from auth.uid() then
    return json_build_object('success', false, 'error', 'Ride not found');
  end if;
  if v_ride.payment_method::text <> 'go_cash' then
    return json_build_object('success', false, 'error', 'This ride is not paid with Go Cash');
  end if;
  if v_ride.go_cash_paid_at is not null then
    return json_build_object('success', true, 'already_paid', true);   -- double tap is safe
  end if;
  if v_ride.status not in ('arrived_destination', 'payment_pending') then
    return json_build_object('success', false, 'error', 'Ride is not ready for payment');
  end if;

  v_amount := coalesce(v_ride.fare_ghs, 0) - coalesce(v_ride.discount_amount, 0);

  select go_cash_balance into v_balance from profiles where id = v_ride.rider_id for update;
  if coalesce(v_balance, 0) < v_amount then
    return json_build_object('success', false, 'error', 'Insufficient Go Cash balance');
  end if;

  update profiles set go_cash_balance = go_cash_balance - v_amount where id = v_ride.rider_id;
  update rides set rider_confirmed_payment = true, go_cash_paid_at = now() where id = p_ride_id;

  return json_build_object('success', true, 'amount', v_amount);
end;
$function$;

revoke all on function public.process_go_cash_payment(uuid, uuid, uuid, numeric) from public, anon;
grant execute on function public.process_go_cash_payment(uuid, uuid, uuid, numeric) to authenticated;

-- 6. Stuck rides: rider confirmed payment but the driver didn't, for 30+ minutes
create or replace function public.settle_stuck_rides()
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  stuck_ride record;
begin
  for stuck_ride in
    select r.id
    from rides r
    where r.rider_confirmed_payment = true
      and coalesce(r.driver_confirmed_payment, false) = false
      and r.status = 'payment_pending'
      and r.updated_at < now() - interval '30 minutes'
  loop
    perform settle_ride(stuck_ride.id);
  end loop;
end;
$function$;

-- 7. Check: should list the four functions
select proname as ready from pg_proc
where proname in ('settle_ride', 'complete_ride_and_deduct_commission',
                  'process_go_cash_payment', 'settle_stuck_rides')
order by proname;