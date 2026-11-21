/**
 * Bounds a screen-bound request so a hung importer becomes a visible failure
 * instead of a spinner that never stops.
 *
 * The platform fetch has no useful deadline of its own: a request can sit for
 * minutes on a dead route. Every interactive call goes through
 * {@link withRequestTimeout}; the background OTP path keeps its own tighter
 * deadline in `timedFetch`.
 */

import { failureMessage } from './errorMessages';

/** How long an interactive request may take before the user is told it failed. */
export const REQUEST_TIMEOUT_MS = 15_000;

/** The message shown when the importer never answered. */
export const REQUEST_TIMEOUT_MESSAGE = failureMessage('timed-out').text;

/** A request that outlived its deadline. */
export class RequestTimeoutError extends Error {
  constructor() {
    super(REQUEST_TIMEOUT_MESSAGE);
    this.name = 'RequestTimeoutError';
  }
}

/**
 * Races an operation against a deadline.
 * @param operation - The request promise to bound.
 * @param timeoutMs - The deadline in milliseconds.
 * @returns The operation result when it arrives in time.
 * @throws RequestTimeoutError when the deadline elapses first.
 */
export async function withRequestTimeout<T>(
  operation: Promise<T>,
  timeoutMs: number = REQUEST_TIMEOUT_MS,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new RequestTimeoutError());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Reports whether an error came from a request deadline.
 * @param error - The caught error value.
 * @returns True for a {@link RequestTimeoutError}.
 */
export function isRequestTimeout(error: unknown): boolean {
  return error instanceof RequestTimeoutError;
}
