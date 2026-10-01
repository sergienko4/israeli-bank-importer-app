/**
 * Orders a change to a capture switch against background work that acts on it.
 *
 * Background work reads the switches and then acts: it renews a token or sends
 * a code. With nothing ordering the two, a user who turned capture off while
 * that read was in flight would still see the act that followed it, because the
 * read answered for the moment before. So every switch is written in turn here,
 * and every act starts in turn here straight after a fresh read. An act then
 * either started before the change began, or it sees the change.
 *
 * Only the start waits its turn. A request already on its way cannot be called
 * back, and holding the turn while it runs would leave the user's switch
 * waiting on the network.
 *
 * One queue covers every path because a headless task runs in the same
 * JavaScript runtime as the screen whenever the screen is up.
 */

let tail: Promise<unknown> = Promise.resolve();

/**
 * Runs work once everything queued before it has finished.
 *
 * A failure goes to its own caller and does not block the queue behind it.
 *
 * @param work - What to run alone.
 * @returns Whatever the work returns.
 */
function inTurn<T>(work: () => Promise<T>): Promise<T> {
  const run = tail.then(work);
  tail = run.catch(() => undefined);
  return run;
}

/**
 * Why a background send was refused before it started.
 *
 * Either the switches no longer allowed it, or the pairing it was loaded for
 * had been replaced or removed. Both mean the code never left the device.
 */
export class SendRefusedError extends Error {
  /** Names the refusal, so it survives being caught as a plain error. */
  constructor() {
    super('The send was refused before it started.');
    this.name = 'SendRefusedError';
  }
}

/**
 * Writes a capture switch so that no act decides on the value it replaces.
 *
 * @param write - Stores the switch's new value.
 * @returns Once the value is stored; rejects with whatever the write threw.
 */
export function writeSwitch(write: () => Promise<void>): Promise<void> {
  return inTurn(write);
}

/** An act the switches allowed. It may still be running. */
export interface Started<T> {
  /** What the act settles to. */
  readonly result: Promise<T>;
}

/**
 * Starts an act only if the switches allow it at the moment it starts.
 *
 * The answer comes back wrapped so that the turn ends as soon as the act has
 * started, rather than when it finishes.
 *
 * `current` is checked after the switches are read, in the same step that
 * starts the act, so nothing can change what it reads between the check and
 * the start.
 *
 * @param allowed - Reads the switches.
 * @param act - Starts the act. It is called at most once, in this turn.
 * @param current - Whether what the act was prepared for still holds.
 * @returns The started act, or null when the switches or `current` refused it.
 */
export function startIfAllowed<T>(
  allowed: () => Promise<boolean>,
  act: () => Promise<T>,
  current: () => boolean = () => true,
): Promise<Started<T> | null> {
  return inTurn(async () => ((await allowed()) && current() ? { result: act() } : null));
}
