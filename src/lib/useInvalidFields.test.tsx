import { act, renderHook } from '@testing-library/react-native';
import { StrictMode } from 'react';
import { Alert } from 'react-native';

import { useInvalidFields } from './useInvalidFields';

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
