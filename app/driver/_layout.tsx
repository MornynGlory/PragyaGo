import { Stack } from 'expo-router';

export default function DriverLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="home"
        options={{ headerShown: false }}
      />
    </Stack>
  );
}
