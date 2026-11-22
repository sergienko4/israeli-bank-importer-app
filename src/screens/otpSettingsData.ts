/** Loads the importer's OTP channel and keeps the device cache in step. */
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';

import { type Session, setOtpSettings } from '../api/importerClient';
import type { OtpChannel } from '../api/otp';
import { currentPairing } from '../auth/pairingGeneration';
import { haptics } from '../lib/haptics';
import {
  beginChannelChange,
  cacheOtpChannel,
  type ChannelRefreshResult,
  endChannelChange,
  markChannelDirty,
  refreshOtpChannel,
} from '../lib/otpChannelSync';

/** What the screen needs from the channel load. */
export interface ChannelLoad {
  /** The importer's channel, or null until the first read lands. */
  readonly channel: OtpChannel | null;
  /** Whether the first read is still outstanding. */
  readonly loading: boolean;
  /** Why the read failed, or null. */
  readonly error: string | null;
  /** A non-blocking cache warning, or null. */
  readonly warning: string | null;
  /** Applies a channel the user just chose, before the importer confirms it. */
  readonly setChannel: (channel: OtpChannel | null) => void;
  /** Tries the read again. */
  readonly reload: () => void;
}

/** A finished channel read, tagged with the request that produced it. */
interface ChannelResult {
  /** The importer address the read was made for. */
  readonly baseUrl: string;
  /** Which attempt this answers, so a retry supersedes the one before it. */
  readonly reloadKey: number;
  /** The channel the importer reported, or null when the read failed. */
  readonly channel: OtpChannel | null;
  /** Why the read failed, or null. */
  readonly error: string | null;
  /** A non-blocking cache warning, or null. */
  readonly warning: string | null;
}

/** The screen-visible outcome of one refresh. */
interface AppliedChannel {
  readonly channel: OtpChannel | null;
  readonly error: string | null;
  readonly warning: string | null;
}

/**
 * Turns a refresh result into what the screen should show.
 * @param result - The refresh result.
 * @returns The channel, any blocking error, and any cache warning.
 */
function applyChannelResult(result: ChannelRefreshResult): AppliedChannel {
  if (result.status === 'stale') {
    return result.channel === null
      ? {
          channel: null,
          error: 'The channel changed while loading. Try again.',
          warning: null,
        }
      : { channel: result.channel, error: null, warning: null };
  }
  if (result.status === 'failed') {
    return {
      channel: null,
      error: result.error ?? 'Failed to load OTP settings.',
      warning: null,
    };
  }
  return {
    channel: result.channel,
    error: null,
    warning:
      result.status === 'cache-failed'
        ? 'Could not update capture on this device. It will retry automatically.'
        : null,
  };
}

/** What one channel read needs. */
interface ChannelReadOptions {
  readonly connectionRef: RefObject<Session | null>;
  readonly baseUrl: string | undefined;
  readonly reloadKey: number;
  readonly setResult: Dispatch<SetStateAction<ChannelResult | null>>;
}

/**
 * Reads the channel once per importer or retry.
 * @param options - The latest session ref, importer address, retry key, setter.
 */
function useChannelRead({
  connectionRef,
  baseUrl,
  reloadKey,
  setResult,
}: ChannelReadOptions): void {
  useEffect(() => {
    const activeConnection = connectionRef.current;
    if (!activeConnection) {
      return undefined;
    }
    let active = true;
    const done = (
      channel: OtpChannel | null,
      error: string | null,
      warning: string | null,
    ): void => {
      if (active) {
        setResult({ baseUrl: activeConnection.baseUrl, reloadKey, channel, error, warning });
      }
    };
    void refreshOtpChannel(
      activeConnection,
      () => active && connectionRef.current?.baseUrl === activeConnection.baseUrl,
    )
      .then((result) => {
        if (!active || connectionRef.current?.baseUrl !== activeConnection.baseUrl) {
          return;
        }
        const applied = applyChannelResult(result);
        done(applied.channel, applied.error, applied.warning);
      })
      .catch((e: unknown) => {
        done(null, e instanceof Error ? e.message : 'Failed to load OTP settings.', null);
      });
    return () => {
      active = false;
    };
  }, [connectionRef, baseUrl, reloadKey, setResult]);
}

/**
 * Loads the importer's OTP channel and keeps the device cache in step with it.
 *
 * The cache write is what the SMS receiver reads with no session, and the
 * switches that would otherwise close it are hidden off the app channel. A read
 * started for another importer or before a user save is discarded by the cache
 * owner check; a failed write leaves the error visible while the watcher retries.
 * @param connection - The active importer session, or null when signed out.
 * @returns The loaded channel, the request state, and a way to try again.
 */
/**
 * Reports whether a session still points at the importer that started a save.
 * @param session - The latest session, or null.
 * @param baseUrl - The importer address the save was made for.
 * @returns True when it is still the active importer.
 */
function isSameImporter(session: Session | null, baseUrl: string): boolean {
  return session?.baseUrl === baseUrl;
}

/** What the settings screen needs to save one channel choice. */
export interface ChannelSave {
  /** Whether a save is in flight. */
  readonly saving: boolean;
  /** Why the last save failed, or null. */
  readonly saveError: string | null;
  /** Saves one choice, optimistically selecting it first. */
  readonly choose: (next: OtpChannel) => Promise<void>;
}

