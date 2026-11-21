import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { Session } from '../api/importerClient';
import { getStatus } from '../api/importerClient';
import type { RunEntry } from '../api/status';
import { type StatusData, useStatusData } from './statusData';

jest.mock('../api/importerClient', () => ({
  getStatus: jest.fn(),
}));

const getStatusMock = jest.mocked(getStatus);
const SESSION: Session = { baseUrl: 'https://host:8080', token: 'tok' };
const RUNS: RunEntry[] = [
  {
    timestamp: '2026-11-21T09:00:00.000Z',
    successfulBanks: 1,
    totalBanks: 1,
    failedBanks: 0,
    totalTransactions: 2,
    totalDuplicates: 0,
    totalDuration: 10,
    successRate: 100,
    banks: [],
  },
];

describe('useStatusData', () => {
  beforeEach(() => {
    getStatusMock.mockReset();
  });

  it('loads the runs once per importer', async () => {
    getStatusMock.mockResolvedValue(RUNS);
    const { result, rerender } = await renderHook<StatusData, { session: Session }>(
      ({ session }) => useStatusData(session),
      { initialProps: { session: SESSION } },
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.runs).toEqual(RUNS);

    await rerender({ session: { ...SESSION, token: 'renewed' } });
    expect(getStatusMock).toHaveBeenCalledTimes(1);
  });

  it('reports a failed load and retries it', async () => {
    getStatusMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(RUNS);
    const { result } = await renderHook(() => useStatusData(SESSION));

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });

    await act(() => {
      result.current.reload();
    });
    await waitFor(() => {
      expect(result.current.runs).toEqual(RUNS);
    });
    expect(result.current.error).toBeNull();
  });
});
