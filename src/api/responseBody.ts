/**
 * Bounds response-body reads by the interactive request deadline.
 *
 * The transport deadline ends when the headers arrive. A response that then
 * stalls its JSON body would leave a screen spinning, so every body read goes
 * through its own deadline. Kept out of the client so the client stays within
 * the project's file-size limit.
 */
import { isRequestTimeout, REQUEST_TIMEOUT_MS, withRequestTimeout } from '../lib/requestTimeout';

/** The shape `toFailure` reads from a non-ok response. */
export interface FailureBody {
  error?: string;
  errors?: string[];
}

/** What a response needs in order to be bounded after its headers arrive. */
interface ResponseDeadline {
  /** The absolute deadline in epoch ms. */
  readonly at: number;
  /** The controller that owns the request, so a stalled body can be aborted. */
  readonly controller: AbortController;
}

/** The deadline and abort handle of each response, set when its headers arrive. */
const deadlines = new WeakMap<Response, ResponseDeadline>();

/**
 * Records the deadline a response's body must finish by.
 * @param res - The response whose headers just arrived.
 * @param deadline - The absolute deadline in epoch ms.
 * @param controller - The controller that can abort the request.
 */
export function markDeadline(res: Response, deadline: number, controller: AbortController): void {
  deadlines.set(res, { at: deadline, controller });
}

/**
 * Reads a response body inside the request deadline.
 * @param res - The response being read.
 * @param read - Consumes the response body.
 * @returns The parsed value.
 * @throws RequestTimeoutError when the body never finishes.
 */
export async function readWithinDeadline<T>(res: Response, read: () => Promise<T>): Promise<T> {
  const deadline = deadlines.get(res);
  const at = deadline?.at ?? Date.now() + REQUEST_TIMEOUT_MS;
  const remaining = Math.max(1, at - Date.now());
  const reading = read();
  try {
    return await withRequestTimeout(reading, remaining);
  } catch (error) {
    if (isRequestTimeout(error)) {
      // The body read holds the stream's reader lock, so cancelling the body
      // directly is a no-op. Aborting the request is what actually stops the
      // native read; the attached handler keeps its rejection from escaping.
      deadline?.controller.abort();
      void reading.catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Keeps only the failure fields with the expected types.
 * @param value - The parsed JSON value.
 * @returns A failure body that is safe to read.
 */
function asFailureBody(value: unknown): FailureBody {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const record = value as Record<string, unknown>;
  const body: FailureBody = {};
  const error = typeof record.error === 'string' ? record.error.trim() : '';
  if (error !== '') {
    body.error = record.error as string;
  }
  if (Array.isArray(record.errors)) {
    const errors = record.errors.filter(
      (item): item is string => typeof item === 'string' && item.trim() !== '',
    );
    if (errors.length > 0) {
      body.errors = errors;
    }
  }
  return body;
}

/**
 * Reads an optional failure body, treating an unreadable one as empty.
 * A timeout is not an unreadable body; it must reach the caller.
 * @param res - The non-ok response.
 * @returns The failure fields, or an empty object.
 */
export async function readJsonOrEmpty(res: Response): Promise<FailureBody> {
  try {
    return asFailureBody(await readWithinDeadline(res, () => res.json()));
  } catch (error) {
    if (isRequestTimeout(error)) {
      throw error;
    }
    return {};
  }
}

/**
 * Reads an optional JSON body, treating an unreadable one as undefined.
 * @param res - The response.
 * @returns The parsed body, or undefined when it could not be read.
 */
export async function readJsonOrUndefined(res: Response): Promise<unknown> {
  try {
    return await readWithinDeadline(res, () => res.json());
  } catch (error) {
    if (isRequestTimeout(error)) {
      throw error;
    }
    return undefined;
  }
}
