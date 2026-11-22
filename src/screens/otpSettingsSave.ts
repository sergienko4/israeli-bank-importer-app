/**
 * Saves the OTP channel and keeps the device cache in step.
 *
 * Kept apart from the load hook so the screen data module stays within the
 * project's file cap. A save is owned by the importer and pairing it started
 * under; a late answer never moves another importer's screen.
 */
import type { RefObject } from 'react';
import { useEffect, useRef, useState } from 'react';

import { type Session, setOtpSettings } from '../api/importerClient';
import type { OtpChannel } from '../api/otp';
import { currentPairing } from '../auth/pairingGeneration';
import { haptics } from '../lib/haptics';
import {
  beginChannelChange,
  cacheOtpChannel,
  endChannelChange,
  markChannelDirty,
} from '../lib/otpChannelSync';

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
  /** Re-reads the channel after a failure that may have applied. */
  readonly onAmbiguousFailure?: () => void;
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
  onAmbiguousFailure,
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
    // The importer may have applied the change before the answer was lost;
    // the watcher will reconcile the cache, so bring the screen with it.
    onAmbiguousFailure?.();
  } finally {
    endChannelChange(connection.baseUrl);
  }
}

/** What the settings screen passes to its save hook. */
export interface ChannelSaveOptions {
  /** The active session, or null. */
  readonly connection: Session | null;
  /** The channel currently shown. */
  readonly channel: OtpChannel | null;
  /** Applies an optimistic choice. */
  readonly setChannel: (next: OtpChannel | null) => void;
  /** Re-reads the channel after an ambiguous failure. */
  readonly reload: () => void;
}

/** What one choice write needs besides its connection and channel. */
interface ChoiceWrite {
  /** The channel shown before the choice. */
  readonly previous: OtpChannel | null;
  /** Applies the optimistic choice. */
  readonly setChannel: (next: OtpChannel | null) => void;
  /** Records a failure against its importer. */
  readonly setFailure: (failure: { baseUrl: string; message: string } | null) => void;
  /** Reports whether a session still points at the save's importer. */
  readonly isCurrent: (baseUrl: string) => boolean;
  /** Re-reads after an ambiguous failure. */
  readonly reload: () => void;
}

/**
 * Writes one channel choice and records any failure against its importer.
 * @param connection - The session the choice is made under.
 * @param next - The chosen channel.
 * @param write - The previous channel, setters, session ref, and reload.
 */
async function writeChoice(
  connection: Session,
  next: OtpChannel,
  { previous, setChannel, setFailure, isCurrent, reload }: ChoiceWrite,
): Promise<void> {
  const baseUrl = connection.baseUrl;
  await saveChannel({
    connection,
    next,
    previous,
    setChannel,
    setError: (message) => {
      setFailure(message === null ? null : { baseUrl, message });
    },
    isCurrent: () => isCurrent(baseUrl),
    onAmbiguousFailure: reload,
  });
}

/**
 * Keeps the latest session in a ref for in-flight owner checks.
 * @param connection - The session the screen currently renders.
 * @returns The latest session.
 */
function useLatestSession(connection: Session | null): RefObject<Session | null> {
  const latest = useRef(connection);
  useEffect(() => {
    latest.current = connection;
  }, [connection]);
  return latest;
}

/**
 * Saves a channel choice and keeps the device cache in step.
 * @param options - The session, shown channel, optimistic setter, and reload.
 * @returns The save state and the choice handler.
 */
export function useChannelSave({
  connection,
  channel,
  setChannel,
  reload,
}: ChannelSaveOptions): ChannelSave {
  // Both the lock and the visible state name their importer: a save for A must
  // not make B look busy, swallow B's choices, or show A's error on B.
  const [savingFor, setSavingFor] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ baseUrl: string; message: string } | null>(null);
  const savingRef = useRef<string | null>(null);
  const connectionRef = useLatestSession(connection);

  const choose = async (next: OtpChannel): Promise<void> => {
    if (!connection || savingRef.current === connection.baseUrl || next === channel) {
      return;
    }
    const baseUrl = connection.baseUrl;
    savingRef.current = baseUrl;
    setSavingFor(baseUrl);
    setFailure(null);
    try {
      await writeChoice(connection, next, {
        previous: channel,
        setChannel,
        setFailure,
        isCurrent: () => isSameImporter(connectionRef.current, baseUrl),
        reload,
      });
    } finally {
      if (savingRef.current === baseUrl) {
        savingRef.current = null;
        setSavingFor(null);
      }
    }
  };

  const ownedFailure = failure !== null && failure.baseUrl === connection?.baseUrl;
  return {
    saving: savingFor !== null && savingFor === connection?.baseUrl,
    saveError: ownedFailure ? failure.message : null,
    choose,
  };
}
