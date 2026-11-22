import { act, renderHook } from '@testing-library/react-native';

import { type Countdown, useAutoSubmitCountdown } from './useAutoSubmitCountdown';

/**
 * Advances the countdown by one tick inside an act boundary.
 * @param milliseconds - How much fake time to advance.
 * @returns Once React applied the tick.
 */
async function tick(milliseconds = 1_000): Promise<void> {
  await act(() => {
    jest.advanceTimersByTime(milliseconds);
  });
}

describe('useAutoSubmitCountdown', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('fires the armed code only on the final tick', async () => {
    const onFire = jest.fn();
    const { result } = await renderHook(() =>
      useAutoSubmitCountdown({ requestId: 'a', visible: true, onFire }),
    );

    await act(() => {
      result.current.arm('123456');
    });
    expect(result.current.pending).toBe(true);
    expect(result.current.secondsLeft).toBe(3);

    await tick();
    expect(result.current.secondsLeft).toBe(2);
    expect(onFire).not.toHaveBeenCalled();
    await tick();
    expect(result.current.secondsLeft).toBe(1);
    expect(onFire).not.toHaveBeenCalled();
    await tick();

    expect(onFire).toHaveBeenCalledTimes(1);
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
    });
    expect(result.current.pending).toBe(true);
    await act(() => {
      result.current.cancel();
    });

    await tick();
    await tick();
    await tick();

    expect(onFire).not.toHaveBeenCalled();
  });

  it('pauses while the sheet is hidden and resumes when it returns', async () => {
    const onFire = jest.fn();
    const { result, rerender } = await renderHook<Countdown, { visible: boolean }>(
      ({ visible }) => useAutoSubmitCountdown({ requestId: 'a', visible, onFire }),
      { initialProps: { visible: true } },
    );

    await act(() => {
      result.current.arm('123456');
    });
    expect(result.current.pending).toBe(true);

    await rerender({ visible: false });
    await tick();
    await tick();
    await tick();
    expect(onFire).not.toHaveBeenCalled();

    await rerender({ visible: true });
    await tick();
    await tick();
    await tick();
    expect(onFire).toHaveBeenCalledTimes(1);
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
    expect(result.current.pending).toBe(true);

    await rerender({ requestId: 'b' });
    await tick();
    await tick();
    await tick();

    expect(onFire).not.toHaveBeenCalled();
  });
});
