import { submitOtpUnattended } from '../api/importerClient';
import { changePairing, currentPairing } from '../auth/pairingGeneration';
import { loadOtpAutoRead } from './otpAutoReadStore';
import { loadOtpAutoSubmit } from './otpAutoSubmitStore';
import {
  backgroundCaptureAllowed,
  loadBackgroundCaptureAllowed,
  submitWhileAllowed,
} from './otpBackgroundGate';
import type { CodeSend, PairedSession } from './otpBackgroundSubmit';
import { SendRefusedError, writeSwitch } from './otpCaptureSwitch';
import { loadOtpChannelIsApp } from './otpChannelStore';

jest.mock('../api/importerClient', () => ({ submitOtpUnattended: jest.fn() }));
jest.mock('./otpAutoReadStore', () => ({ loadOtpAutoRead: jest.fn() }));
jest.mock('./otpAutoSubmitStore', () => ({ loadOtpAutoSubmit: jest.fn() }));
jest.mock('./otpChannelStore', () => ({ loadOtpChannelIsApp: jest.fn() }));

const mockSubmit = jest.mocked(submitOtpUnattended);

/**
 * A session loaded for the pairing in force now.
 * @returns The session, labelled with that pairing.
 */
function session() {
  return { baseUrl: 'https://importer.local', token: 't', pairing: currentPairing() };
}

/**
 * A code ready to send over a loaded session.
 * @param loaded - The session the code goes over.
 * @param claim - The caller's answer when the send claims its start.
 * @returns The send, for request `req-1`.
 */
function send(loaded: PairedSession, claim: () => boolean = () => true): CodeSend {
  return { session: loaded, requestId: 'req-1', code: '481920', claim };
}

const mockAutoRead = jest.mocked(loadOtpAutoRead);
const mockAutoSubmit = jest.mocked(loadOtpAutoSubmit);
const mockChannelIsApp = jest.mocked(loadOtpChannelIsApp);

describe('backgroundCaptureAllowed', () => {
  it('allows capture only when both switches are on and this app collects codes', () => {
    expect(backgroundCaptureAllowed(true, true, true)).toBe(true);
  });

  it('refuses when the user turned auto-read off', () => {
    expect(backgroundCaptureAllowed(false, true, true)).toBe(false);
  });

  it('refuses when the user wants to confirm each code', () => {
    expect(backgroundCaptureAllowed(true, false, true)).toBe(false);
  });

  it('refuses when neither switch is on', () => {
    expect(backgroundCaptureAllowed(false, false, true)).toBe(false);
  });

  it('refuses when the importer collects codes over Telegram', () => {
    expect(backgroundCaptureAllowed(true, true, false)).toBe(false);
  });
});

describe('loadBackgroundCaptureAllowed', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    mockChannelIsApp.mockResolvedValue(true);
  });

  it('allows capture when both stored preferences are on', async () => {
    mockAutoRead.mockResolvedValue(true);
    mockAutoSubmit.mockResolvedValue(true);
    await expect(loadBackgroundCaptureAllowed()).resolves.toBe(true);
  });

  it('refuses when the stored auto-read preference is off', async () => {
    mockAutoRead.mockResolvedValue(false);
    mockAutoSubmit.mockResolvedValue(true);
    await expect(loadBackgroundCaptureAllowed()).resolves.toBe(false);
  });

  it('refuses when the stored auto-submit preference is off', async () => {
    mockAutoRead.mockResolvedValue(true);
    mockAutoSubmit.mockResolvedValue(false);
    await expect(loadBackgroundCaptureAllowed()).resolves.toBe(false);
  });

  it('refuses on the Telegram channel even with both switches left on', async () => {
    mockAutoRead.mockResolvedValue(true);
    mockAutoSubmit.mockResolvedValue(true);
    mockChannelIsApp.mockResolvedValue(false);
    await expect(loadBackgroundCaptureAllowed()).resolves.toBe(false);
  });
});

