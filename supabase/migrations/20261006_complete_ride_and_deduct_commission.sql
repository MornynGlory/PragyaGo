-- Server-side ride completion + commission (replaces the in-app 15% calculation).

-- Columns the function relies on
ALTER TABLE platform_settings ADD COLUMN IF NOT EXISTS commission_rate NUMERIC DEFAULT 15;
ALTER TABLE driver_wallet_transactions ADD COLUMN IF NOT EXISTS balance_after NUMERIC(10,2);

CREATE OR REPLACE FUNCTION complete_ride_and_deduct_commission(
  p_ride_id UUID,
  p_driver_id UUID
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ride rides%ROWTYPE;
  v_fare NUMERIC;
  v_commission NUMERIC;
  v_earnings NUMERIC;
  v_commission_rate NUMERIC;
BEGIN
  -- Caller must own this driver record
  IF NOT EXISTS (SELECT 1 FROM drivers WHERE id = p_driver_id AND profile_id = auth.uid()) THEN
    RETURN json_build_object('success', false, 'error', 'Not your driver record');
  END IF;

  -- Lock the ride so concurrent calls (double tap, retry) are serialised
  SELECT * INTO v_ride FROM rides WHERE id = p_ride_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Ride not found');
  END IF;

  IF v_ride.driver_id IS DISTINCT FROM p_driver_id THEN
    RETURN json_build_object('success', false, 'error', 'Ride does not belong to this driver');
  END IF;

  IF v_ride.status = 'cancelled' THEN
    RETURN json_build_object('success', false, 'error', 'Ride was cancelled');
  END IF;

  -- Idempotency: the rider app may already have set status = 'completed', so key off
  -- the commission record rather than ride status
  IF EXISTS (SELECT 1 FROM commission_payments WHERE ride_id = p_ride_id) THEN
    RETURN json_build_object('success', false, 'error', 'Ride already settled');
  END IF;

  -- Get commission rate from platform settings
  SELECT commission_rate INTO v_commission_rate FROM platform_settings LIMIT 1;
  v_commission_rate := COALESCE(v_commission_rate, 15) / 100;

  -- Calculate amounts
  v_fare := COALESCE(v_ride.fare_ghs::NUMERIC, 0);
  v_commission := ROUND(v_fare * v_commission_rate, 2);
  v_earnings := v_fare - v_commission;

  -- Update ride status
  UPDATE rides SET
    status = 'completed',
    driver_confirmed_payment = true,
    completed_at = COALESCE(completed_at, NOW()),
    final_fare_ghs = v_fare
  WHERE id = p_ride_id;

  -- Add earnings to driver wallet
  UPDATE drivers SET
    wallet_balance = COALESCE(wallet_balance, 0) + v_earnings,
    commission_owed = COALESCE(commission_owed, 0) + v_commission
  WHERE id = p_driver_id;

  -- Log commission
  INSERT INTO commission_payments (driver_id, ride_id, amount, status, paid_at, payment_method)
  VALUES (p_driver_id, p_ride_id, v_commission, 'pending', NOW(), 'auto_deduction');

  -- Log wallet transaction
  INSERT INTO driver_wallet_transactions (driver_id, amount, type, description, balance_after)
  SELECT p_driver_id, v_earnings, 'earning',
    'Ride earnings (after ' || ROUND(v_commission_rate * 100) || '% commission)',
    wallet_balance
  FROM drivers WHERE id = p_driver_id;

  RETURN json_build_object(
    'success', true,
    'fare', v_fare,
    'commission', v_commission,
    'earnings', v_earnings
  );
END;
$$;

REVOKE ALL ON FUNCTION complete_ride_and_deduct_commission(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION complete_ride_and_deduct_commission(UUID, UUID) TO authenticated;
