export interface OTPResult {
  success: boolean;
  message?: string;
}

export async function sendOTP(phone: string, code: string): Promise<OTPResult> {
  const apiKey = process.env.EXPO_PUBLIC_ARKESEL_API_KEY;

  console.log('Arkesel API Key:', apiKey);
  console.log('Sending OTP to:', phone);

  if (!apiKey) {
    console.error('EXPO_PUBLIC_ARKESEL_API_KEY is not set');
    return { success: false, message: 'SMS service not configured — EXPO_PUBLIC_ARKESEL_API_KEY is missing' };
  }

  try {
    const response = await fetch('https://sms.arkesel.com/api/v2/sms/send', {
      method: 'POST',
      headers: {
        'api-key': process.env.EXPO_PUBLIC_ARKESEL_API_KEY || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: 'PragyaGo',
        message: `Your PragyaGo verification code is: ${code}. Valid for 10 minutes.`,
        recipients: [phone.startsWith('0') ? '233' + phone.substring(1) : phone],
      }),
    });
    const data = await response.json();
    console.log('Arkesel v2 response:', JSON.stringify(data));
    if (data.status === 'success') return { success: true };
    return { success: false, message: data.message ?? `Arkesel error: ${JSON.stringify(data)}` };
  } catch (err) {
    console.error('Arkesel network error:', err);
    return { success: false, message: err instanceof Error ? err.message : 'Network error' };
  }
}
