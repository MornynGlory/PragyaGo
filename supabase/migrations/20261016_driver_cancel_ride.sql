-- =====================================================================
-- PragyaGo: Driver cancel ride (step 1 of 3: database)
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Cancellation log
--    Doubles as (a) the list of drivers to skip when re-offering a ride
--    and (b) the history the admin dashboard counts from.
-- ---------------------------------------------------------------------
create table if not exists public.ride_cancellations (
  id                    uuid primary key default gen_random_uuid(),
  ride_id               uuid not null references public.rides(id)   on delete cascade,
  driver_id             uuid not null references public.drivers(id) on delete cascade,
  reason                text not null,
  ride_status_at_cancel text not null,
  created_at            timestamptz not null default now()
);

create index if not exists ride_cancellations_driver_idx
  on public.ride_cancellations (driver_id, created_at desc);
create index if not exists ride_cancellations_ride_idx
  on public.ride_cancellations (ride_id);

alter table public.ride_cancellations enable row level security;

-- Drivers can see their own cancellation history. Nobody can insert
-- directly: rows are only written by driver_cancel_ride() below.
drop policy if exists "drivers read own cancellations" on public.ride_cancellations;
create policy "drivers read own cancellations"
  on public.ride_cancellations for select
  using (driver_id in (select id from public.drivers where profile_id = auth.uid()));


-- ---------------------------------------------------------------------
-- 2. driver_cancel_ride
--    Atomically hands an accepted ride back to the zone.
--    The driver is identified from the login session (auth.uid()),
--    never from a value the app sends, so nobody can cancel on
--    another driver's behalf.
-- ---------------------------------------------------------------------
create or replace function public.driver_cancel_ride(p_ride_id uuid, p_reason text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_driver_id uuid;
  v_ride      rides%rowtype;
begin
  select id into v_driver_id
  from drivers
  where profile_id = auth.uid();

  if v_driver_id is null then
    return json_build_object('success', false, 'error', 'Only drivers can cancel rides');
  end if;

  if coalesce(trim(p_reason), '') = '' then
    return json_build_object('success', false, 'error', 'A reason is required');
  end if;

  -- Lock the row so a simultaneous rider cancel or accept can't interleave.
  select * into v_ride
  from rides
  where id = p_ride_id
  for update;

  if not found or v_ride.driver_id is distinct from v_driver_id then
    return json_build_object('success', false, 'error', 'Ride not found');
  end if;

  if v_ride.status not in ('accepted', 'arrived_pickup', 'rider_boarding') then
    return json_build_object('success', false, 'error', 'This ride can no longer be cancelled');
  end if;

  -- Once the rider has confirmed they are on board, the driver must use
  -- the breakdown report instead: we must not "re-dispatch" a rider who
  -- is already sitting in the tricycle.
  if coalesce(v_ride.rider_confirmed_boarding, false) then
    return json_build_object('success', false, 'error', 'Rider has boarded. Please use Report Breakdown instead.');
  end if;

  insert into ride_cancellations (ride_id, driver_id, reason, ride_status_at_cancel)
  values (p_ride_id, v_driver_id, trim(p_reason), v_ride.status::text);

  update rides
  set status                   = 'requested',
      driver_id                = null,
      accepted_at              = null,
      rider_confirmed_boarding = false,
      dispatch_attempt         = coalesce(dispatch_attempt, 0) + 1
  where id = p_ride_id;

  return json_build_object('success', true, 'ride_id', p_ride_id);
end;
$function$;

revoke all on function public.driver_cancel_ride(uuid, text) from public, anon;
grant execute on function public.driver_cancel_ride(uuid, text) to authenticated;


-- ---------------------------------------------------------------------
-- 3. accept_ride (updated, same signature so the app needs no change)
--    a) A driver who cancelled this ride cannot accept it again.
--    b) p_driver_id must belong to the logged-in user. Previously any
--       logged-in account could accept a ride in another driver's name.
-- ---------------------------------------------------------------------
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


-- ---------------------------------------------------------------------
-- 4. Check: should return two rows (accept_ride, driver_cancel_ride)
--    plus the table name.
-- ---------------------------------------------------------------------
select proname as created from pg_proc
where proname in ('accept_ride', 'driver_cancel_ride')
union all
select to_regclass('public.ride_cancellations')::text;