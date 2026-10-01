/**
 * Property-based tests for reading the stored pairing.
 *
 * A renewal that finds no usable pairing tells the user why it ended, and
 * "this device was disconnected" is only true when nothing is stored. So for
 * any value the secure store can hold, the read must say "empty" exactly when
 * there is no entry, "paired" exactly when the entry is a whole connection, and
 * "damaged" for everything else — an empty string included, since the store
 * answers null only for a missing key.
 */
import * as SecureStore from 'expo-secure-store';
import * as fc from 'fast-check';

import { type Connection, readConnection, saveConnection } from './connectionStore';

jest.mock('expo-secure-store');

const mocked = SecureStore as jest.Mocked<typeof SecureStore>;

const CONNECTION_KEY = 'importer.connection.v2';

const REQUIRED_FIELDS = ['baseUrl', 'accessToken', 'refreshToken', 'expiresAt'] as const;

/** What the store holds under the pairing's key, and what reading it must report. */
type Case =
  | { readonly raw: null; readonly expected: { state: 'empty' } }
  | { readonly raw: string; readonly expected: { state: 'paired'; connection: Connection } }
  | { readonly raw: string; readonly expected: { state: 'damaged' } };

const connectionArb: fc.Arbitrary<Connection> = fc.record({
  baseUrl: fc.string(),
  accessToken: fc.string(),
  refreshToken: fc.string(),
  expiresAt: fc.integer(),
});

/** A whole connection with one required field missing or of the wrong type. */
const partialArb: fc.Arbitrary<string> = fc
  .tuple(connectionArb, fc.constantFrom(...REQUIRED_FIELDS), fc.boolean())
  .map(([connection, field, drop]) => {
    const entry: Record<string, unknown> = { ...connection };
    if (drop) {
      delete entry[field];
    } else {
      entry[field] = field === 'expiresAt' ? String(connection.expiresAt) : 1;
    }
    return JSON.stringify(entry);
  });

const caseArb: fc.Arbitrary<Case> = fc.oneof(
  fc.constant<Case>({ raw: null, expected: { state: 'empty' } }),
  connectionArb.map<Case>((connection) => ({
    raw: JSON.stringify(connection),
    expected: { state: 'paired', connection },
  })),
  fc
    .oneof(fc.constant(''), fc.string(), fc.json(), partialArb)
    .map<Case>((raw) => ({ raw, expected: { state: 'damaged' } })),
);

/**
 * Backs the secure-store mock with a map, answering null only for a missing key.
 * @returns The map the mock reads from and writes to.
 */
function wireSecureStore(): Map<string, string> {
  const store = new Map<string, string>();
  mocked.getItemAsync.mockImplementation(async (key: string) => store.get(key) ?? null);
  mocked.setItemAsync.mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  return store;
}

describe('reading the stored pairing (property)', () => {
  it('reports empty only when nothing is stored, and damaged for anything unusable', async () => {
    await fc.assert(
      fc.asyncProperty(caseArb, async ({ raw, expected }) => {
        const store = wireSecureStore();
        if (raw !== null) store.set(CONNECTION_KEY, raw);

        await expect(readConnection()).resolves.toEqual(expected);
      }),
      { numRuns: 1000 },
    );
  });

  it('reads back every connection it saves', async () => {
    await fc.assert(
      fc.asyncProperty(connectionArb, async (connection) => {
        wireSecureStore();
        await saveConnection(connection);

        await expect(readConnection()).resolves.toEqual({ state: 'paired', connection });
      }),
      { numRuns: 500 },
    );
  });
});
