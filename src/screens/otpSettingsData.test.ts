import type { Session } from '../api/importerClient';
import { setOtpSettings } from '../api/importerClient';
import { haptics } from '../lib/haptics';
import { beginChannelChange, endChannelChange, markChannelDirty } from '../lib/otpChannelSync';
import { saveChannel } from './otpSettingsData';

jest.mock('../api/importerClient', () => ({ setOtpSettings: jest.fn() }));
jest.mock('../lib/otpChannelSync', () => ({
  beginChannelChange: jest.fn(),
  cacheOtpChannel: jest.fn(),
  endChannelChange: jest.fn(),
  markChannelDirty: jest.fn(),
  refreshOtpChannel: jest.fn(),
}));
jest.mock('../lib/haptics', () => ({
  haptics: { success: jest.fn(), warning: jest.fn() },
}));

const mockSet = jest.mocked(setOtpSettings);
const SESSION: Session = { baseUrl: 'https://host:8080', token: 'tok' };

/**
 * Builds the callbacks a save uses.
 * @param current - Whether the importer is still current.
 * @returns The spies and request fields.
 */
function setup(current: boolean): {
  setChannel: jest.Mock;
  setError: jest.Mock;
  isCurrent: () => boolean;
} {
  const setChannel = jest.fn();
  const setError = jest.fn();
  return { setChannel, setError, isCurrent: () => current };
}

describe('saveChannel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not roll back another importer after a failed save', async () => {
    mockSet.mockResolvedValue({ ok: false, error: 'nope' });
    const spies = setup(false);

    await saveChannel({
      connection: SESSION,
      next: 'app',
      previous: 'telegram',
      setChannel: spies.setChannel,
      setError: spies.setError,
      isCurrent: spies.isCurrent,
    });

    expect(spies.setChannel).toHaveBeenCalledWith('app');
    expect(spies.setChannel).not.toHaveBeenCalledWith('telegram');
    expect(spies.setError).toHaveBeenCalledWith(null);
    expect(spies.setError).not.toHaveBeenCalledWith('nope');
    expect(markChannelDirty).toHaveBeenCalled();
    expect(haptics.warning).toHaveBeenCalled();
    expect(endChannelChange).toHaveBeenCalled();
    expect(beginChannelChange).toHaveBeenCalled();
  });

  it('rolls a current importer back to the previous channel', async () => {
    mockSet.mockResolvedValue({ ok: false, error: 'nope' });
    const spies = setup(true);

    await saveChannel({
      connection: SESSION,
      next: 'app',
      previous: 'telegram',
      setChannel: spies.setChannel,
      setError: spies.setError,
      isCurrent: spies.isCurrent,
    });

    expect(spies.setChannel).toHaveBeenCalledWith('telegram');
    expect(spies.setError).toHaveBeenCalledWith('nope');
  });
});
