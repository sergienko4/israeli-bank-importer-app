/**
 * Proves the channel the receiver acts on comes from the importer, and that the
 * native flag is re-synced whether or not that read succeeded.
 */
import { getOtpSettings } from '../api/importerClient';
import { saveOtpChannel } from './otpChannelStore';
import { cacheOtpChannel, refreshOtpChannel } from './otpChannelSync';
import { applyStashGate } from './otpStashGate';

jest.mock('../api/importerClient', () => ({ getOtpSettings: jest.fn() }));
jest.mock('./otpChannelStore', () => ({ saveOtpChannel: jest.fn() }));
jest.mock('./otpStashGate', () => ({ applyStashGate: jest.fn() }));

const mockGet = jest.mocked(getOtpSettings);
const mockSave = jest.mocked(saveOtpChannel);
const mockGate = jest.mocked(applyStashGate);

const session = { baseUrl: 'https://importer.example', token: 't' };

beforeEach(() => {
  jest.resetAllMocks();
  mockGate.mockResolvedValue({ allowed: false, pushed: true });
  mockSave.mockResolvedValue(undefined);
});

describe('cacheOtpChannel', () => {
  it('records the channel so the receiver can read it with no session', async () => {
    await cacheOtpChannel('telegram');

    expect(mockSave).toHaveBeenCalledWith('telegram');
  });

  it('re-applies the capture gate so the receiver follows the new channel', async () => {
    await cacheOtpChannel('telegram');

    expect(mockGate).toHaveBeenCalledTimes(1);
  });

  it('still re-applies the gate when the cache could not be written', async () => {
    mockSave.mockRejectedValue(new Error('keystore locked'));

    await expect(cacheOtpChannel('app')).resolves.toBeUndefined();
    expect(mockGate).toHaveBeenCalledTimes(1);
  });
});

describe('refreshOtpChannel', () => {
  it('caches the channel the importer reports', async () => {
    mockGet.mockResolvedValue({ channel: 'telegram' });

    await refreshOtpChannel(session);

    expect(mockSave).toHaveBeenCalledWith('telegram');
  });

  it('keeps the last known channel when the importer cannot be reached', async () => {
    mockGet.mockRejectedValue(new Error('offline'));

    await refreshOtpChannel(session);

    expect(mockSave).not.toHaveBeenCalled();
  });

  it('still re-applies the gate when the read failed', async () => {
    mockGet.mockRejectedValue(new Error('offline'));

    await refreshOtpChannel(session);

    expect(mockGate).toHaveBeenCalledTimes(1);
  });

  it('applies the gate once when the read succeeded', async () => {
    mockGet.mockResolvedValue({ channel: 'app' });

    await refreshOtpChannel(session);

    expect(mockGate).toHaveBeenCalledTimes(1);
  });
});
