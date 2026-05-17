import { Stack } from 'expo-router';
export default function RiderLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="home"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="gocash"
        options={{ title: 'My Go Cash Wallet' }}
      />
    </Stack>
  );
}