import { View, StyleSheet, Pressable, Text } from 'react-native';
import { useRouter } from 'expo-router';

export default function RoleSelectionScreen() {
  const router = useRouter();

  const handleRiderPress = () => {
    router.push('/rider/home');
  };

  const handleDriverPress = () => {
    router.push('/driver/home');
  };

  return (
    <View style={styles.container}>
      <Text style={styles.welcome}>Welcome to PragyaGo</Text>

      <Pressable style={styles.button} onPress={handleRiderPress}>
        <Text style={styles.buttonText}>I'm a Rider</Text>
      </Pressable>

      <Pressable style={[styles.button, styles.driverButton]} onPress={handleDriverPress}>
        <Text style={styles.buttonText}>I'm a Driver</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    backgroundColor: '#f5f5f5',
  },
  welcome: {
    fontSize: 32,
    fontWeight: 'bold',
    marginBottom: 60,
    textAlign: 'center',
    color: '#333',
  },
  button: {
    width: '100%',
    paddingVertical: 16,
    paddingHorizontal: 20,
    backgroundColor: '#007AFF',
    borderRadius: 8,
    alignItems: 'center',
    marginVertical: 10,
  },
  driverButton: {
    backgroundColor: '#34C759',
  },
  buttonText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
  },
});
