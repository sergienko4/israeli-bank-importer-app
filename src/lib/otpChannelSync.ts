/**
 * Keeps the cached OTP channel, and the native capture flag that depends on it,
 * in step with the importer.
 *
 * The channel can change somewhere this app is not looking — the importer's own
 * web UI, or another phone — and the two switches that would otherwise turn
 * capture off are hidden whenever the channel is not this app. So the app
 * re-reads the channel whenever it has a session, and pushes the answer straight
 * through to the receiver.
 *
 * A failed read leaves the cache alone rather than clearing it: a flaky network
 * should not switch off a working setup. The gate is re-applied either way, so
 * the receiver always ends up holding whatever the device can actually prove.
 */
import type { Session } from '../api/importerClient';
import { getOtpSettings } from '../api/importerClient';
import type { OtpChannel } from '../api/otp';
import { saveOtpChannel } from './otpChannelStore';
import { applyStashGate } from './otpStashGate';

/** Bumped for every channel publication, so stale reads can be discarded. */
let generation = 0;
/** True while the device cache does not hold the last confirmed channel. */
let dirty = false;
/** Bumped whenever a dirty marker is set, so an in-flight write can notice. */
let dirtyRevision = 0;
/** The last channel a particular importer confirmed, for a stale read. */
let confirmed: { baseUrl: string; channel: OtpChannel } | null = null;
/** Importers with a user save between its start and cache publication. */
const savesInFlight = new Set<string>();

/**
 * Records a channel the importer just confirmed and re-syncs the capture flag.
 *
 * The generation is advanced before writing so a read that started earlier
 * cannot publish its older answer over this one, even when SecureStore fails.
 * @param channel - The channel the importer is currently set to.
 * @param baseUrl - The importer that confirmed it.
 * @returns True when the cache accepted the value, false when it did not.
 */
export async function cacheOtpChannel(channel: OtpChannel, baseUrl: string): Promise<boolean> {
  generation += 1;
  const revisionAtStart = dirtyRevision;
  // Record the importer's answer even if this device cannot store it: a stale
  // read may show it, while the dirty flag drives the cache retry.
  confirmed = { baseUrl, channel };
  let saved = true;
  try {
    await saveOtpChannel(channel);
    if (dirtyRevision === revisionAtStart) {
      dirty = false;
    }
  } catch {
    // A write that would not take must not stop the gate below from running:
    // re-applying it is what actually closes the receiver, and it fails closed.
    saved = false;
    dirty = true;
    dirtyRevision += 1;
  }
  await applyStashGate();
  return saved;
}

/**
 * Reports whether the device cache still needs a retry.
 * @returns True when the last channel write failed.
 */
export function isChannelCacheDirty(): boolean {
  return dirty;
}

/**
 * Reads the last channel this process published.
 * @param baseUrl - The importer asking for its last confirmed channel.
 * @returns The channel that importer last confirmed, or null.
 */
export function confirmedOtpChannel(baseUrl: string): OtpChannel | null {
  return confirmed?.baseUrl === baseUrl ? confirmed.channel : null;
}

/**
 * Invalidates reads that are already in flight before a channel save starts.
 * The save itself bumps the generation again when it publishes the result.
 * @param baseUrl - The importer being changed.
 */
export function beginChannelChange(baseUrl: string): void {
  savesInFlight.add(baseUrl);
  generation += 1;
}

/**
 * Marks a save as settled, whether or not it published.
 * @param baseUrl - The importer that was being changed.
 */
export function endChannelChange(baseUrl: string): void {
  savesInFlight.delete(baseUrl);
}

/** Forces the next poll to reconcile after a save that may have applied. */
export function markChannelDirty(): void {
  dirty = true;
  dirtyRevision += 1;
}

/** What one channel refresh did. */
export type ChannelRefreshStatus = 'ok' | 'stale' | 'cache-failed' | 'failed';

/** The result of one channel refresh. */
export interface ChannelRefreshResult {
  /** Whether the read was current and what happened to the cache. */
  readonly status: ChannelRefreshStatus;
  /** The confirmed channel when the read succeeded, else null. */
  readonly channel: OtpChannel | null;
  /** Why a failed read failed, when known. */
  readonly error?: string;
}

/**
 * Re-reads the importer's OTP channel and re-syncs the native capture flag.
 *
 * A read started for one importer or before a user save is discarded before
 * it can publish, so an older answer never overwrites a newer channel.
 * @param session - The active importer session.
 * @param isCurrent - Reports whether the importer that started the read is
 *   still the active one.
 * @returns What the read did and, when successful, the confirmed channel.
 */
export async function refreshOtpChannel(
  session: Session,
  isCurrent: () => boolean = () => true,
): Promise<ChannelRefreshResult> {
  const startedAt = generation;
  try {
    const settings = await getOtpSettings(session);
    if (!isCurrent() || startedAt !== generation || savesInFlight.has(session.baseUrl)) {
      return { status: 'stale', channel: confirmedOtpChannel(session.baseUrl) };
    }
    const saved = await cacheOtpChannel(settings.channel, session.baseUrl);
    return {
      status: saved ? 'ok' : 'cache-failed',
      channel: settings.channel,
    };
  } catch (e) {
    // Unreachable importer: keep the last known channel and re-sync from it.
    await applyStashGate();
    return {
      status: 'failed',
      channel: null,
      error: e instanceof Error ? e.message : undefined,
    };
  }
}
