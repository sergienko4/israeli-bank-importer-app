/**
 * Covers the order between a capture switch changing and background work
 * acting on it. The promise is that once a switch-off is stored, nothing that
 * read the switches before it can still start an act.
 */
import * as SecureStore from 'expo-secure-store';

import { saveOtpAutoRead } from './otpAutoReadStore';
import { saveOtpAutoSubmit } from './otpAutoSubmitStore';
import { CaptureSwitchedOffError, startIfAllowed, writeSwitch } from './otpCaptureSwitch';
import { saveOtpChannel } from './otpChannelStore';

jest.mock('expo-secure-store');

const mockedSetItem = jest.mocked(SecureStore.setItemAsync);

/** A promise the test settles by hand. */
interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: Error) => void;
}

/**
 * Builds a promise the test settles by hand.
 *
 * @returns The promise and the functions that settle it.
 */
function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Lets every promise already queued run.
 *
 * @returns A promise resolving on the event loop's next turn.
 */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => {
      resolve();
    });
  });
}

describe('startIfAllowed', () => {
  it('starts the act when the switches allow it', async () => {
    const act = jest.fn(() => Promise.resolve('sent'));

    const started = await startIfAllowed(() => Promise.resolve(true), act);

    expect(act).toHaveBeenCalledTimes(1);
    await expect(started?.result).resolves.toBe('sent');
  });

  it('starts nothing when the switches refuse it', async () => {
    const act = jest.fn(() => Promise.resolve('sent'));

    await expect(startIfAllowed(() => Promise.resolve(false), act)).resolves.toBeNull();
    expect(act).not.toHaveBeenCalled();
  });

  it('decides on a switch change that was already being stored', async () => {
    let on = true;
    const storing = deferred<undefined>();
    const write = writeSwitch(async () => {
      await storing.promise;
      on = false;
    });
    const act = jest.fn(() => Promise.resolve('sent'));

    const decision = startIfAllowed(() => Promise.resolve(on), act);
    await nextTurn();
    storing.resolve(undefined);
    await write;

    await expect(decision).resolves.toBeNull();
    expect(act).not.toHaveBeenCalled();
  });

  it('holds a switch change until a decision already reading has started its act', async () => {
    // The read may have answered for the moment before the change. Starting
    // the act from it once the change is stored is the race this closes.
    const reading = deferred<boolean>();
    const events: string[] = [];
    const decision = startIfAllowed(
      () => reading.promise,
      () => {
        events.push('act');
        return Promise.resolve();
      },
    );
    const write = writeSwitch(() => {
      events.push('write');
      return Promise.resolve();
    });

    await nextTurn();
    expect(events).toEqual([]);
    reading.resolve(true);
    await Promise.all([decision, write]);

    expect(events).toEqual(['act', 'write']);
  });

  it('does not hold a switch change while the act runs', async () => {
    // A request already on its way cannot be called back, and the user's
    // switch must not wait on the network for it.
    const reply = deferred<string>();
    const started = await startIfAllowed(
      () => Promise.resolve(true),
      () => reply.promise,
    );
    const stored = jest.fn();

    await writeSwitch(() => {
      stored();
      return Promise.resolve();
    });

    expect(stored).toHaveBeenCalledTimes(1);
    reply.resolve('late');
    await expect(started?.result).resolves.toBe('late');
  });

  it('keeps the queue moving past a failed read or write', async () => {
    await expect(
      startIfAllowed(
        () => Promise.reject(new Error('keystore locked')),
        () => Promise.resolve(),
      ),
    ).rejects.toThrow('keystore locked');
    await expect(writeSwitch(() => Promise.reject(new Error('disk full')))).rejects.toThrow(
      'disk full',
    );

    const act = jest.fn(() => Promise.resolve());
    await startIfAllowed(() => Promise.resolve(true), act);
    expect(act).toHaveBeenCalledTimes(1);
  });
});

describe('every capture switch', () => {
  beforeEach(() => {
    mockedSetItem.mockReset();
    mockedSetItem.mockResolvedValue();
  });

  it.each<[string, () => Promise<void>]>([
    ['auto-read', () => saveOtpAutoRead(false)],
    ['auto-submit', () => saveOtpAutoSubmit(false)],
    ['channel', () => saveOtpChannel('telegram')],
  ])(
    'stores the %s switch only after a decision already reading has started its act',
    async (_name, save) => {
      // A switch written straight to storage would land between a read and
      // the act it allowed, and the act would start after the user said no.
      const reading = deferred<boolean>();
      const act = jest.fn(() => Promise.resolve());
      const decision = startIfAllowed(() => reading.promise, act);
      const saving = save();

      await nextTurn();
      const storedWhileReading = mockedSetItem.mock.calls.length;
      reading.resolve(true);
      await Promise.all([decision, saving]);

      expect(storedWhileReading).toBe(0);
      expect(act).toHaveBeenCalledTimes(1);
      expect(mockedSetItem).toHaveBeenCalledTimes(1);
      expect(act.mock.invocationCallOrder[0]).toBeLessThan(
        mockedSetItem.mock.invocationCallOrder[0] ?? 0,
      );
    },
  );
});

describe('CaptureSwitchedOffError', () => {
  it('names itself, so a caller can tell a refusal from a failed request', () => {
    const error = new CaptureSwitchedOffError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('CaptureSwitchedOffError');
  });
});
