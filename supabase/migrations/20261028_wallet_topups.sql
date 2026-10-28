-- =====================================================================
-- PragyaGo money batch M1 (2026-10-28): server-verified top-ups
--   Go Cash (riders) and driver wallet (commission) top-ups are credited ONLY
--   after the server has confirmed the payment with Paystack: right status,
--   GHS, and the exact amount. Each reference can be credited once.
--   A driver top-up then pays any commission owed and unlocks the driver.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =====================================================================

-- 1. One row per top-up attempt. The reference is created by the server.
create table if not exists public.wallet_topups (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  kind         text not null check (kind in ('go_cash', 'driver_wallet')),
  reference    text not null unique,
  amount_ghs   numeric not null check (amount_ghs > 0),
  status       text not null default 'pending' check (status in ('pending', 'credited', 'failed')),
  channel      text,                  -- e.g. mobile_money / card (from Paystack)
  created_at   timestamptz not null default now(),
  credited_at  timestamptz,
  failure_reason text
);
create index if not exists wallet_topups_user_idx on public.wallet_topups (user_id, created_at desc);

alter table public.wallet_topups enable row level security;
drop policy if exists "users read own topups" on public.wallet_topups;
create policy "users read own topups" on public.wallet_topups
  for select using (user_id = auth.uid());
revoke insert, update, delete on public.wallet_topups from anon, authenticated;

-- 2. Credit a verified top-up. Called only by the topup-verify Edge Function
--    (service role) after Paystack confirmed status, currency and amount.
create or replace function public.credit_topup(p_reference text, p_channel text)
returns json
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_t        wallet_topups%rowtype;
  v_driver   drivers%rowtype;
  v_balance  numeric;
  v_owed     numeric;
begin
  select * into v_t from wallet_topups where reference = p_reference for update;
  if not found then
    return json_build_object('success', false, 'error', 'unknown_reference');
  end if;
  if v_t.status = 'credited' then
    return json_build_object('success', true, 'already_credited', true, 'amount', v_t.amount_ghs);
  end if;

  if v_t.kind = 'go_cash' then
    update profiles set go_cash_balance = coalesce(go_cash_balance, 0) + v_t.amount_ghs
    where id = v_t.user_id
    returning go_cash_balance into v_balance;

    insert into go_cash_transactions (rider_id, amount, type, description, balance_after)
    values (v_t.user_id, v_t.amount_ghs, 'topup',
            'Go Cash top-up (' || coalesce(p_channel, 'Paystack') || ') ref ' || p_reference, v_balance);

  else  -- driver_wallet
    select * into v_driver from drivers where profile_id = v_t.user_id for update;
    if not found then
      update wallet_topups set status = 'failed', failure_reason = 'no driver record'
      where id = v_t.id;
      return json_build_object('success', false, 'error', 'no_driver_record');
    end if;

    update drivers set wallet_balance = coalesce(wallet_balance, 0) + v_t.amount_ghs
    where id = v_driver.id
    returning wallet_balance into v_balance;

    insert into driver_wallet_transactions (driver_id, amount, type, description, balance_after)
    values (v_driver.id, v_t.amount_ghs, 'topup',
            'Wallet top-up (' || coalesce(p_channel, 'Paystack') || ') ref ' || p_reference, v_balance);

    -- If commission is owed and the wallet now covers it, pay it and unlock.
    v_owed := coalesce(v_driver.commission_owed, 0);
    if v_owed > 0 and v_balance >= v_owed then
      update drivers set
        wallet_balance        = wallet_balance - v_owed,
        commission_owed       = 0,
        total_commission_paid = coalesce(total_commission_paid, 0) + v_owed,
        is_locked             = false,
        go_cash_locked        = false,
        last_commission_date  = current_date
      where id = v_driver.id
      returning wallet_balance into v_balance;

      insert into driver_wallet_transactions (driver_id, amount, type, description, balance_after)
      values (v_driver.id, v_owed, 'commission_deduction', 'Commission paid from top-up', v_balance);

      insert into commission_payments (driver_id, amount, status, paid_at, payment_method, notes)
      values (v_driver.id, v_owed, 'paid', now(), 'auto_deduction', 'Paid from wallet top-up ' || p_reference);
    end if;
  end if;

  update wallet_topups
  set status = 'credited', credited_at = now(), channel = p_channel
  where id = v_t.id;

  return json_build_object('success', true, 'amount', v_t.amount_ghs, 'balance', v_balance);
end;
$function$;

revoke all on function public.credit_topup(text, text) from public, anon, authenticated;
grant execute on function public.credit_topup(text, text) to service_role;

select to_regclass('public.wallet_topups')::text as created
union all
select proname from pg_proc where proname = 'credit_topup';
