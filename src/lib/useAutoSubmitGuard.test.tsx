import { act, renderHook } from '@testing-library/react-native';

import { useAutoSubmitGuard } from './useAutoSubmitGuard';

describe('useAutoSubmitGuard', () => {
  it('keeps the used flag and invalidates the attempt on demand', async () => {
    const { result } = await renderHook(() => useAutoSubmitGuard(false));

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
    const { result, unmount } = await renderHook(() => useAutoSubmitGuard(false));
    const attempt = result.current.currentAttempt();
    const token = attempt.token;

    await unmount();

    expect(attempt.isCurrent(token)).toBe(false);
  });
});