describe('submitWhileAllowed', () => {
  beforeEach(() => {
    mockSubmit.mockReset();
    mockSubmit.mockResolvedValue({ ok: true });
  });

  /**
   * Sets every switch the gate reads.
   *
   * @param on - Whether each one reads as on.
   */
  function switches(on: boolean): void {
    mockAutoRead.mockResolvedValue(on);
    mockAutoSubmit.mockResolvedValue(on);
    mockChannelIsApp.mockResolvedValue(true);
  }

  it('sends the code while the user allows background capture', async () => {
    switches(true);
    const loaded = session();
    await expect(submitWhileAllowed(send(loaded))).resolves.toEqual({ ok: true });
    expect(mockSubmit).toHaveBeenCalledWith(loaded, 'req-1', '481920');
  });

  it('claims its start from the caller in the step that sends it', async () => {
    switches(true);
    const order: string[] = [];
    mockSubmit.mockImplementation(() => {
      order.push('sent');
      return Promise.resolve({ ok: true });
    });

    await submitWhileAllowed(
      send(session(), () => {
        order.push('claimed');
        return true;
      }),
    );

    expect(order).toEqual(['claimed', 'sent']);
  });

  it('sends nothing, and says why, once the caller has stopped waiting for it', async () => {
    switches(true);
    await expect(submitWhileAllowed(send(session(), () => false))).rejects.toBeInstanceOf(
      SendRefusedError,
    );
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('claims nothing for a send the switches refuse', async () => {
    // A claim answered true tells the caller the code has left the device, so
    // asking for one ahead of a refusal would turn "never sent" into "unknown".
    switches(false);
    const claim = jest.fn(() => true);

    await expect(submitWhileAllowed(send(session(), claim))).rejects.toBeInstanceOf(
      SendRefusedError,
    );
    expect(claim).not.toHaveBeenCalled();
  });

  it('claims nothing for a send over a pairing the user has moved away from', async () => {
    switches(true);
    const loaded = session();
    changePairing();
    const claim = jest.fn(() => true);

    await expect(submitWhileAllowed(send(loaded, claim))).rejects.toBeInstanceOf(SendRefusedError);
    expect(claim).not.toHaveBeenCalled();
  });

  it('sends nothing, and says why, once capture is switched off', async () => {
    switches(false);
    await expect(submitWhileAllowed(send(session()))).rejects.toBeInstanceOf(SendRefusedError);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('treats a switch read that failed as switched off', async () => {
    // Any other error would read as a send whose fate is unknown, and spend a
    // code that never left the device.
    switches(true);
    mockAutoRead.mockRejectedValue(new Error('keystore locked'));
    const claim = jest.fn(() => true);

    await expect(submitWhileAllowed(send(session(), claim))).rejects.toBeInstanceOf(
      SendRefusedError,
    );
    expect(claim).not.toHaveBeenCalled();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('decides on a switch-off that was being stored when the send came due', async () => {
    // The capture read the switches before it fetched the request it answers,
    // and the user may have said no in between.
    switches(true);
    let stored: () => void = () => undefined;
    const write = new Promise<void>((resolve) => {
      stored = resolve;
    });
    const storing = writeSwitch(async () => {
      await write;
      switches(false);
    });
    const sending = submitWhileAllowed(send(session()));
    stored();
    await storing;

    await expect(sending).rejects.toBeInstanceOf(SendRefusedError);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('sends nothing over a session loaded before the user signed in elsewhere or disconnected', async () => {
    switches(true);
    const loaded = session();
    changePairing();

    await expect(submitWhileAllowed(send(loaded))).rejects.toBeInstanceOf(SendRefusedError);
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('decides on a pairing change made while the switches were being read', async () => {
    let reading = false;
    let answer: (on: boolean) => void = () => undefined;
    mockAutoRead.mockImplementation(() => {
      reading = true;
      return new Promise<boolean>((resolve) => {
        answer = resolve;
      });
    });
    mockAutoSubmit.mockResolvedValue(true);
    mockChannelIsApp.mockResolvedValue(true);
    const sending = submitWhileAllowed(send(session()));
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    expect(reading).toBe(true);
    changePairing();
    answer(true);

    await expect(sending).rejects.toBeInstanceOf(SendRefusedError);
    expect(mockSubmit).not.toHaveBeenCalled();
  });
});
