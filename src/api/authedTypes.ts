/** What one authenticated request needs beyond its session and path. */
export interface AuthedOptions {
  /** Fetch init (method, body, headers). */
  readonly init?: Omit<RequestInit, 'signal'>;
  /** Re-checks the caller's intent after the session guard before each send. */
  readonly beforeSend?: () => Promise<boolean>;
}

/** Thrown when a caller's before-send gate withdrew a request. */
export class SubmissionCancelledError extends Error {
  constructor() {
    super('The submission was cancelled before it started.');
    this.name = 'SubmissionCancelledError';
  }
}
