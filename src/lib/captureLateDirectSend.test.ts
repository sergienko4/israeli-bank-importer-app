/**
 * Regression tests for a direct send that would start after the SMS task has
 * returned.
 *
 * The task stops waiting for its work once its budget is spent and returns,
 * and with that the foreground service no longer keeps the process running. A
 * send still waiting its turn behind a switch write, or reached only after a
 * slow session load or request fetch, would then start in a process Android
 * may stop or freeze at any moment. It must not start at all.
 */
import * as SecureStore from 'expo-secure-store';

import { getPendingOtpUnattended, submitOtpUnattended } from '../api/importerClient';
import type { Connection } from '../auth/connectionStore';
import { processLedger } from '../auth/tokenLedger';
import { writeSwitch } from './otpCaptureSwitch';
import { RENEWAL_GRACE_MS, TASK_BUDGET_MS } from './otpDeadline';
import { runOtpSmsTask } from './otpHeadlessTask';
import { drainHeldMessages } from './otpStashRunner';

jest.mock('expo-secure-store');
jest.mock('../api/importerClient', () => ({
  getPendingOtpUnattended: jest.fn(),
  submitOtpUnattended: jest.fn(),
}));
jest.mock('./biometrics', () => ({ authenticateBiometric: jest.fn() }));
jest.mock('./otpStashRunner', () => ({ drainHeldMessages: jest.fn() }));

const mockedGet = jest.mocked(SecureStore.getItemAsync);
const mockedPending = jest.mocked(getPendingOtpUnattended);
const mockedSubmit = jest.mocked(submitOtpUnattended);

// The real session loader captured the real clock when it was imported, before
// any fake timers, so the fake clock starts at the real time to agree with it.
const NOW = Date.now();
const BODY = 'Your code is 481920';
const CONNECTION_KEY = 'importer.connection.v2';
/** Long enough for the task to return, renewal grace included. */
const TASK_OVER_MS = TASK_BUDGET_MS + RENEWAL_GRACE_MS;
const LIVE = { id: 'req-1', bankId: 'onezero', createdAt: NOW, deadline: NOW + 600_000 };
const CONNECTION: Connection = {
  baseUrl: 'https://a.example.ts.net',
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: NOW + 15 * 60_000,
};

let storage: Map<string, string>;
/** Frees everything a test stalled, so one failing test cannot stall the next. */
let releases: (() => void)[];

/**
 * A promise the test settles by hand.
 * @returns The promise, and the function that resolves it.
 */
function stalled<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/**
 * Holds the switch queue the way a slow switch write would.
 * @returns Lets the write finish, and with it the queue behind it.
 */
function holdSwitchQueue(): () => Promise<void> {
  const write = stalled<undefined>();
  const writing = writeSwitch(() => write.promise);
  releases.push(() => {
    write.resolve(undefined);
  });
  return async () => {
    write.resolve(undefined);
    await writing;
  };
}

/**
 * Runs the task until it has returned, renewal grace included.
 * @returns Resolves once the task's promise has settled.
 */
async function runTaskToReturn(): Promise<void> {
  let returned = false;
  const task = runOtpSmsTask({ body: BODY }).then(() => {
    returned = true;
  });
  await jest.advanceTimersByTimeAsync(TASK_OVER_MS);
  expect(returned).toBe(true);
  await task;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  jest.resetAllMocks();
  processLedger.forget();
  storage = new Map([
    ['otp.autoRead.v1', 'true'],
    ['otp.autoSubmit.v1', 'true'],
    ['otp.channel.v1', 'app'],
    [CONNECTION_KEY, JSON.stringify(CONNECTION)],
  ]);
  mockedGet.mockImplementation((key) => Promise.resolve(storage.get(key) ?? null));
  mockedPending.mockResolvedValue([LIVE]);
  mockedSubmit.mockResolvedValue({ ok: true });
  jest.mocked(drainHeldMessages).mockResolvedValue('empty');
  releases = [];
});

afterEach(() => {
  for (const release of releases) release();
  jest.useRealTimers();
});

describe('a direct send that would start after the SMS task returned', () => {
  it('is not sent when the switch queue frees after the task returned', async () => {
    let release: () => Promise<void> = () => Promise.resolve();
    mockedPending.mockImplementation(() => {
      release = holdSwitchQueue();
      return Promise.resolve([LIVE]);
    });

    await runTaskToReturn();
    await release();
    await jest.advanceTimersByTimeAsync(0);

    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it('is not sent when the session load finishes after the task returned', async () => {
    const load = stalled<string | null>();
    releases.push(() => {
      load.resolve(null);
    });
    mockedGet.mockImplementation((key) =>
      key === CONNECTION_KEY ? load.promise : Promise.resolve(storage.get(key) ?? null),
    );

    await runTaskToReturn();
    load.resolve(JSON.stringify(CONNECTION));
    await jest.advanceTimersByTimeAsync(0);

    expect(mockedPending).toHaveBeenCalledTimes(1);
    expect(mockedSubmit).not.toHaveBeenCalled();
  });

  it('is not sent when the request fetch finishes after the task returned', async () => {
    const fetch = stalled<(typeof LIVE)[]>();
    releases.push(() => {
      fetch.resolve([]);
    });
    mockedPending.mockReturnValue(fetch.promise);

    await runTaskToReturn();
    fetch.resolve([LIVE]);
    await jest.advanceTimersByTimeAsync(0);

    expect(mockedSubmit).not.toHaveBeenCalled();
  });
});

describe('a direct send that starts while the task still waits', () => {
  it('is sent once', async () => {
    await runTaskToReturn();

    expect(mockedSubmit).toHaveBeenCalledTimes(1);
    expect(mockedSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: CONNECTION.baseUrl }),
      LIVE.id,
      '481920',
    );
  });
});
