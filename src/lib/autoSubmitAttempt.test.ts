import { createAutoSubmitAttempt, submitIfCurrent } from './autoSubmitAttempt';

/**
 * Builds a preference read the test can resolve later.
 * @returns The pending read and its resolver.
 */
function deferredRead(): {
  promise: Promise<boolean>;
  resolve: (value: boolean) => void;
} {
  let resolve: (value: boolean) => void = () => undefined;
  const promise = new Promise<boolean>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

describe('createAutoSubmitAttempt', () => {
  it('invalidates captured tokens', () => {
    const attempt = createAutoSubmitAttempt();
    const token = attempt.token;

    expect(attempt.isCurrent(token)).toBe(true);
    attempt.invalidate();
    expect(attempt.isCurrent(token)).toBe(false);
    expect(attempt.isCurrent(attempt.token)).toBe(true);
  });
});

describe('submitIfCurrent', () => {
  it('does not send when the attempt is invalidated during the read', async () => {
    const attempt = createAutoSubmitAttempt();
    const token = attempt.token;
    const preference = deferredRead();
    const sent: string[] = [];

    const result = submitIfCurrent({
      attempt,
      token,
      readPreference: () => preference.promise,
      isStillWanted: () => true,
      send: async (code) => {
        sent.push(code);
      },
      code: '123456',
    });

    attempt.invalidate();
    preference.resolve(true);

    await expect(result).resolves.toBe(false);
    expect(sent).toEqual([]);
  });

  it('sends when the attempt is current and the opt-in is on', async () => {
    const attempt = createAutoSubmitAttempt();
    const sent: string[] = [];

    await expect(
      submitIfCurrent({
        attempt,
        token: attempt.token,
        readPreference: () => Promise.resolve(true),
        isStillWanted: () => true,
        send: async (code) => {
          sent.push(code);
        },
        code: '123456',
      }),
    ).resolves.toBe(true);
    expect(sent).toEqual(['123456']);
  });

  it('does not send after the user opted out', async () => {
    const attempt = createAutoSubmitAttempt();
    const sent: string[] = [];

    await expect(
      submitIfCurrent({
        attempt,
        token: attempt.token,
        readPreference: () => Promise.resolve(false),
        isStillWanted: () => true,
        send: async (code) => {
          sent.push(code);
        },
        code: '123456',
      }),
    ).resolves.toBe(false);
    expect(sent).toEqual([]);
  });

  it('does not send when the prompt is no longer wanted', async () => {
    const attempt = createAutoSubmitAttempt();
    const sent: string[] = [];

    await expect(
      submitIfCurrent({
        attempt,
        token: attempt.token,
        readPreference: () => Promise.resolve(true),
        isStillWanted: () => false,
        send: async (code) => {
          sent.push(code);
        },
        code: '123456',
      }),
    ).resolves.toBe(false);
    expect(sent).toEqual([]);
  });

  it('does not send when the prompt is hidden during the read', async () => {
    const attempt = createAutoSubmitAttempt();
    const preference = deferredRead();
    let wanted = true;
    const sent: string[] = [];

    const result = submitIfCurrent({
      attempt,
      token: attempt.token,
      readPreference: () => preference.promise,
      isStillWanted: () => wanted,
      send: async (code) => {
        sent.push(code);
      },
      code: '123456',
    });

    wanted = false;
    preference.resolve(true);

    await expect(result).resolves.toBe(false);
    expect(sent).toEqual([]);
  });

  it('does not send when the preference cannot be read', async () => {
    const attempt = createAutoSubmitAttempt();
    const sent: string[] = [];

    await expect(
      submitIfCurrent({
        attempt,
        token: attempt.token,
        readPreference: () => Promise.reject(new Error('storage unavailable')),
        isStillWanted: () => true,
        send: async (code) => {
          sent.push(code);
        },
        code: '123456',
      }),
    ).resolves.toBe(false);
    expect(sent).toEqual([]);
  });
});
