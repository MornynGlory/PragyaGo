import * as WebBrowser from 'expo-web-browser';
import { supabase } from './supabase';

export type MoMoProvider = 'mtn' | 'tel' | 'atl';

export const PROVIDER_LABELS: Record<MoMoProvider, string> = {
  mtn: 'MTN',
  tel: 'Telecel',
  atl: 'AirtelTigo',
};

export const PROVIDER_COLORS: Record<MoMoProvider, string> = {
  mtn: '#FFD700',
  tel: '#E30613',
  atl: '#0066CC',
};

const PAYSTACK_PUBLIC_KEY = process.env.EXPO_PUBLIC_PAYSTACK_PUBLIC_KEY ?? '';

/** Unique reference generated on the client before opening checkout. */
export function generateReference(prefix: string, userId: string): string {
  return `${prefix}_${userId.slice(0, 8)}_${Date.now()}`;
}

/**
 * Builds a Paystack-hosted checkout URL using only the PUBLIC key.
 * No server call needed — the secret key is never involved here.
 *
 * Paystack's standard checkout accepts these query params when opened directly:
 * key, email, amount (pesewas), currency, ref, channels[]
 */
export function buildCheckoutUrl(
  email: string,
  amountGhs: number,
  reference: string,
  provider: MoMoProvider,
): string {
  const params = new URLSearchParams({
    key: PAYSTACK_PUBLIC_KEY,
    email,
    amount: String(Math.round(amountGhs * 100)),
    currency: 'GHS',
    ref: reference,
    'channels[]': 'mobile_money',
    mobile_money_provider: provider,
  });
  return `https://checkout.paystack.com/initialize?${params.toString()}`;
}

/** Opens Paystack's hosted payment page. Resolves when the user closes the browser. */
export async function openPaystackCheckout(url: string): Promise<void> {
  await WebBrowser.openBrowserAsync(url, {
    showTitle: false,
    enableBarCollapsing: true,
  });
}

export interface VerifyResult {
  success: boolean;
  amount?: number;        // GHS (actual amount charged by Paystack)
  status?: string;        // 'success' | 'failed' | 'abandoned' | 'pending'
  message?: string;
  alreadyProcessed?: boolean;
}

/**
 * Calls the 'verify-paystack' Supabase Edge Function which:
 *   1. Verifies the transaction with Paystack using the secret key (server-side only)
 *   2. Updates go_cash_balance (type='gocash') or wallet_balance (type='wallet')
 *   3. Records the payment in the payments table (idempotent — safe to retry)
 *
 * Returns the actual GHS amount credited on success.
 */
export async function verifyAndCredit(
  reference: string,
  type: 'gocash' | 'wallet',
): Promise<VerifyResult> {
  try {
    const { data, error } = await supabase.functions.invoke('verify-paystack', {
      body: { reference, type },
    });
    if (error) {
      console.error('verify-paystack error:', error);
      return { success: false, message: error.message };
    }
    return data as VerifyResult;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Verification failed';
    return { success: false, message };
  }
}

// ---------------------------------------------------------------------------
// Admin / server-only helpers — require PAYSTACK_SECRET_KEY.
// Do NOT call these from the mobile app. Use from a trusted server or
// Supabase Edge Function only (e.g. your admin dashboard backend).
// ---------------------------------------------------------------------------

export async function createTransferRecipient(
  name: string,
  accountNumber: string,
  bankCode: string,
): Promise<string | null> {
  const res = await fetch('https://api.paystack.co/transferrecipient', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ type: 'mobile_money', name, account_number: accountNumber, bank_code: bankCode, currency: 'GHS' }),
  });
  const data = await res.json();
  if (!data.status) { console.error('createTransferRecipient:', data.message); return null; }
  return data.data.recipient_code;
}

export async function initiateTransfer(
  amountGhs: number,
  recipientCode: string,
  reason: string,
): Promise<string | null> {
  const res = await fetch('https://api.paystack.co/transfer', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ source: 'balance', amount: Math.round(amountGhs * 100), recipient: recipientCode, reason, currency: 'GHS' }),
  });
  const data = await res.json();
  if (!data.status) { console.error('initiateTransfer:', data.message); return null; }
  return data.data.transfer_code;
}
