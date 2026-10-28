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
