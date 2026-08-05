/**
 * Puts a ceiling on work that has no deadline of its own.
 *
 * The background one-time-code paths run with nobody watching, and the calls
 * underneath them can wait forever: the importer requests go through `authed`
 * in `importerClient.ts`, which uses a bare `fetch`, and React Native builds
 * its HTTP client with no read timeout. A server that accepts the connection
 * and then says nothing would hang the caller indefinitely.
 *
 * Two separate things need protecting from that, which is why this is shared
 * rather than written twice: the wake-up itself, which would otherwise hold the
 * device awake until Android tore it down, and the lock that stops two drains
 * running at once, which would otherwise stay held for the life of the process.
 *
 * This module deliberately imports nothing, so anything may depend on it.
 */

/**
 * How long one wake-up may take before it gives up and returns.
 *
 * Enforced rather than assumed — see above for why nothing underneath enforces
 * it. It sits below {@link TASK_TIMEOUT_MS} so the task ends by returning
 * rather than by being torn down, which is what lets the wake lock be released
 * in order.
 */
export const TASK_BUDGET_MS = 45_000;

/**
 * Must match `TASK_TIMEOUT_MS` in `OtpSmsAutoReadService.kt`.
 *
 * The backstop for a task that never returns at all. Everything above finishes
 * inside {@link TASK_BUDGET_MS}; the gap between the two is margin, because
 * that budget is a JavaScript timer and a JavaScript timer only fires when the
 * thread next gets round to it. The test beside this file pins the ordering.
 */
export const TASK_TIMEOUT_MS = 60_000;

/**
 * The most a single send may take when the run has room to spare.
 *
 * This is a cap on the healthy case, not the safety property: the run derives
 * the deadline it actually uses from what is left of its lease, because the
 * reads before the send have no deadline of their own and a fixed constant
 * would compose with them into something longer than the lease itself. What
 * this bounds is a send that starts early and then hangs, so a drain in a
 * pocket gives up while the answer could still matter.
 */
export const SUBMIT_DEADLINE_MS = 30_000;

/**
 * The room a send is given to record what it did before its lease is up.
 *
 * A send abandoned with no room left to acknowledge is worse than one never
 * made: the lock releases with the message still on offer and the next drain
 * sends the same code. What is being reserved for is one write per copy of the
 * code being held, and two for any copy whose first write fails, so a stash at
 * its cap needs a few tens of native writes. Each is a preference file rewrite
 * costing single-digit milliseconds, which this leaves room for many times over.
 */
export const ACK_MARGIN_MS = 5_000;

/**
 * The least time worth starting a send in.
 *
 * A run reaching the send with almost nothing left has just spent its whole
 * lease on reads, so the link is demonstrably slow and a send squeezed into
 * what remains is near-certain to be abandoned. That is not unsafe — it is
 * acknowledged either way — but it spends the held message to no purpose.
 * Refusing leaves it for a run with a full lease behind it.
 */
export const MIN_SEND_MS = 5_000;

/**
 * Waits for work to finish, and stops waiting once the deadline passes.
 *
 * Abandoning work is not the same as cancelling it: whatever was in flight
 * carries on, and a request already sent may still be answered. That is the
 * point — the caller gets its thread back and can end tidily, while nothing
 * pretends to know what became of the work. Callers that could have left
 * something half-done are responsible for saying so.
 *
 * A rejection is contained rather than propagated, because both callers are
 * ends of the line: one is a React Native headless task, which is never told a
 * rejected task has finished and so holds the wake lock until Android's own
 * timeout, and the other is a lock being released.
 *
 * @param work - The work to wait on. Already started by the caller.
 * @param ms - How long to wait before abandoning it.
 */
export async function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  let expire: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    expire = setTimeout(resolve, ms);
  });
  try {
    await Promise.race([contained(work), deadline]);
  } finally {
    clearTimeout(expire);
  }
}

/**
 * Waits for work, treating a failure as merely being finished with it.
 *
 * @param work - The work being waited on.
 */
async function contained(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // Whoever started this work owns its failure. All that is needed here is
    // to know it has stopped.
  }
}
