import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { Loader } from './src/components/ui';
import { AppShell } from './src/screens/AppShell';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { ThemeProvider, useTheme } from './src/theme/ThemeContext';

/**
 * Chooses the screen from the connection status: a spinner while restoring a
 * saved connection, then the home screen when connected or the connect form.
 * @returns The active screen element.
 */
function Root() {
  const { status } = useAuth();
  const theme = useTheme();
  if (status === 'loading') {
    return <Loader label="Restoring your connection" />;
  }
  return (
    <>
      <StatusBar style={theme.scheme === 'dark' ? 'light' : 'dark'} />
      {status === 'connected' ? <AppShell /> : <ConnectScreen />}
    </>
  );
}

/**
 * App entry point: wraps the tree in the safe-area, theme, and auth providers.
 * @returns The root app element.
 */
export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <Root />
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
