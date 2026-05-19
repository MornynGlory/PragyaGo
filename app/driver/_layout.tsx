import { Stack } from 'expo-router';
export default function DriverLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="home"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="report"
        options={{ title: 'Daily Report' }}
      />
      <Stack.Screen
        name="wallet"
        options={{ title: 'My Wallet' }}
      />
    </Stack>
  );
}