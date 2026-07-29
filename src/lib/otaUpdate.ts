/**
 * Pure decision logic behind the update prompt.
 *
 * `expo-updates` only works in release builds — its APIs are inert in
 * development and Expo Go — so the branching lives here, where it is unit
 * tested without touching the native module.
 */

/** What the update machinery is currently doing. */
export type OtaState = 'disabled' | 'idle' | 'downloading' | 'ready' | 'restarting';

/** Which prompt, if any, the update banner should show. */
export type UpdatePrompt = 'none' | 'restart' | 'download';

/** The slice of the `expo-updates` hook state the prompt depends on. */
export interface OtaSignals {
  /** False in development builds and Expo Go, where updates never run. */
  readonly isEnabled: boolean;
  /** True while the new bundle is still being fetched in the background. */
  readonly isDownloading: boolean;
  /** True once a downloaded update is waiting for the next app start. */
  readonly isUpdatePending: boolean;
  /** True while the app is reloading into the new bundle. */
  readonly isRestarting: boolean;
}

/**
 * Reduces the expo-updates state to the one case the banner cares about.
 *
 * Check and download failures deliberately map to `idle`. The user cannot act
 * on them, the next launch retries on its own, and an error banner nobody can
 * dismiss is worse than silence.
 * @param signals - The current expo-updates state.
 * @returns The update state to render from.
 */
export function resolveOtaState(signals: OtaSignals): OtaState {
  if (!signals.isEnabled) {
    return 'disabled';
  }
  if (signals.isRestarting) {
    return 'restarting';
  }
  if (signals.isUpdatePending) {
    return 'ready';
  }
  if (signals.isDownloading) {
    return 'downloading';
  }
  return 'idle';
}

/**
 * Picks the prompt to show, given the update state and whether a newer
 * installable build exists.
 *
 * A downloaded update wins: it applies with one tap and needs no download. The
 * new-install prompt only appears once over-the-air delivery has nothing to
 * offer, which is exactly the case where a release changed native code and no
 * update could carry it.
 * @param state - The current update state.
 * @param hasNewerRelease - Whether a newer build is published for download.
 * @returns The prompt to render.
 */
export function resolveUpdatePrompt(state: OtaState, hasNewerRelease: boolean): UpdatePrompt {
  if (state === 'ready') {
    return 'restart';
  }
  if (hasNewerRelease && (state === 'idle' || state === 'disabled')) {
    return 'download';
  }
  return 'none';
}