/**
 * Marks the cache dirty and warns after a channel save may have applied.
 */
function warnChannelFailure(): void {
  markChannelDirty();
  haptics.warning();
}

/** What a failed channel save should report. */
interface ChannelFailure {
  readonly previous: OtpChannel | null;
  readonly setChannel: (next: OtpChannel | null) => void;
  readonly setError: (error: string | null) => void;
  readonly message: string;
  readonly isCurrent: () => boolean;
}

/** What a successful channel save should publish. */
interface ChannelSuccess {
  readonly connection: Session;
  readonly next: OtpChannel;
  readonly isCurrent: () => boolean;
  readonly setError: (error: string | null) => void;
}

/**
 * Publishes a channel the importer accepted, if its owner is still current.
 * @param success - The session, channel, owner check, and error setter.
 */
async function publishChannel({
  connection,
  next,
  isCurrent,
  setError,
}: ChannelSuccess): Promise<void> {
  if (!isCurrent()) {
    return;
  }
  const cached = await cacheOtpChannel(next, connection.baseUrl, isCurrent);
  if (cached === 'stale') {
    return;
  }
  haptics.success();
  if (!cached) {
    setError('Could not update capture on this device. It will retry automatically.');
  }
}

/**
 * Reports a failed save without letting a stale importer roll back another one.
 * @param failure - The previous channel, setters, message, and owner check.
 */
function reportChannelFailure({
  previous,
  setChannel,
  setError,
  message,
  isCurrent,
}: ChannelFailure): void {
  warnChannelFailure();
  if (isCurrent()) {
    setChannel(previous);
    setError(message);
  }
}

/** What one channel save needs from the screen. */
interface ChannelSaveRequest {
  readonly connection: Session;
  readonly next: OtpChannel;
  readonly previous: OtpChannel | null;
  readonly setChannel: (next: OtpChannel | null) => void;
  readonly setError: (error: string | null) => void;
  readonly isCurrent: () => boolean;
}

/**
 * Sends one channel choice and publishes it only for the same importer.
 * @param request - The session, choices, setters, and owner check.
 */
export async function saveChannel({
  connection,
  next,
  previous,
  setChannel,
  setError,
  isCurrent,
}: ChannelSaveRequest): Promise<void> {
  const pairing = currentPairing();
  const ownerIsCurrent = (): boolean => isCurrent() && currentPairing() === pairing;
  beginChannelChange(connection.baseUrl);
  setChannel(next);
  setError(null);
  try {
    const result = await setOtpSettings(connection, next);
    if (result.ok) {
      await publishChannel({ connection, next, isCurrent: ownerIsCurrent, setError });
    } else {
      reportChannelFailure({
        previous,
        setChannel,
        setError,
        message: result.error ?? 'Could not save the OTP setting.',
        isCurrent: ownerIsCurrent,
      });
    }
  } catch (e) {
    reportChannelFailure({
      previous,
      setChannel,
      setError,
      message: e instanceof Error ? e.message : 'Could not save the OTP setting.',
      isCurrent: ownerIsCurrent,
    });
  } finally {
    endChannelChange(connection.baseUrl);
  }
}

/**
 * Saves a channel choice and keeps the device cache in step.
 * @param connection - The active session, or null.
 * @param channel - The channel currently shown.
 * @param setChannel - Applies an optimistic choice.
 * @returns The save state and the choice handler.
 */
export function useChannelSave(
  connection: Session | null,
  channel: OtpChannel | null,
  setChannel: (next: OtpChannel | null) => void,
): ChannelSave {
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const connectionRef = useRef(connection);

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  const choose = async (next: OtpChannel): Promise<void> => {
    if (!connection || savingRef.current || next === channel) {
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      await saveChannel({
        connection,
        next,
        previous: channel,
        setChannel,
        setError: setSaveError,
        isCurrent: () => isSameImporter(connectionRef.current, connection.baseUrl),
      });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return { saving, saveError, choose };
}

/**
 * Loads the importer's OTP channel and keeps the device cache in step with it.
 *
 * The cache write is what the SMS receiver reads with no session, and the
 * switches that would otherwise close it are hidden off the app channel. A read
 * started for another importer or before a user save is discarded by the cache
 * owner check; a failed write leaves the error visible while the watcher retries.
 * @param connection - The active importer session, or null when signed out.
 * @returns The loaded channel, the request state, and a way to try again.
 */
export function useOtpChannel(connection: Session | null): ChannelLoad {
  const [result, setResult] = useState<ChannelResult | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const connectionRef = useRef(connection);
  const current =
    result !== null && result.baseUrl === connection?.baseUrl && result.reloadKey === reloadKey;

  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useChannelRead({ connectionRef, baseUrl: connection?.baseUrl, reloadKey, setResult });

  const setChannel = (next: OtpChannel | null): void => {
    setResult({
      baseUrl: connection?.baseUrl ?? '',
      reloadKey,
      channel: next,
      error: null,
      warning: null,
    });
  };
  const reload = (): void => {
    setReloadKey((key) => key + 1);
  };

  return {
    channel: current ? result.channel : null,
    loading: !current,
    error: current ? result.error : null,
    warning: current ? result.warning : null,
    setChannel,
    reload,
  };
}
