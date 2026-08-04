import type { PendingOtpRequest } from '../api/otp';
import { autoReadWindowDeadline, syncAutoReadWindow } from './otpAutoReadWindow';
import { loadBackgroundCaptureAllowed } from './otpBackgroundGate';

// Named `mock*` so Jest allows the hoisted factory below to close over them.
// The factory delegates through arrows because it runs during the import phase,
// before these consts are initialised.
const mockOpenWindow = jest.fn();
const mockCloseWindow = jest.fn();

jest.mock('./otpBackgroundGate', () => ({ loadBackgroundCaptureAllowed: jest.fn() }));
jest.mock('../../modules/otp-sms-consent/src/OtpSmsConsentModule', () => ({
  __esModule: true,
  default: {
    openAutoReadWindow: (deadline: number) => {
      mockOpenWindow(deadline);
    },
    closeAutoReadWindow: () => {
      mockCloseWindow();
    },
  },
}));

const mockAllowed = jest.mocked(loadBackgroundCaptureAllowed);

const NOW = 1_700_000_000_000;

function request(id: string, msFromNow: number): PendingOtpRequest {
  return { id, bankId: 'onezero', createdAt: NOW, deadline: NOW + msFromNow };
}

describe('autoReadWindowDeadline', () => {
  it('is closed when nothing is pending', () => {
    expect(autoReadWindowDeadline([], NOW)).toBeNull();
  });

  it('is closed when every pending request has already expired', () => {
    expect(autoReadWindowDeadline([request('a', -1)], NOW)).toBeNull();
  });

  it('opens until the deadline of a live request', () => {
    expect(autoReadWindowDeadline([request('a', 60_000)], NOW)).toBe(NOW + 60_000);
  });

  it('follows the longest deadline, so no pending request is missed', () => {
    const deadline = autoReadWindowDeadline([request('a', 30_000), request('b', 90_000)], NOW);
    expect(deadline).toBe(NOW + 90_000);
  });

  it('ignores an expired request alongside a live one', () => {
    const deadline = autoReadWindowDeadline([request('a', -5_000), request('b', 30_000)], NOW);
    expect(deadline).toBe(NOW + 30_000);
  });

  it('caps a far-future deadline so a stuck request cannot hold it open', () => {
    const deadline = autoReadWindowDeadline([request('a', 48 * 60 * 60 * 1000)], NOW);
    expect(deadline).toBe(NOW + 10 * 60 * 1000);
  });
});

describe('syncAutoReadWindow', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('opens the window when a code is expected and both switches are on', async () => {
    mockAllowed.mockResolvedValue(true);
    await syncAutoReadWindow([request('a', 60_000)], NOW);
    expect(mockOpenWindow).toHaveBeenCalledWith(NOW + 60_000);
  });

  it('keeps the window shut while the user has a switch off', async () => {
    // Android leaves RECEIVE_SMS granted once answered, so this preference is
    // the only thing that can stop the receiver examining messages.
    mockAllowed.mockResolvedValue(false);
    await syncAutoReadWindow([request('a', 60_000)], NOW);
    expect(mockOpenWindow).not.toHaveBeenCalled();
    expect(mockCloseWindow).toHaveBeenCalledTimes(1);
  });

  it('closes the window when nothing is pending, without consulting the switches', async () => {
    mockAllowed.mockResolvedValue(true);
    await syncAutoReadWindow([], NOW);
    expect(mockCloseWindow).toHaveBeenCalledTimes(1);
    expect(mockAllowed).not.toHaveBeenCalled();
  });

  it('lets the newest call win when an older one is still reading the switches', async () => {
    // The poll and the screen teardown both call this. If the teardown's close
    // lands first, the poll's stale open must not put the window back and leave
    // the receiver examining messages for a scrape nobody is watching.
    let allow: (value: boolean) => void = () => undefined;
    mockAllowed.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        allow = resolve;
      }),
    );

    const stale = syncAutoReadWindow([request('a', 60_000)], NOW);
    await syncAutoReadWindow([], NOW);
    allow(true);
    await stale;

    expect(mockOpenWindow).not.toHaveBeenCalled();
    expect(mockCloseWindow).toHaveBeenCalledTimes(1);
  });
});
