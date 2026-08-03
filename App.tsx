import { StatusBar } from 'expo-status-bar';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider, useAuth } from './src/auth/AuthContext';
import { Loader } from './src/components/ui';
import { AppShell } from './src/screens/AppShell';
import { ConnectScreen } from './src/screens/ConnectScreen';
import { UpdateBanner } from './src/screens/UpdateBanner';
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
      <UpdateBanner />
    </>
  );
}

/**
 * App entry point: wraps the tree in the keyboard, safe-area, theme, and auth
 * providers.
 *
 * `KeyboardProvider` is outermost because it installs the native frame listener
 * every keyboard-aware view reads from; a provider mounted below a screen only
 * animates the subtree beneath it.
 * @returns The root app element.
 */
export default function App() {
  return (
    <KeyboardProvider>
      <SafeAreaProvider>
        <ThemeProvider>
          <AuthProvider>
            <Root />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </KeyboardProvider>
  );
}
