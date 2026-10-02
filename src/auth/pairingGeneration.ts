/**
 * Numbers the pairing storage holds, so work that outlives a change can tell.
 *
 * Background capture loads a session, then reads the held messages and the
 * importer's pending request before it sends a code. A sign-in or a Disconnect
 * can land in that gap, and a code sent over the session loaded before it would
 * go to an importer the user has just moved away from — possibly a code the
 * bank sent for the new one. The number changes with every such change, so a
 * send can compare the pairing its session was loaded for with the one in
 * force at the moment it starts.
 *
 * Kept on its own, with nothing imported, because the send path and the
 * pairing changes sit on opposite sides of an import chain that would otherwise
 * loop back on itself.
 */

let changes = 0;

/**
 * Names the pairing in force now.
 *
 * Read under the refresh lock together with the stored pair, the number names
 * that pair: every change to the pairing happens under the same lock.
 * @returns The current pairing's number; it only ever grows.
 */
export function currentPairing(): number {
  return changes;
}

/**
 * Marks the pairing as replaced or removed.
 *
 * Called under the refresh lock, before storage is written, so a send that
 * starts while the new pairing is being stored already sees the change.
 */
export function changePairing(): void {
  changes += 1;
}
