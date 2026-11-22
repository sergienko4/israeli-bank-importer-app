/** Loads the importer's OTP channel and keeps the device cache in step. */
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';

import type { Session } from '../api/importerClient';
import type { OtpChannel } from '../api/otp';
import { type ChannelRefreshResult, refreshOtpChannel } from '../lib/otpChannelSync';

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

/** How long a stale read waits for the publication that superseded it. */
const STALE_RETRY_MS = 250;

/**
 * Reads the channel, retrying once when a publication superseded the read.
 * @param read - Performs one read.
 * @param current - Reports whether the screen still wants the answer.
 * @returns The read that counts, or the stale one when the screen left.
 */
async function readWithRetry(
  read: () => Promise<ChannelRefreshResult>,
  current: () => boolean,
): Promise<ChannelRefreshResult> {
  const first = await read();
  if (first.status !== 'stale' || !current()) {
    return first;
  }
  // A watcher publication can land just after a read is superseded. One
  // bounded retry avoids finalizing an error for a channel that is current.
  await new Promise((resolve) => setTimeout(resolve, STALE_RETRY_MS));
  return current() ? read() : first;
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
    const stillCurrent = (): boolean =>
      active && connectionRef.current?.baseUrl === activeConnection.baseUrl;
    const done = (
      channel: OtpChannel | null,
      error: string | null,
      warning: string | null,
    ): void => {
      if (active) {
        setResult({ baseUrl: activeConnection.baseUrl, reloadKey, channel, error, warning });
      }
    };
    const read = (): Promise<ChannelRefreshResult> =>
      refreshOtpChannel(activeConnection, stillCurrent);
    void readWithRetry(read, stillCurrent)
      .then((result) => {
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
