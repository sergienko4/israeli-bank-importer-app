import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { HomeScreen } from './src/screens/HomeScreen';

/**
 * Chooses the screen from the connection status: a spinner while restoring a
 * saved connection, then the home screen when connected or the connect form.
 * @returns The active screen element.
 */
function Root(): React.JSX.Element {
  const { status } = useAuth();
  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }
  return status === 'connected' ? <HomeScreen /> : <ConnectScreen />;
}

/**
 * App entry point: wraps the tree in the auth provider.
 * @returns The root app element.
 */
export default function App(): React.JSX.Element {
  return (
    <AuthProvider>
      <StatusBar style="auto" />
      <Root />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
});
