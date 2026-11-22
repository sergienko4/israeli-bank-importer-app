/**
 * Renderer tests for the reused OTP prompt: one instance must clear an accepted
 * code and must not carry the one-shot auto-send guard into the next request.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type * as ReactModule from 'react';
import { AccessibilityInfo } from 'react-native';

import { submitOtp } from '../api/importerClient';
import { useAuth } from '../auth/AuthContext';
import { loadOtpAutoSubmit } from '../lib/otpAutoSubmitStore';
import { useOtpCapture } from '../lib/useOtpCapture';
import { ThemeProvider } from '../theme/ThemeContext';
import { OtpPrompt } from './OtpPrompt';

jest.mock('../api/importerClient', () => ({ submitOtp: jest.fn() }));
jest.mock('../auth/AuthContext', () => ({ useAuth: jest.fn() }));
jest.mock('../lib/otpAutoSubmitStore', () => ({ loadOtpAutoSubmit: jest.fn() }));
jest.mock('../lib/useOtpCapture', () => ({ useOtpCapture: jest.fn() }));
jest.mock('../components/ui', () => {
  const { createElement } = jest.requireActual<{
    createElement: (
      type: ReactModule.ComponentType<Record<string, unknown>>,
      props?: Record<string, unknown> | null,
      ...children: ReactModule.ReactNode[]
    ) => ReactModule.ReactElement;
  }>('react');
  const { Pressable, Text, View } = jest.requireActual<{
    Pressable: ReactModule.ComponentType<Record<string, unknown>>;
    Text: ReactModule.ComponentType<Record<string, unknown>>;
    View: ReactModule.ComponentType<Record<string, unknown>>;
  }>('react-native');
  return {
    Sheet: ({ children }: { children: ReactModule.ReactNode }) =>
      createElement(View, null, children),
    Button: ({ title, onPress }: { title: string; onPress: () => void }) =>
      createElement(
        Pressable,
        { accessibilityRole: 'button', accessibilityLabel: title, onPress },
        createElement(Text, null, title),
      ),
    TextField: ({
      label,
      value,
      onChangeText,
    }: {
      label?: string;
      value: string;
      onChangeText: (text: string) => void;
    }) => createElement(View, { accessibilityLabel: label, value, onChangeText }),
  };
});

const mockSubmitOtp = jest.mocked(submitOtp);
const mockUseAuth = jest.mocked(useAuth);
const mockLoad = jest.mocked(loadOtpAutoSubmit);
const SESSION = { baseUrl: 'https://host:8080', token: 'tok' };

/**
 * Builds one pending request.
 * @param id - Request id.
 * @returns The pending request.
 */
function request(id: string): { id: string; bankId: string; createdAt: number; deadline: number } {
  return { id, bankId: 'hapoalim', createdAt: 1, deadline: Date.now() + 60_000 };
}

/**
 * Renders the prompt and returns its callbacks.
 * @param id - Initial request id.
 * @returns The callbacks and render controls.
 */
async function setup(id = 'a'): Promise<{
  onSubmitted: jest.Mock;
  onDismiss: jest.Mock;
  rerender: (nextId: string) => Promise<void>;
}> {
  const onSubmitted = jest.fn();
  const onDismiss = jest.fn();
  const view = await render(
    <ThemeProvider>
      <OtpPrompt request={request(id)} visible onSubmitted={onSubmitted} onDismiss={onDismiss} />
    </ThemeProvider>,
  );
  return {
    onSubmitted,
    onDismiss,
    rerender: async (nextId) => {
      await view.rerender(
        <ThemeProvider>
          <OtpPrompt
            request={request(nextId)}
            visible
            onSubmitted={onSubmitted}
            onDismiss={onDismiss}
          />
        </ThemeProvider>,
      );
    },
  };
}

/**
 * Lets the prompt's asynchronous preference read settle.
 * @returns Once React applied the result.
 */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('OtpPrompt request transitions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSubmitOtp.mockReset().mockResolvedValue({ ok: true });
    mockUseAuth.mockReturnValue({ connection: SESSION } as ReturnType<typeof useAuth>);
    mockLoad.mockReset().mockResolvedValue(true);
    jest.mocked(useOtpCapture).mockReset();
    jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('clears an accepted code before reporting success', async () => {
    mockLoad.mockResolvedValue(false);
    const { onSubmitted } = await setup();
    const input = screen.getByLabelText('OTP code');
    await fireEvent.changeText(input, '123456');
    await fireEvent.press(screen.getByRole('button', { name: 'Submit code' }));

    await waitFor(() => {
      expect(onSubmitted).toHaveBeenCalledWith('a');
    });
    expect(screen.getByLabelText('OTP code').props.value).toBe('');
  });

  it('ignores a send that completes after the request changed', async () => {
    mockLoad.mockResolvedValue(false);
    type SubmitResult = Awaited<ReturnType<typeof submitOtp>>;
    let resolveSend: (result: SubmitResult) => void = () => undefined;
    mockSubmitOtp.mockImplementation(
      () =>
        new Promise<SubmitResult>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const { rerender, onSubmitted } = await setup('a');
    await flush();
    await fireEvent.changeText(screen.getByLabelText('OTP code'), '111111');
    await fireEvent.press(screen.getByRole('button', { name: 'Submit code' }));

    await rerender('b');
    await fireEvent.changeText(screen.getByLabelText('OTP code'), '222222');
    await act(async () => {
      resolveSend({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByLabelText('OTP code').props.value).toBe('222222');
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('drops a send from an earlier visit to the same request', async () => {
    mockLoad.mockResolvedValue(false);
    type SubmitResult = Awaited<ReturnType<typeof submitOtp>>;
    let resolveSend: (result: SubmitResult) => void = () => undefined;
    mockSubmitOtp.mockImplementationOnce(
      () =>
        new Promise<SubmitResult>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const { rerender, onSubmitted } = await setup('a');
    await flush();
    await fireEvent.changeText(screen.getByLabelText('OTP code'), '111111');
    await fireEvent.press(screen.getByRole('button', { name: 'Submit code' }));

    await rerender('b');
    await rerender('a');
    expect(screen.getByRole('button', { name: 'Submit code', busy: false })).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('OTP code'), '333333');
    await act(async () => {
      resolveSend({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByLabelText('OTP code').props.value).toBe('333333');
    expect(onSubmitted).not.toHaveBeenCalled();
  });

  it('resets the guard and clears the code for a different request', async () => {
    const { rerender, onSubmitted } = await setup('a');
    await flush();
    await fireEvent.changeText(screen.getByLabelText('OTP code'), '111111');

    await rerender('b');
    expect(screen.getByLabelText('OTP code').props.value).toBe('');

    await fireEvent.changeText(screen.getByLabelText('OTP code'), '222222');
    await act(() => {
      jest.advanceTimersByTime(1_000);
    });
    await act(() => {
      jest.advanceTimersByTime(1_000);
    });
    await act(() => {
      jest.advanceTimersByTime(1_000);
    });

    await waitFor(() => {
      expect(mockSubmitOtp).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'b', code: '222222' }),
      );
    });
    expect(onSubmitted).toHaveBeenCalledWith('b');
  });
});
