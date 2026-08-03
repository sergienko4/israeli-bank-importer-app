/**
 * Reaches the messages the native receiver is holding.
 *
 * The native module is optional in three separate ways: it does not exist on
 * iOS or web, and it is absent from any Android build made without the
 * auto-read flag. Absent therefore has to mean "nothing is held" rather than an
 * error, because the drain runs on an ordinary poll tick and a throw here would
 * surface on every platform that has no receiver to hold anything in the first
 * place.
 *
 * Only the shape this module needs is declared, so the pure side can be tested
 * without the native declaration or a device.
 */
import type { NativeStashedMessage } from '../../modules/otp-sms-consent/src/OtpSmsConsentModule';
import OtpSmsConsentModule from '../../modules/otp-sms-consent/src/OtpSmsConsentModule';
import type { StashDrainPorts } from './otpStashDrain';

/** The native calls this module makes, and nothing else. */
export interface StashBinding {
  /** Every message still held, expired ones already pruned. */
  listStashedMessages: () => Promise<NativeStashedMessage[]>;
  /** Drops one message for good. */
  consumeStashedMessage: (id: string) => Promise<void>;
  /** Records that one message was already sent against one request. */
  markStashAttempt: (id: string, requestId: string) => Promise<void>;
  /** Forgets every held message. */
  clearStash: () => Promise<void>;
  /** Mirrors the user's auto-read preference where the receiver can read it. */
  setStashEnabled: (enabled: boolean) => void;
}

/** The stash half of what {@link drainStash} needs. */
export type StashPorts = Pick<StashDrainPorts, 'list' | 'consume' | 'markAttempt'>;

/** The drain's ports plus the two lifecycle controls the rest of the app uses. */
export interface StashAccess extends StashPorts {
  /** Allows or forbids holding messages. Forbidding also empties the stash. */
  readonly setEnabled: (enabled: boolean) => void;
  /** Empties the stash without changing whether holding is allowed. */
  readonly clear: () => Promise<void>;
}

/** What the app sees where no receiver exists: an empty stash that accepts writes. */
const absent: StashAccess = {
  list: () => Promise.resolve([]),
  consume: () => Promise.resolve(),
  markAttempt: () => Promise.resolve(),
  clear: () => Promise.resolve(),
  setEnabled: () => undefined,
};

/**
 * Adapts the native module, or stands in for it where there is none.
 *
 * @param binding - The native module, or null on a platform without one.
 * @returns Ports the drain and the lifecycle can both use.
 */
export function createStashAccess(binding: StashBinding | null): StashAccess {
  if (binding === null) return absent;
  return {
    list: () => binding.listStashedMessages(),
    consume: (id) => binding.consumeStashedMessage(id),
    markAttempt: (id, requestId) => binding.markStashAttempt(id, requestId),
    clear: () => binding.clearStash(),
    setEnabled: (enabled) => {
      binding.setStashEnabled(enabled);
    },
  };
}

/** The stash on this platform. Empty and inert where no receiver exists. */
export const stash: StashAccess = createStashAccess(OtpSmsConsentModule);
