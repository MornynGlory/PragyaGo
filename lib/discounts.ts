import { supabase } from './supabase';

export interface DiscountResult {
  discount: any | null;
  discountAmount: number;
  finalFare: number;
  message: string | null;
}

export const applyDiscount = async (
  riderId: string,
  destination: string,
  originalFare: number
): Promise<DiscountResult> => {
  try {
    const { data: discounts } = await supabase
      .from('discounts')
      .select('*')
      .eq('is_active', true)
      .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

    if (!discounts || discounts.length === 0) {
      return { discount: null, discountAmount: 0, finalFare: originalFare, message: null };
    }

    const { count: rideCount } = await supabase
      .from('rides')
      .select('id', { count: 'exact' })
      .eq('rider_id', riderId)
      .eq('status', 'completed');

    const totalRides = rideCount || 0;

    let bestDiscount: any = null;
    let bestPercentage = 0;

    for (const discount of discounts) {
      if (discount.max_uses && discount.uses_count >= discount.max_uses) continue;

      let applies = false;

      if (discount.type === 'new_user' && totalRides === 0) {
        applies = true;
      } else if (discount.type === 'destination' && discount.destination_keyword) {
        applies = destination.toLowerCase().includes(discount.destination_keyword.toLowerCase());
      } else if (discount.type === 'loyal_rider' && totalRides >= (discount.min_rides_for_loyalty || 10)) {
        applies = true;
      }

      if (applies && discount.percentage > bestPercentage) {
        bestDiscount = discount;
        bestPercentage = discount.percentage;
      }
    }

    if (!bestDiscount) {
      return { discount: null, discountAmount: 0, finalFare: originalFare, message: null };
    }

    const discountAmount = Math.round((originalFare * bestDiscount.percentage / 100) * 10) / 10;
    const finalFare = Math.round((originalFare - discountAmount) * 10) / 10;

    let message = '';
    if (bestDiscount.type === 'new_user') message = `🎁 New rider discount: ${bestDiscount.percentage}% off your first ride!`;
    if (bestDiscount.type === 'destination') message = `📍 ${bestDiscount.name}: ${bestDiscount.percentage}% off`;
    if (bestDiscount.type === 'loyal_rider') message = `⭐ Loyal rider discount: ${bestDiscount.percentage}% off!`;

    return { discount: bestDiscount, discountAmount, finalFare, message };
  } catch (error) {
    console.error('Error applying discount:', error);
    return { discount: null, discountAmount: 0, finalFare: originalFare, message: null };
  }
};

export const recordDiscountUse = async (discountId: string) => {
  try {
    const { data: discount } = await supabase
      .from('discounts')
      .select('uses_count')
      .eq('id', discountId)
      .single();

    if (discount) {
      await supabase
        .from('discounts')
        .update({ uses_count: (discount.uses_count || 0) + 1 })
        .eq('id', discountId);
    }
  } catch (error) {
    console.error('Error recording discount use:', error);
  }
};
