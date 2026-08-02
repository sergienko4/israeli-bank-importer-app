/**
 * Reads a response body against the contract instead of trusting it.
 *
 * The app talks to whatever importer the user happens to be running. A build
 * from six months ago can meet an importer released yesterday, and nothing
 * makes the two agree — so a payload that does not match what this app was
 * built against is a case to handle, not an impossibility.
 *
 * Handled means: the user is told the app could not read the reply, in the same
 * words as any other failure, and nothing downstream ever sees a half-shaped
 * object. It never means a parser's own wording reaching a screen.
 *
 * Unknown extra properties are accepted on purpose. A newer importer adding a
 * field is not a reason to refuse a payload this app can otherwise read.
 */

import type { Static, TSchema } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';

import { failureMessage } from '../lib/errorMessages';

/**
 * Parses a response body and checks it against its contract schema.
 * @param res - The response to read.
 * @param schema - The contract schema the body must satisfy.
 * @returns The body, typed by the contract.
 * @throws Error telling the user the reply could not be read.
 */
export async function parsedBody<T extends TSchema>(res: Response, schema: T): Promise<Static<T>> {
  const body: unknown = await res.json().catch(() => undefined);
  if (!Value.Check(schema, body)) {
    throw new Error(failureMessage('unexpected-reply').text);
  }
  return body;
}
