import { act, renderHook } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { Alert } from 'react-native';

import { useGuardedBack, useInvalidFields } from './useInvalidFields';

describe('useInvalidFields', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('blocks an action while a field is invalid', async () => {
    const { result } = await renderHook(() => useInvalidFields());
    const action = jest.fn();

    await act(() => {
      result.current.report('rate', false);
    });
    await act(() => {
      result.current.guard(action);
    });

    expect(action).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  });

  it('runs the action once the field is valid again', async () => {
    const { result } = await renderHook(() => useInvalidFields());
    const action = jest.fn();

    await act(() => {
      result.current.report('rate', false);
      result.current.report('rate', true);
    });
    await act(() => {
      result.current.guard(action);
    });

    expect(action).toHaveBeenCalledTimes(1);
  });

  it('ignores reports after unmount', async () => {
    const { result, unmount } = await renderHook(() => useInvalidFields());

    await unmount();
    await act(() => {
      result.current.report('rate', false);
    });

    expect(result.current.guard).toBeDefined();
  });

  it('asks before discarding an invalid draft on Back', async () => {
    const onBack = jest.fn();
    const { result } = await renderHook(() => useGuardedBack(true, onBack));

    await act(() => {
      result.current();
    });

    expect(onBack).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalled();
  });

  it('goes straight back when no field is invalid', async () => {
    const onBack = jest.fn();
    const { result } = await renderHook(() => useGuardedBack(false, onBack));

    await act(() => {
      result.current();
    });

    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('still guards after a StrictMode remount', async () => {
    const { result } = await renderHook(() => useInvalidFields(), {
      wrapper: ({ children }) => <StrictMode>{children}</StrictMode>,
    });
    const action = jest.fn();

    await act(() => {
      result.current.report('rate', false);
    });
    await act(() => {
      result.current.guard(action);
    });

    expect(action).not.toHaveBeenCalled();
  });
});
