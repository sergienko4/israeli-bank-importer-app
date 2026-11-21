import { renderHook } from '@testing-library/react-native';

import { useLatestRef } from './useLatestRef';

describe('useLatestRef', () => {
  it('tracks the latest render value', async () => {
    const { result, rerender } = await renderHook<{ current: number }, { value: number }>(
      ({ value }) => useLatestRef(value),
      { initialProps: { value: 1 } },
    );

    expect(result.current.current).toBe(1);
    await rerender({ value: 2 });
    expect(result.current.current).toBe(2);
  });
});
