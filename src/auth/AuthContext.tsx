/**
 * Connection state for the app: holds the active importer connection, restores
 * it from the secure store on launch, and exposes connect/disconnect actions.
 */
import {
  createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState,
} from 'react';

import { registerDevice, requestToken } from '../api/importerClient';
import { getPushToken } from '../push/pushRegistration';
import {
  clearConnection, type Connection, clearPassword, hasStoredPassword,
  loadConnection, loadPassword, savePassword, saveConnection,
} from './connectionStore';

/** Lifecycle of the app's connection to an importer. */
export type ConnectionStatus = 'loading' | 'connected' | 'disconnected';

/** Connection state + actions exposed to the tree. */
export interface AuthState {
  status: ConnectionStatus;
  connection: Connection | null;
  /** True when a password is stored for silent re-auth (quick unlock). */
  quickUnlockEnabled: boolean;
  connect: (baseUrl: string, password: string, rememberPassword?: boolean) => Promise<void>;
  /** Silently re-authenticates using the stored password; false when unavailable/failed. */
  reauthenticate: () => Promise<boolean>;
  /** Disables quick unlock by clearing the stored password. */
  disableQuickUnlock: () => Promise<void>;
  disconnect: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Best-effort push registration: mints an Expo push token and registers it with
 * the importer. Never blocks or fails connecting — push is optional.
 * @param session - The connection to register this device with.
 */
async function registerForPush(session: Connection): Promise<void> {
  try {
    const pushToken = await getPushToken();
    if (pushToken) {
      await registerDevice(session, pushToken);
    }
  } catch {
    // Push is best-effort; a failure here never affects the connection.
  }
}

/**
 * Provides connection state + actions, restoring any saved connection on mount.
 * @param props - Children to render inside the provider.
 * @returns The provider element.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<ConnectionStatus>('loading');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [quickUnlockEnabled, setQuickUnlockEnabled] = useState(false);

  useEffect(() => {
    Promise.all([loadConnection(), hasStoredPassword()])
      .then(([saved, hasPassword]) => {
        setConnection(saved);
        setQuickUnlockEnabled(hasPassword);
        setStatus(saved ? 'connected' : 'disconnected');
      })
      .catch(() => {
        setStatus('disconnected');
      });
  }, []);

  const connect = useCallback(async (baseUrl: string, password: string, rememberPassword = false) => {
    const token = await requestToken(baseUrl, password);
    const next: Connection = { baseUrl, token };
    await saveConnection(next);
    if (rememberPassword) {
      await savePassword(password);
    } else {
      await clearPassword();
    }
    setConnection(next);
    setQuickUnlockEnabled(rememberPassword);
    setStatus('connected');
    void registerForPush(next);
  }, []);

  const reauthenticate = useCallback(async (): Promise<boolean> => {
    if (!connection) {
      return false;
    }
    const password = await loadPassword();
    if (!password) {
      return false;
    }
    try {
      const token = await requestToken(connection.baseUrl, password);
      const next: Connection = { baseUrl: connection.baseUrl, token };
      await saveConnection(next);
      setConnection(next);
      setStatus('connected');
      return true;
    } catch {
      return false;
    }
  }, [connection]);

  const disableQuickUnlock = useCallback(async () => {
    await clearPassword();
    setQuickUnlockEnabled(false);
  }, []);

  const disconnect = useCallback(async () => {
    await clearConnection();
    setConnection(null);
    setQuickUnlockEnabled(false);
    setStatus('disconnected');
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      status, connection, quickUnlockEnabled, connect, reauthenticate, disableQuickUnlock, disconnect,
    }),
    [status, connection, quickUnlockEnabled, connect, reauthenticate, disableQuickUnlock, disconnect],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Accesses connection state.
 * @returns The current auth state.
 * @throws Error when used outside an {@link AuthProvider}.
 */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
