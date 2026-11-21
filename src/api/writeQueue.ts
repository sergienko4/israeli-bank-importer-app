/**
 * Serialized write lanes.
 *
 * A timeout only stops the caller from waiting; the server may still apply the
 * write. Starting a second write to the same resource before the first has
 * settled lets an older request overwrite a newer one, so same-resource writes
 * queue while the client sees them. A timed-out write that the server still
 * applies needs versioning on the importer; the lane cannot order that.
 * Unrelated lanes stay separate so one slow resource cannot block another.
 */

/** One serialized write lane. */
export interface WriteQueue {
  /** The promise the next write waits on. */
  tail: Promise<unknown>;
}

/**
 * Builds a write lane that starts settled.
 * @returns The lane.
 */
export function createWriteQueue(): WriteQueue {
  return { tail: Promise.resolve() };
}

/**
 * Runs a write after the lane's current tail.
 * @param queue - The resource lane to join.
 * @param operation - The write to run.
 * @returns The write's result.
 */
export function serializeWrite<T>(queue: WriteQueue, operation: () => Promise<T>): Promise<T> {
  const result = queue.tail.then(operation, operation);
  queue.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/** One lane per OTP request, shared by foreground and background submits. */
const otpWrites = new Map<string, WriteQueue>();

/**
 * Serializes one OTP request's submissions.
 *
 * The prompt and the SMS receiver can both submit for the same request within
 * this JS context; the lane keeps that to one POST at a time and is dropped
 * once it is idle so the map does not grow for the life of the process. A
 * separate runtime still needs the importer to reject a completed request.
 * @param id - The pending request id.
 * @param operation - The submission to run.
 * @returns The submission result.
 */
export function withOtpLane<T>(id: string, operation: () => Promise<T>): Promise<T> {
  let lane = otpWrites.get(id);
  if (lane === undefined) {
    lane = createWriteQueue();
    otpWrites.set(id, lane);
  }
  const result = serializeWrite(lane, operation);
  const tail = lane.tail;
  void result
    .finally(() => {
      if (lane.tail === tail) {
        otpWrites.delete(id);
      }
    })
    .catch(() => undefined);
  return result;
}
