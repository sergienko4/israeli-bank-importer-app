import { act, renderHook } from '@testing-library/react-native';

import { type Countdown, useAutoSubmitCountdown } from './useAutoSubmitCountdown';

describe('useAutoSubmitCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires the armed code after the cancel window', async () => {
    const onFire = jest.fn();
    const { result } = await renderHook(() =>
      useAutoSubmitCountdown({ requestId: 'a', visible: true, onFire }),
    );

    await act(() => {
      result.current.arm('123456');
    });
    await act(() => {
      jest.advanceTimersByTime(1_000);
    });
    await act(() => {
      jest.advanceTimersByTime(1_000);
    });
    await act(() => {
      jest.advanceTimersByTime(1_000);
    });

    expect(onFire).toHaveBeenCalledWith('123456');
    expect(result.current.pending).toBe(false);
  });

  it('does not fire after cancel', async () => {
    const onFire = jest.fn();
    const { result } = await renderHook(() =>
      useAutoSubmitCountdown({ requestId: 'a', visible: true, onFire }),
    );

    await act(() => {
      result.current.arm('123456');
      result.current.cancel();
    });
    await act(() => {
      jest.advanceTimersByTime(5_000);
    });

    expect(onFire).not.toHaveBeenCalled();
  });

  it('pauses while the sheet is hidden', async () => {
    const onFire = jest.fn();
    const { result, rerender } = await renderHook<Countdown, { visible: boolean }>(
      ({ visible }) => useAutoSubmitCountdown({ requestId: 'a', visible, onFire }),
      { initialProps: { visible: true } },
    );

    await act(() => {
      result.current.arm('123456');
    });
    await rerender({ visible: false });
    await act(() => {
      jest.advanceTimersByTime(5_000);
    });
    expect(onFire).not.toHaveBeenCalled();

    await rerender({ visible: true });
    await act(() => {
      jest.advanceTimersByTime(1_000);
    });
    await act(() => {
      jest.advanceTimersByTime(1_000);
    });
    await act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(onFire).toHaveBeenCalledWith('123456');
  });

  it('does not fire a code armed for another request', async () => {
    const onFire = jest.fn();
    const { result, rerender } = await renderHook<Countdown, { requestId: string }>(
      ({ requestId }) => useAutoSubmitCountdown({ requestId, visible: true, onFire }),
      { initialProps: { requestId: 'a' } },
    );

    await act(() => {
      result.current.arm('123456');
    });
    await rerender({ requestId: 'b' });
    await act(() => {
      jest.advanceTimersByTime(5_000);
    });

    expect(onFire).not.toHaveBeenCalled();
  });
});
