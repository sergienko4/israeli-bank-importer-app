/**
 * Push registration helper. Requests notification permission and resolves this
 * device's Expo push token (or null when unavailable — a simulator, denied
 * permission, or web). The token is registered with the importer via /api/devices.
 */
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';

/**
 * Reads the EAS projectId from the app config, needed to mint a push token.
 * @returns The projectId, or undefined when not configured.
 */
function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId;
}

/**
 * Requests notification permission and resolves this device's Expo push token.
 * @returns The Expo push token, or null when unavailable or permission is denied.
 */
export async function getPushToken(): Promise<string | null> {
  if (!Device.isDevice) {
    return null;
  }
  const current = await Notifications.getPermissionsAsync();
  let granted = current.granted;
  if (!granted) {
    const requested = await Notifications.requestPermissionsAsync();
    granted = requested.granted;
  }
  if (!granted) {
    return null;
  }
  const id = projectId();
  const token = await Notifications.getExpoPushTokenAsync(id ? { projectId: id } : undefined);
  return token.data;
}
