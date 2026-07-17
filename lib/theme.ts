import { useColorScheme } from 'react-native';

export const lightTheme = {
  background: '#FFFFFF',
  background2: '#F5F7FA',
  card: '#FFFFFF',
  cardBorder: '#E5E7EB',
  text: '#0D1F2D',
  textSecondary: '#6B7280',
  textMuted: '#9CA3AF',
  green: '#1D9E75',
  greenLight: '#E6F7F2',
  blue: '#185FA5',
  blueLight: '#E6F1FB',
  red: '#DC2626',
  redLight: '#FEE2E2',
  amber: '#B45309',
  amberLight: '#FEF3C7',
  border: '#E5E7EB',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E5E7EB',
  input: '#F5F7FA',
  inputBorder: '#E5E7EB',
  placeholder: '#9CA3AF',
  overlay: 'rgba(0,0,0,0.5)',
  statusBar: 'dark-content' as const,
};

export const darkTheme = {
  background: '#0D1F2D',
  background2: '#1C3244',
  card: '#1C3244',
  cardBorder: 'rgba(255,255,255,0.08)',
  text: '#FFFFFF',
  textSecondary: '#9CA3AF',
  textMuted: '#6B7280',
  green: '#1D9E75',
  greenLight: 'rgba(29,158,117,0.15)',
  blue: '#185FA5',
  blueLight: 'rgba(24,95,165,0.15)',
  red: '#DC2626',
  redLight: 'rgba(220,38,38,0.15)',
  amber: '#D97706',
  amberLight: 'rgba(217,119,6,0.15)',
  border: 'rgba(255,255,255,0.08)',
  tabBar: '#1C3244',
  tabBarBorder: 'rgba(255,255,255,0.08)',
  input: 'rgba(255,255,255,0.08)',
  inputBorder: 'rgba(255,255,255,0.12)',
  placeholder: 'rgba(255,255,255,0.35)',
  overlay: 'rgba(0,0,0,0.7)',
  statusBar: 'light-content' as const,
};

export type Theme = typeof lightTheme;

export const useTheme = (): Theme => {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
};
