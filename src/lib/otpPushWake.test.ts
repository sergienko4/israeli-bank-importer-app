import type { Session } from '../api/importerClient';
import type { PendingOtpRequest } from '../api/otp';
import { type PushWakePorts, wakeAutoReadWindow } from './otpPushWake';

const NOW = 1_700_000_000_000;
const session: Session = { baseUrl: 'https://importer.local', token: 'tok' };

function request(id: string, msFromNow: number): PendingOtpRequest {
  return { id, deadline: NOW + msFromNow } as PendingOtpRequest;
}

function ports(overrides: Partial<PushWakePorts> = {}): PushWakePorts {
  return {
    loadSession: jest.fn().mockResolvedValue(session),
    getPending: jest.fn().mockResolvedValue([]),
    syncWindow: jest.fn().mockResolvedValue(undefined),
    now: () => NOW,
    ...overrides,
  };
}

describe('wakeAutoReadWindow', () => {
  it('opens the window from what the importer reports, not from the push', async () => {
    const pending = [request('a', 60_000)];
    const deps = ports({ getPending: jest.fn().mockResolvedValue(pending) });

    await expect(wakeAutoReadWindow(deps)).resolves.toBe('window-open');

    expect(deps.syncWindow).toHaveBeenCalledWith(pending);
  });

  it('closes the window when the importer is waiting for nothing', async () => {
    const deps = ports();

    await expect(wakeAutoReadWindow(deps)).resolves.toBe('nothing-pending');

    expect(deps.syncWindow).toHaveBeenCalledWith([]);
  });

  it('closes the window when every reported request has already expired', async () => {
    const deps = ports({ getPending: jest.fn().mockResolvedValue([request('a', -1_000)]) });

    await expect(wakeAutoReadWindow(deps)).resolves.toBe('nothing-pending');
  });

  it('closes the window when the device is not paired', async () => {
    const deps = ports({ loadSession: jest.fn().mockResolvedValue(null) });

    await expect(wakeAutoReadWindow(deps)).resolves.toBe('no-session');

    expect(deps.getPending).not.toHaveBeenCalled();
    expect(deps.syncWindow).toHaveBeenCalledWith([]);
  });

  it('leaves an already-open window alone when the importer cannot be reached', async () => {
    // A transient failure must not shut a window a live app opened moments ago:
    // the deadline lapses on its own, so doing nothing is the safe answer.
    const deps = ports({ getPending: jest.fn().mockRejectedValue(new Error('offline')) });

    await expect(wakeAutoReadWindow(deps)).resolves.toBe('failed');

    expect(deps.syncWindow).not.toHaveBeenCalled();
  });
});
