/** Runs a fetch start inside the caller's ordering gate. */
export type BeforeSend = (start: () => Promise<Response>) => Promise<Response>;

/** What one authenticated request needs beyond its session and path. */
export interface AuthedOptions {
  /** Fetch init (method, body, headers). */
  readonly init?: Omit<RequestInit, 'signal'>;
  /** Wraps the fetch start after the session guard and before each send. */
  readonly beforeSend?: BeforeSend;
}

/** Thrown when a caller's before-send gate withdrew a request. */
export class SubmissionCancelledError extends Error {
  constructor() {
    super('The submission was cancelled before it started.');
    this.name = 'SubmissionCancelledError';
  }
}
