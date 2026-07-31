/**
 * Connection state for the app: holds the active importer connection, restores
 * it from the secure store on launch, and exposes sign-in/sign-out actions.
 *
 * Screens only ever see a {@link Session} — an address and the bearer to send.
 * The refresh token stays in here and in the secure store, so no screen can
 * accidentally hand it to a request.
 */
import {
  createContext,
  type ReactElement,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  normalizeBaseUrl,
  registerDevice,
  type Session,
  setReauthHandler,
  setSessionGuard,
} from '../api/importerClient';
import { getPushToken } from '../push/pushRegistration';
import { signIn } from './appAuthFlow';
import { isExpiring, refreshConnection, toSession } from './appSession';
import {
  clearConnection,
  type Connection,
  loadConnection,
  migrateLegacySecrets,
  saveConnection,
} from './connectionStore';

/** Lifecycle of the app's connection to an importer. */
export type ConnectionStatus = 'loading' | 'connected' | 'disconnected';

/** Connection state + actions exposed to the tree. */
export interface AuthState {
  status: ConnectionStatus;
  connection: Session | null;
  /** True when the session could not be renewed and the user must act. */
  sessionExpired: boolean;
  /** Runs browser sign-in against the given importer address. */
  connect: (baseUrl: string) => Promise<void>;
  /** Renews the session behind a biometric prompt; null when it could not. */
  reauthenticate: () => Promise<Session | null>;
  disconnect: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

/**
 * Best-effort push registration: mints an Expo push token and registers it with
 * the importer. Never blocks or fails connecting — push is optional.
 * @param session - The connection to register this device with.
 */
async function registerForPush(session: Session): Promise<void> {
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
 * Removes the secrets an older version left behind, without letting a failed
 * delete hide a connection that is still perfectly good.
 */
async function cleanUpLegacySecrets(): Promise<void> {
  try {
    await migrateLegacySecrets();
  } catch {
    // Best-effort: the v1 keys are unusable either way, and refusing to load
    // the current connection over them would send a signed-in user back to the
    // browser for nothing.
  }
}

/**
 * Provides connection state + actions, restoring any saved connection on mount.
 * @param props - Children to render inside the provider.
 * @returns The provider element.
 */
export function AuthProvider({ children }: Readonly<{ children: ReactNode }>): ReactElement {
  const [status, setStatus] = useState<ConnectionStatus>('loading');
  const [connection, setConnection] = useState<Connection | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const inFlight = useRef<Promise<Session | null> | null>(null);

  useEffect(() => {
    cleanUpLegacySecrets()
      .then(loadConnection)
      .then((saved) => {
        setConnection(saved);
        setStatus(saved ? 'connected' : 'disconnected');
      })
      .catch(() => {
        setStatus('disconnected');
      });
  }, []);

  const forget = useCallback(async () => {
    await clearConnection();
    setConnection(null);
    setSessionExpired(false);
    setStatus('disconnected');
  }, []);

  const connect = useCallback(async (baseUrl: string) => {
    const tokens = await signIn(baseUrl);
    const next: Connection = {
      baseUrl: normalizeBaseUrl(baseUrl),
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    };
    await saveConnection(next);
    setConnection(next);
    setSessionExpired(false);
    setStatus('connected');
    void registerForPush(toSession(next));
  }, []);

  const renew = useCallback(async (): Promise<Session | null> => {
    if (!connection) {
      return null;
    }
    const outcome = await refreshConnection(connection);
    if (outcome.status === 'refreshed') {
      setConnection(outcome.connection);
      setSessionExpired(false);
      return toSession(outcome.connection);
    }
    if (outcome.status === 'ended') {
      await forget();
      return null;
    }
    setSessionExpired(true);
    return null;
  }, [connection, forget]);

  const reauthenticate = useCallback((): Promise<Session | null> => {
    inFlight.current ??= renew().finally(() => {
      inFlight.current = null;
    });
    return inFlight.current;
  }, [renew]);

  useEffect(() => {
    const guard = async (active: Session): Promise<Session> => {
      if (!connection || !isExpiring(connection)) {
        return active;
      }
      return (await reauthenticate()) ?? active;
    };
    setReauthHandler(reauthenticate);
    setSessionGuard(guard);
    return () => {
      setReauthHandler(null);
      setSessionGuard(null);
    };
  }, [connection, reauthenticate]);

  const session = useMemo(() => (connection ? toSession(connection) : null), [connection]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      connection: session,
      sessionExpired,
      connect,
      reauthenticate,
      disconnect: forget,
    }),
    [status, session, sessionExpired, connect, reauthenticate, forget],
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
