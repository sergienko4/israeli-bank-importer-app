import type { StashBinding } from './otpStashSource';
import { createStashAccess } from './otpStashSource';

/**
 * The adapter between the native stash and the pure drain.
 *
 * The module is optional — it does not exist on iOS, on web, or in a build made
 * without the auto-read flag — so "absent" has to behave like "nothing is
 * held", never like an error. A throw here would surface on an ordinary poll
 * tick on every platform that has no receiver at all.
 */

const NATIVE = {
  id: 'msg-1',
  body: 'Your code is 481920',
  sender: '+972500000000',
  receivedAt: 1_700_000_000_000,
  attempted: ['req-0'],
};

/**
 * Builds a binding that records every call made through it.
 *
 * @param overrides - Methods to replace.
 * @returns The binding plus the recorded calls.
 */
function binding(overrides: Partial<StashBinding> = {}) {
  const consumed: string[] = [];
  const attempts: { id: string; requestId: string }[] = [];
  const enabled: boolean[] = [];
  let cleared = 0;
  const base: StashBinding = {
    listStashedMessages: () => Promise.resolve([NATIVE]),
    consumeStashedMessage: (id) => {
      consumed.push(id);
      return Promise.resolve();
    },
    markStashAttempt: (id, requestId) => {
      attempts.push({ id, requestId });
      return Promise.resolve();
    },
    clearStash: () => {
      cleared += 1;
      return Promise.resolve();
    },
    setStashEnabled: (value) => {
      enabled.push(value);
    },
    ...overrides,
  };
  return { binding: base, consumed, attempts, enabled, cleared: () => cleared };
}

describe('createStashAccess with a native module', () => {
  it('hands the held messages over unchanged', async () => {
    const { binding: b } = binding();

    await expect(createStashAccess(b).list()).resolves.toEqual([
      {
        id: 'msg-1',
        body: 'Your code is 481920',
        sender: '+972500000000',
        receivedAt: 1_700_000_000_000,
        attempted: ['req-0'],
      },
    ]);
  });

  it('forwards a consumed message by id', async () => {
    const { binding: b, consumed } = binding();

    await createStashAccess(b).consume('msg-1');
    expect(consumed).toEqual(['msg-1']);
  });

  it('forwards an attempt with the request it was made against', async () => {
    const { binding: b, attempts } = binding();

    await createStashAccess(b).markAttempt('msg-1', 'req-1');
    expect(attempts).toEqual([{ id: 'msg-1', requestId: 'req-1' }]);
  });

  it('forwards the preference mirror both ways', () => {
    const { binding: b, enabled } = binding();
    const access = createStashAccess(b);

    access.setEnabled(true);
    access.setEnabled(false);
    expect(enabled).toEqual([true, false]);
  });

  it('forwards a clear', async () => {
    const { binding: b, cleared } = binding();

    await createStashAccess(b).clear();
    expect(cleared()).toBe(1);
  });
});

describe('createStashAccess without a native module', () => {
  it('reports nothing held rather than failing', async () => {
    await expect(createStashAccess(null).list()).resolves.toEqual([]);
  });

  it('accepts every write as a no-op', async () => {
    const access = createStashAccess(null);

    await expect(access.consume('msg-1')).resolves.toBeUndefined();
    await expect(access.markAttempt('msg-1', 'req-1')).resolves.toBeUndefined();
    await expect(access.clear()).resolves.toBeUndefined();
    expect(() => {
      access.setEnabled(true);
    }).not.toThrow();
  });
});
