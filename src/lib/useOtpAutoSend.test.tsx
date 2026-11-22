/**
 * Proves the prompt's opt-in answer is not carried across a closed sheet.
 *
 * The prompt stays mounted while hidden, so a value read before the user
 * changed the setting must not arm the next code on reopen.
 */
import { renderHook, waitFor } from '@testing-library/react-native';

import { loadOtpAutoSubmit } from './otpAutoSubmitStore';
import { useAutoSubmitPreference } from './useOtpAutoSend';

jest.mock('./otpAutoSubmitStore', () => ({ loadOtpAutoSubmit: jest.fn() }));

const mockLoad = jest.mocked(loadOtpAutoSubmit);

describe('useAutoSubmitPreference', () => {
  beforeEach(() => {
    mockLoad.mockReset();
  });

  it('forgets the opt-in while the sheet is hidden', async () => {
    mockLoad.mockResolvedValue(true);
    const { result, rerender } = await renderHook(
      ({ visible }: { visible: boolean }) => useAutoSubmitPreference(visible),
      { initialProps: { visible: true } },
    );
    await waitFor(() => {
      expect(result.current).toBe(true);
    });

    await rerender({ visible: false });

    expect(result.current).toBe(false);
  });

  it('answers false on reopen until the new read lands', async () => {
    mockLoad.mockResolvedValue(true);
    const { result, rerender } = await renderHook(
      ({ visible }: { visible: boolean }) => useAutoSubmitPreference(visible),
      { initialProps: { visible: true } },
    );
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
    await rerender({ visible: false });

    let finishRead: (enabled: boolean) => void = () => undefined;
    mockLoad.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finishRead = resolve;
      }),
    );
    await rerender({ visible: true });

    expect(result.current).toBe(false);

    finishRead(false);
    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });
});
