/**
 * Tests for the bridge between the native consent module and the capture seam.
 *
 * These cover the parts that are easy to get wrong and impossible to see on a
 * device: what happens when the OS refuses to open a window, and what happens
 * when the screen closes before the OS has answered.
 */
import { createSmsConsentSource, type SmsConsentBinding } from './smsConsentSource';

/**
 * A binding under test control.
 * @returns The fake binding plus levers to drive and inspect it.
 */
function fakeBinding(): {
  binding: SmsConsentBinding;
  emit: (body: string) => void;
  settleStart: (outcome: 'ok' | 'fail') => Promise<void>;
  calls: () => { started: number; stopped: number; removed: number };
} {
  let listener: ((payload: { body: string }) => void) | null = null;
  let resolveStart: (() => void) | null = null;
  let rejectStart: (() => void) | null = null;
  const counts = { started: 0, stopped: 0, removed: 0 };

  return {
    binding: {
      startListening: () => {
        counts.started += 1;
        return new Promise<void>((resolve, reject) => {
          resolveStart = () => {
            resolve();
          };
          rejectStart = () => {
            reject(new Error('no play services'));
          };
        });
      },
      stopListening: () => {
        counts.stopped += 1;
        return Promise.resolve();
      },
      addListener: (_event, next) => {
        listener = next;
        return {
          remove: () => {
            counts.removed += 1;
            listener = null;
          },
        };
      },
    },
    emit: (body) => {
      listener?.({ body });
    },
    settleStart: async (outcome) => {
      if (outcome === 'ok') {
        resolveStart?.();
      } else {
        rejectStart?.();
      }
      await Promise.resolve();
      await Promise.resolve();
    },
    calls: () => ({ ...counts }),
  };
}

describe('createSmsConsentSource', () => {
  it('is inert when the platform has no consent module', () => {
    const source = createSmsConsentSource(null);
    const bodies: string[] = [];

    const stop = source.start((body) => {
      bodies.push(body);
    });
    stop();

    expect(bodies).toEqual([]);
  });

  it('opens a listening window and forwards the approved message body', async () => {
    const fake = fakeBinding();
    const bodies: string[] = [];

    createSmsConsentSource(fake.binding).start((body) => {
      bodies.push(body);
    });
    await fake.settleStart('ok');
    fake.emit('Your code is 483920');

    expect(fake.calls().started).toBe(1);
    expect(bodies).toEqual(['Your code is 483920']);
  });

  it('closes the window and drops the subscription on stop', async () => {
    const fake = fakeBinding();

    const stop = createSmsConsentSource(fake.binding).start(() => undefined);
    await fake.settleStart('ok');
    stop();
    await Promise.resolve();

    expect(fake.calls().removed).toBe(1);
    expect(fake.calls().stopped).toBe(1);
  });

  it('still closes the window when stop beats the OS answer', async () => {
    const fake = fakeBinding();

    const stop = createSmsConsentSource(fake.binding).start(() => undefined);
    stop();

    // Stopping before the OS replied must not leave a window open natively:
    // the close is queued behind the open, not dropped.
    expect(fake.calls().stopped).toBe(0);
    await fake.settleStart('ok');
    expect(fake.calls().stopped).toBe(1);
  });

  it('degrades to manual entry when the OS refuses to open a window', async () => {
    const fake = fakeBinding();

    const stop = createSmsConsentSource(fake.binding).start(() => undefined);
    await expect(fake.settleStart('fail')).resolves.toBeUndefined();
    stop();
    await Promise.resolve();

    // A refusal is a normal outcome on a device without play services. It must
    // surface as "no capture", never as an unhandled rejection.
    expect(fake.calls().removed).toBe(1);
  });

  it('ignores a second stop', async () => {
    const fake = fakeBinding();

    const stop = createSmsConsentSource(fake.binding).start(() => undefined);
    await fake.settleStart('ok');
    stop();
    stop();
    await Promise.resolve();

    expect(fake.calls().stopped).toBe(1);
    expect(fake.calls().removed).toBe(1);
  });
});
