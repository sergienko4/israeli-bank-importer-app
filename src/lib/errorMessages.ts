/**
 * The words the app uses when something goes wrong.
 *
 * They live together, and apart from React, for two reasons. Scattered string
 * literals are how a message like "Could not load status (500)" reaches a user
 * who has no idea what 500 means and no idea what to do about it. And the app
 * has no rendering tests, so collecting the wording here is the only way it can
 * be held to a standard automatically.
 *
 * Every message says what happened and what the reader can do next. None of
 * them blames the reader, quotes a status code, or uses a word like "invalid"
 * that reads as an accusation.
 */

/** What went wrong, in terms the app can act on. */
export type FailureCause =
  | 'signed-out'
  | 'refused'
  | 'unavailable'
  | 'too-busy'
  | 'unreachable'
  | 'timed-out'
  | 'unexpected-reply';

/** What the user is told, and why they are being told it. */
export interface FailureMessage {
  /** One sentence: what happened, then what to do. */
  text: string;
  /** True when retrying the same thing can plausibly work. */
  isRetryable: boolean;
}

const MESSAGES: Record<FailureCause, FailureMessage> = {
  'signed-out': {
    text: 'Your session has ended. Sign in again to continue.',
    isRetryable: false,
  },
  refused: {
    text: 'The importer would not accept that. Check the details and try again.',
    isRetryable: true,
  },
  unavailable: {
    text: 'The importer is not answering right now. Try again in a moment.',
    isRetryable: true,
  },
  'too-busy': {
    text: 'Too many attempts. Wait a minute, then try again.',
    isRetryable: true,
  },
  unreachable: {
    text: 'Could not reach the importer. Check that it is running and try again.',
    isRetryable: true,
  },
  'timed-out': {
    text: 'The importer took too long to answer. Try again.',
    isRetryable: true,
  },
  'unexpected-reply': {
    text: 'The importer sent something this app could not read. Try again.',
    isRetryable: true,
  },
};

/**
 * Turns an HTTP status into a cause the reader can act on.
 *
 * The status itself never reaches the user: 401 and 500 mean nothing to someone
 * looking at a phone, and the two call for completely different responses.
 * @param status - The HTTP status the importer replied with.
 * @returns The cause that status represents.
 */
export function causeOfStatus(status: number): FailureCause {
  if (status === 401 || status === 403) {
    return 'signed-out';
  }
  if (status === 429) {
    return 'too-busy';
  }
  if (status === 503) {
    return 'unavailable';
  }
  if (status >= 500) {
    return 'unavailable';
  }
  return 'refused';
}

/**
 * Looks up what to tell the user about a failure.
 * @param cause - What went wrong.
 * @returns The message and whether retrying is worth offering.
 */
export function failureMessage(cause: FailureCause): FailureMessage {
  return MESSAGES[cause];
}

/**
 * The sentence to show for an HTTP failure.
 * @param status - The HTTP status the importer replied with.
 * @returns The user-facing sentence.
 */
export function messageForStatus(status: number): string {
  return failureMessage(causeOfStatus(status)).text;
}

/** Every message this module can produce, for tests that police the wording. */
export const ALL_FAILURE_MESSAGES: readonly FailureMessage[] = Object.values(MESSAGES);

/**
 * Prefers what the importer reported, falling back when it said nothing usable.
 *
 * A blank message is worse than a generic one: it fills the error slot with
 * nothing, which reads as a glitch rather than a problem the reader can act on.
 * @param reported - Text the importer or a thrown error supplied, if any.
 * @param fallback - Wording to use when the reported text is missing or blank.
 * @returns Text that is always worth showing.
 */
export function reportedOrFallback(reported: string | undefined, fallback: string): string {
  const trimmed = reported?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : fallback;
}
