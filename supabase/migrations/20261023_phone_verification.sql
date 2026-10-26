-- PragyaGo: phone verification via SasuSync (server-side)
-- Holds SasuSync's otp_id per user. The code itself is never stored by us.
-- Server only: RLS on with no policies. Safe to re-run.
create table if not exists public.phone_verification_requests (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  phone           text not null,
  otp_id          text not null,
  expires_at      timestamptz not null,
  attempts        integer not null default 0,
  last_sent_at    timestamptz not null default now(),
  window_start    timestamptz not null default now(),
  sends_in_window integer not null default 0
);
alter table public.phone_verification_requests enable row level security;
revoke all on public.phone_verification_requests from anon, authenticated;

select to_regclass('public.phone_verification_requests')::text as created;
