import type { AutoReadTogglePorts } from './otpAutoReadToggle';
import { setAutoReadEnabled } from './otpAutoReadToggle';

/**
 * Turning auto-read on is the moment the app asks for a permission that lets it
 * see every incoming message. The rule pinned here is that the stored setting
 * may never claim more than the permission actually allows: a denied request
 * has to leave the setting off, or the user is told a feature is on while it
 * silently does nothing.
 */

/**
 * Builds ports that record what was persisted.
 *
 * @param overrides - Ports to replace.
 * @returns The ports plus the recorded writes.
 */
function ports(overrides: Partial<AutoReadTogglePorts> = {}) {
  const written: boolean[] = [];
  const base: AutoReadTogglePorts = {
    request: () => Promise.resolve('granted' as const),
    persist: (enabled: boolean) => {
      written.push(enabled);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { ports: base, written };
}

describe('setAutoReadEnabled', () => {
  it('stores the setting once the permission is granted', async () => {
    const { ports: p, written } = ports();

    await expect(setAutoReadEnabled(true, p)).resolves.toBe('enabled');
    expect(written).toEqual([true]);
  });

  it('leaves the setting off when the permission is refused', async () => {
    const { ports: p, written } = ports({ request: () => Promise.resolve('denied') });

    await expect(setAutoReadEnabled(true, p)).resolves.toBe('denied');
    expect(written).toEqual([false]);
  });

  it('leaves the setting off when the permission is permanently blocked', async () => {
    const { ports: p, written } = ports({ request: () => Promise.resolve('blocked') });

    await expect(setAutoReadEnabled(true, p)).resolves.toBe('blocked');
    expect(written).toEqual([false]);
  });

  it('turns off without asking for anything', async () => {
    let asked = false;
    const { ports: p, written } = ports({
      request: () => {
        asked = true;
        return Promise.resolve('granted');
      },
    });

    await expect(setAutoReadEnabled(false, p)).resolves.toBe('disabled');
    expect(written).toEqual([false]);
    expect(asked).toBe(false);
  });

  it('reports a failed write rather than assuming it landed', async () => {
    const { ports: p } = ports({ persist: () => Promise.reject(new Error('keystore locked')) });

    await expect(setAutoReadEnabled(true, p)).resolves.toBe('failed');
  });
});
