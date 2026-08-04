import type { AutoReadStatePorts, AutoReadTogglePorts } from './otpAutoReadToggle';
import { resolveAutoRead, setAutoReadEnabled } from './otpAutoReadToggle';

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

/**
 * Builds the ports the first read of the switch needs.
 *
 * @param overrides - Ports to replace.
 * @returns The ports plus the recorded writes and gate calls.
 */
function statePorts(overrides: Partial<AutoReadStatePorts> = {}) {
  const written: boolean[] = [];
  let gated = 0;
  const base: AutoReadStatePorts = {
    stored: () => Promise.resolve(true),
    granted: () => Promise.resolve(true),
    persist: (enabled: boolean) => {
      written.push(enabled);
      return Promise.resolve();
    },
    applyGate: () => {
      gated += 1;
      return Promise.resolve(true);
    },
    ...overrides,
  };
  return { ports: base, written, gates: () => gated };
}

describe('resolveAutoRead', () => {
  // Not a no-op: either preference read failing makes the gate compute false
  // and switch capture off while both stored values still say on. Nothing else
  // ever puts it back, so without this the switch reads on over a dead receiver.
  it('pushes the stored setting back down when it and the permission agree', async () => {
    const { ports: p, written, gates } = statePorts();

    await expect(resolveAutoRead(p)).resolves.toBe(true);
    expect(written).toEqual([]);
    expect(gates()).toBe(1);
  });

  // Nothing was reconciled, so nothing can be claimed. Showing on here would be
  // the exact failure the gate push exists to prevent: a switch that promises
  // codes are handled while the receiver may be off.
  it('shows off when that push fails', async () => {
    const { ports: p } = statePorts({ applyGate: () => Promise.reject(new Error('no context')) });

    await expect(resolveAutoRead(p)).resolves.toBe(false);
  });

  it('shows off rather than throwing when a port cannot be read', async () => {
    const {
      ports: p,
      written,
      gates,
    } = statePorts({
      stored: () => Promise.reject(new Error('keystore locked')),
    });

    await expect(resolveAutoRead(p)).resolves.toBe(false);
    expect(written).toEqual([]);
    expect(gates()).toBe(0);
  });

  // The permission check answers false both for "revoked" and for "could not
  // ask", and the repair below wipes every held message. Acting on the second
  // would throw away an opt-in the user never withdrew.
  it('changes nothing when the permission could not be determined', async () => {
    const { ports: p, written, gates } = statePorts({ granted: () => Promise.resolve(null) });

    await expect(resolveAutoRead(p)).resolves.toBe(false);
    expect(written).toEqual([]);
    expect(gates()).toBe(0);
  });

  it('shows off when the setting is off, without touching anything', async () => {
    const { ports: p, written, gates } = statePorts({ stored: () => Promise.resolve(false) });

    await expect(resolveAutoRead(p)).resolves.toBe(false);
    expect(written).toEqual([]);
    expect(gates()).toBe(0);
  });

  // Android tells the app nothing when a grant is taken away in Settings, so
  // this is the only moment the stored setting can be caught claiming more than
  // the permission allows. Leaving it would also leave the receiver's flag on.
  it('turns the setting off when the permission was revoked behind its back', async () => {
    const { ports: p, written, gates } = statePorts({ granted: () => Promise.resolve(false) });

    await expect(resolveAutoRead(p)).resolves.toBe(false);
    expect(written).toEqual([false]);
    expect(gates()).toBe(1);
  });

  // The gate reads the preferences and never the permission, so syncing it
  // while the store still says "on" would switch capture back on.
  it('writes the repair before pushing it down', async () => {
    const order: string[] = [];
    const { ports: p } = statePorts({
      granted: () => Promise.resolve(false),
      persist: () => {
        order.push('persist');
        return Promise.resolve();
      },
      applyGate: () => {
        order.push('gate');
        return Promise.resolve(true);
      },
    });

    await resolveAutoRead(p);
    expect(order).toEqual(['persist', 'gate']);
  });

  it('still shows off when the repair cannot be written', async () => {
    const { ports: p, gates } = statePorts({
      granted: () => Promise.resolve(false),
      persist: () => Promise.reject(new Error('keystore locked')),
    });

    await expect(resolveAutoRead(p)).resolves.toBe(false);
    expect(gates()).toBe(0);
  });
});
