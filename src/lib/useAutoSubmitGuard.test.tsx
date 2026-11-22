import { act, renderHook } from '@testing-library/react-native';

import { type AutoSubmitGuard, useAutoSubmitGuard } from './useAutoSubmitGuard';

describe('useAutoSubmitGuard', () => {
  it('keeps the used flag and invalidates the attempt on demand', async () => {
    const { result } = await renderHook(() => useAutoSubmitGuard(false, 'a'));

    expect(result.current.isUsed()).toBe(false);
    await act(() => {
      result.current.markUsed();
    });
    expect(result.current.isUsed()).toBe(true);

    const attempt = result.current.currentAttempt();
    const token = attempt.token;
    expect(attempt.isCurrent(token)).toBe(true);
    await act(() => {
      result.current.invalidate();
    });
    expect(attempt.isCurrent(token)).toBe(false);
  });

  it('invalidates an outstanding attempt on unmount', async () => {
    const { result, unmount } = await renderHook(() => useAutoSubmitGuard(false, 'a'));
    const attempt = result.current.currentAttempt();
    const token = attempt.token;

    await unmount();

    expect(attempt.isCurrent(token)).toBe(false);
  });

  it("restores the parent's used flag when a request returns", async () => {
    const { result, rerender } = await renderHook<
      AutoSubmitGuard,
      { requestId: string; used: boolean }
    >(({ requestId, used }) => useAutoSubmitGuard(used, requestId), {
      initialProps: { requestId: 'a', used: true },
    });
    expect(result.current.isUsed()).toBe(true);

    await rerender({ requestId: 'b', used: false });
    expect(result.current.isUsed()).toBe(false);

    await rerender({ requestId: 'a', used: true });
    expect(result.current.isUsed()).toBe(true);
  });

  it('resets the used flag and attempt for a different request', async () => {
    const { result, rerender } = await renderHook<AutoSubmitGuard, { requestId: string }>(
      ({ requestId }) => useAutoSubmitGuard(false, requestId),
      { initialProps: { requestId: 'a' } },
    );

    await act(() => {
      result.current.markUsed();
    });
    const attempt = result.current.currentAttempt();
    const token = attempt.token;
    expect(result.current.isUsed()).toBe(true);

    await rerender({ requestId: 'b' });

    expect(result.current.isUsed()).toBe(false);
    expect(attempt.isCurrent(token)).toBe(false);
  });
});
