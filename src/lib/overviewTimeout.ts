const OVERVIEW_TIMEOUT_MS = 10_000;
const OVERVIEW_TIMEOUT_MESSAGE = 'Overview refresh timed out.';

/**
 * Bounds overview loading so the dashboard never spins forever on a hung importer.
 * @param operation - The overview request promise.
 * @returns The operation result before the timeout.
 * @throws Error when the overview timeout elapses first.
 */
export async function withOverviewTimeout<T>(operation: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(OVERVIEW_TIMEOUT_MESSAGE));
        }, OVERVIEW_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

/**
 * Checks whether an error came from the Home overview timeout guard.
 * @param error - The caught error value.
 * @returns True when the error is the overview timeout.
 */
export function isOverviewTimeout(error: unknown): boolean {
  return error instanceof Error && error.message === OVERVIEW_TIMEOUT_MESSAGE;
}
