import { act, renderHook } from '@testing-library/react-native';

import { SubmissionCancelledError } from '../api/authedTypes';
import type { Session } from '../api/importerClient';
import { setOtpSettings } from '../api/importerClient';
import { haptics } from '../lib/haptics';
import {
  beginChannelChange,
  cacheOtpChannel,
  endChannelChange,
  markChannelDirty,
} from '../lib/otpChannelSync';
import { saveChannel, useChannelSave } from './otpSettingsSave';

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
const mockCache = jest.mocked(cacheOtpChannel);
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

  it('does not publish a late cache warning for another importer', async () => {
    let current = true;
    mockSet.mockResolvedValue({ ok: true });
    mockCache.mockImplementation(async () => {
      current = false;
      return false;
    });
    const spies = setup(true);

    await saveChannel({
      connection: SESSION,
      next: 'app',
      previous: 'telegram',
      setChannel: spies.setChannel,
      setError: spies.setError,
      isCurrent: () => current,
    });

    expect(haptics.success).not.toHaveBeenCalled();
    expect(spies.setError).not.toHaveBeenCalledWith(
      'Could not update capture on this device. It will retry automatically.',
    );
  });

  it('gates the queued PUT by its owner', async () => {
    let owner = true;
    let gate: ((start: () => Promise<Response>) => Promise<Response>) | undefined;
    mockSet.mockImplementation(async (_session, _channel, beforeSend) => {
      gate = beforeSend;
      return { ok: true };
    });
    mockCache.mockResolvedValue(true);
    const spies = setup(true);

    await saveChannel({
      connection: SESSION,
      next: 'app',
      previous: 'telegram',
      setChannel: spies.setChannel,
      setError: spies.setError,
      isCurrent: () => owner,
    });

    owner = false;
    const start = jest.fn(() => Promise.resolve({} as Response));
    await expect(gate?.(start)).rejects.toBeInstanceOf(SubmissionCancelledError);
    expect(start).not.toHaveBeenCalled();
  });

  it('reloads a current importer after an ambiguous failure', async () => {
    mockSet.mockRejectedValue(new Error('offline'));
    const reload = jest.fn();
    const spies = setup(true);

    await saveChannel({
      connection: SESSION,
      next: 'app',
      previous: 'telegram',
      setChannel: spies.setChannel,
      setError: spies.setError,
      isCurrent: () => true,
      onAmbiguousFailure: reload,
    });

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('reloads after an ambiguous failure only for the current importer', async () => {
    mockSet.mockRejectedValue(new Error('offline'));
    const reload = jest.fn();
    const spies = setup(true);

    await saveChannel({
      connection: SESSION,
      next: 'app',
      previous: 'telegram',
      setChannel: spies.setChannel,
      setError: spies.setError,
      isCurrent: () => false,
      onAmbiguousFailure: reload,
    });

    expect(reload).not.toHaveBeenCalled();
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

  it('starts only one save when the choice is repeated in one tick', async () => {
    mockSet.mockReturnValue(
      new Promise<Awaited<ReturnType<typeof setOtpSettings>>>(() => undefined),
    );
    const { result } = await renderHook(() =>
      useChannelSave({
        connection: SESSION,
        channel: 'telegram',
        setChannel: jest.fn(),
        reload: jest.fn(),
      }),
    );

    await act(async () => {
      void result.current.choose('app');
      void result.current.choose('app');
      await Promise.resolve();
    });

    expect(mockSet).toHaveBeenCalledTimes(1);
  });

  it('releases the guard after a failed save', async () => {
    mockSet.mockResolvedValueOnce({ ok: false, error: 'nope' }).mockResolvedValueOnce({ ok: true });
    const { result } = await renderHook(() =>
      useChannelSave({
        connection: SESSION,
        channel: 'telegram',
        setChannel: jest.fn(),
        reload: jest.fn(),
      }),
    );

    await act(async () => {
      await result.current.choose('app');
    });
    await act(async () => {
      await result.current.choose('app');
    });

    expect(mockSet).toHaveBeenCalledTimes(2);
  });

  it('keeps each importer pending while another save runs', async () => {
    mockSet.mockReturnValue(
      new Promise<Awaited<ReturnType<typeof setOtpSettings>>>(() => undefined),
    );
    const other: Session = { baseUrl: 'https://other.example', token: 'tok' };
    const { result, rerender } = await renderHook(
      ({ connection }: { connection: Session }) =>
        useChannelSave({
          connection,
          channel: 'telegram',
          setChannel: jest.fn(),
          reload: jest.fn(),
        }),
      { initialProps: { connection: SESSION } },
    );

    await act(async () => {
      void result.current.choose('app');
      await Promise.resolve();
    });
    await rerender({ connection: other });
    await act(async () => {
      void result.current.choose('app');
      await Promise.resolve();
    });

    await rerender({ connection: SESSION });
    expect(result.current.saving).toBe(true);

    await act(async () => {
      void result.current.choose('app');
      await Promise.resolve();
    });
    expect(mockSet).toHaveBeenCalledTimes(2);
  });

  it('does not make a second importer look busy or failed', async () => {
    mockSet.mockResolvedValueOnce({ ok: false, error: 'nope' });
    const other: Session = { baseUrl: 'https://other.example', token: 'tok' };
    const { result, rerender } = await renderHook(
      ({ connection }: { connection: Session }) =>
        useChannelSave({
          connection,
          channel: 'telegram',
          setChannel: jest.fn(),
          reload: jest.fn(),
        }),
      { initialProps: { connection: SESSION } },
    );

    await act(async () => {
      await result.current.choose('app');
    });
    expect(result.current.saveError).toBe('nope');

    await rerender({ connection: other });

    expect(result.current.saving).toBe(false);
    expect(result.current.saveError).toBeNull();
  });

  it('leaves another importer free to save while one is pending', async () => {
    mockSet.mockReturnValue(
      new Promise<Awaited<ReturnType<typeof setOtpSettings>>>(() => undefined),
    );
    const other: Session = { baseUrl: 'https://other.example', token: 'tok' };
    const { result, rerender } = await renderHook(
      ({ connection }: { connection: Session }) =>
        useChannelSave({
          connection,
          channel: 'telegram',
          setChannel: jest.fn(),
          reload: jest.fn(),
        }),
      { initialProps: { connection: SESSION } },
    );

    await act(async () => {
      void result.current.choose('app');
      await Promise.resolve();
    });
    expect(result.current.saving).toBe(true);

    await rerender({ connection: other });
    await act(async () => {
      void result.current.choose('app');
      await Promise.resolve();
    });

    expect(mockSet).toHaveBeenCalledTimes(2);
  });
});
