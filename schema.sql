create extension if not exists "pgcrypto";

create type user_role as enum ('rider', 'driver');
create type ride_status as enum ('requested', 'accepted', 'in_progress', 'completed', 'cancelled');
create type payment_method as enum ('cash', 'momo');
create type payment_status as enum ('pending', 'success', 'failed');

create table if not exists profiles (
  id uuid not null primary key references auth.users(id) on delete cascade,
  role user_role not null,
  full_name text not null,
  phone text not null,
  created_at timestamptz not null default now()
);

create table if not exists drivers (
  id uuid not null primary key default gen_random_uuid(),
  profile_id uuid not null references profiles(id) on delete cascade,
  is_online boolean not null default false,
  current_lat numeric(9,6),
  current_lng numeric(9,6),
  rating numeric(3,2) not null default 0,
  total_rides integer not null default 0,
  vehicle_number text not null unique
);

create table if not exists rides (
  id uuid not null primary key default gen_random_uuid(),
  rider_id uuid not null references profiles(id) on delete cascade,
  driver_id uuid references drivers(id) on delete set null,
  pickup_lat numeric(9,6) not null,
  pickup_lng numeric(9,6) not null,
  pickup_address text not null,
  dropoff_lat numeric(9,6) not null,
  dropoff_lng numeric(9,6) not null,
  dropoff_address text not null,
  status ride_status not null default 'requested',
  fare_ghs numeric(10,2) not null,
  payment_method payment_method not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists payments (
  id uuid not null primary key default gen_random_uuid(),
  ride_id uuid not null references rides(id) on delete cascade,
  amount_ghs numeric(10,2) not null,
  method payment_method not null,
  paystack_reference text,
  status payment_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists ratings (
  id uuid not null primary key default gen_random_uuid(),
  ride_id uuid not null references rides(id) on delete cascade,
  rated_by uuid not null references profiles(id) on delete cascade,
  rated_user uuid not null references profiles(id) on delete cascade,
  score smallint not null check (score >= 1 and score <= 5),
  comment text,
  created_at timestamptz not null default now()
);

create index if not exists idx_rides_rider_id on rides(rider_id);
create index if not exists idx_rides_driver_id on rides(driver_id);
create index if not exists idx_payments_ride_id on payments(ride_id);
create index if not exists idx_ratings_ride_id on ratings(ride_id);

alter table rides enable row level security;

create policy riders_can_view_own_rides on rides
  for select
  using (auth.uid() = rider_id);

create policy drivers_can_view_assigned_rides on rides
  for select
  using (
    exists (
      select 1 from drivers
      where drivers.profile_id = auth.uid()
        and drivers.id = rides.driver_id
    )
  );

create policy riders_can_insert_own_rides on rides
  for insert
  with check (auth.uid() = rider_id);
  