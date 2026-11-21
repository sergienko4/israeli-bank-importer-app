/**
 * Bounds response-body reads by the interactive request deadline.
 *
 * The transport deadline ends when the headers arrive. A response that then
 * stalls its JSON body would leave a screen spinning, so every body read goes
 * through its own deadline. Kept out of the client so the client stays within
 * the project's file-size limit.
 */
import { isRequestTimeout, withRequestTimeout } from '../lib/requestTimeout';

/** The shape `toFailure` reads from a non-ok response. */
export interface FailureBody {
  error?: string;
  errors?: string[];
}

/**
 * Reads a response body inside the request deadline.
 * @param read - Consumes the response body.
 * @returns The parsed value.
 * @throws RequestTimeoutError when the body never finishes.
 */
export async function readWithinDeadline<T>(read: () => Promise<T>): Promise<T> {
  return withRequestTimeout(read());
}

/**
 * Reads an optional failure body, treating an unreadable one as empty.
 * A timeout is not an unreadable body; it must reach the caller.
 * @param res - The non-ok response.
 * @returns The failure fields, or an empty object.
 */
export async function readJsonOrEmpty(res: Response): Promise<FailureBody> {
  try {
    return (await readWithinDeadline(() => res.json())) as FailureBody;
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
    return await readWithinDeadline(() => res.json());
  } catch (error) {
    if (isRequestTimeout(error)) {
      throw error;
    }
    return undefined;
  }
}
