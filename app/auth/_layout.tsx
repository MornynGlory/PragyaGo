import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack>
      <Stack.Screen
        name="login"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="register"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="verify-driver"
        options={{ title: 'Identity Verification' }}
      />
      <Stack.Screen
        name="pending"
        options={{ headerShown: false }}
      />
      <Stack.Screen
        name="rejected"
        options={{ headerShown: false }}
      />
    </Stack>
  );
}
