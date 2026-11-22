/**
 * OTP entry prompt: a spring bottom sheet that appears when the importer is
 * waiting for a bank one-time code (app OTP channel). The user types the code
 * and submits it to the importer, which resumes the blocked bank login.
 *
 * The field advertises the platform one-time-code hints so the OS can offer the
 * incoming bank code as a one-tap suggestion: `sms-otp` (not `2fa-app-otp` —
 * the code arrives by SMS, not from an authenticator app) drives Android
 * Autofill, and `oneTimeCode` drives the iOS QuickType bar. Both are hints
 * only, need no permission, and leave manual entry untouched.
 *
 * When the user has opted in, a code that arrives *whole* may be submitted
 * without pressing the button. That path is deliberately fenced in, because a
 * wrong automatic submission spends one of the bank's few attempts:
 *
 * - it needs a fill event ({@link isOtpFillEvent}), so typing never triggers it;
 * - it runs at most once per pending request, so a spoofed code cannot loop and
 *   a rejection drops that request back to manual for good;
 * - it waits {@link AUTO_SUBMIT_DELAY_SECONDS} behind a Cancel button, and
 *   cancelling stops it before anything reaches the network.
 *
 * The countdown is plain text rather than an animation, so it needs no
 * reduced-motion branch: there is no motion to reduce.
 */
import { type ReactElement, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import type { PendingOtpRequest } from '../api/otp';
import { Button, Sheet, TextField } from '../components/ui';
import { haptics } from '../lib/haptics';
import { shouldArmAutoSubmit } from '../lib/otpAutoSubmit';
import { normalizeOtpCodeInput } from '../lib/otpCode';
import {
  AUTO_SUBMIT_DELAY_SECONDS,
  type Countdown,
  useAutoSubmitCountdown,
} from '../lib/useAutoSubmitCountdown';
import { useAutoSubmitGuard } from '../lib/useAutoSubmitGuard';
import { autoFire, useAutoSubmitPreference } from '../lib/useOtpAutoSend';
import { useOtpCapture } from '../lib/useOtpCapture';
import { usePromptLifecycle } from '../lib/useOtpPromptLifecycle';
import { useOtpSubmission } from '../lib/useOtpSubmission';
import { useTheme } from '../theme/ThemeContext';

interface Props {
  /** The pending request to answer. */
  request: PendingOtpRequest;
  /** The pairing generation that owns the request's session. */
  pairing: number;
  /** Whether the prompt sheet is open. */
  visible: boolean;
  /** Whether this request already used its one automatic attempt. */
  autoSubmitUsed?: boolean;
  /** Marks the request as having used its automatic attempt. */
  onAutoSubmitUsed?: () => void;
  /** Called after a successful submit. */
  onSubmitted: (requestId: string) => void;
  /** Called when the user dismisses without submitting. */
  onDismiss: (requestId: string) => void;
}

/** What the OTP sheet body renders. */
interface OtpSheetContentProps {
  /** Current code text. */
  readonly code: string;
  /** The last submission failure. */
  readonly error: string | null;
  /** Whether a code is in flight. */
  readonly submitting: boolean;
  /** The countdown state. */
  readonly countdown: Countdown;
  /** Handles code edits. */
  readonly onChange: (text: string) => void;
  /** Stops an armed automatic send. */
  readonly onCancelAuto: () => void;
  /** Submits the current code. */
  readonly onSubmit: () => void;
  /** Receives the input handle. */
  readonly onInputReady: (input: { focus: () => void } | null) => void;
}

/**
 * Renders the OTP field and its action button.
 * @param props - The code, status, countdown and handlers.
 * @returns The sheet body.
 */
function OtpSheetContent({
  code,
  error,
  submitting,
  countdown,
  onChange,
  onCancelAuto,
  onSubmit,
  onInputReady,
}: Readonly<OtpSheetContentProps>): ReactElement {
  const theme = useTheme();
  return (
    <>
      <Text style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}>
        The importer is waiting for the bank one-time code delivered through the app OTP channel.
      </Text>
      <TextField
        label="OTP code"
        value={code}
        onChangeText={onChange}
        placeholder="123456"
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        icon="keypad-outline"
        error={error}
        onInputReady={onInputReady}
      />
      {countdown.pending ? (
        <View>
          <Text style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}>
            {`Sending this code automatically in ${String(countdown.secondsLeft)}s.`}
          </Text>
          <Button
            title="Cancel auto-send"
            icon="close"
            variant="secondary"
            onPress={onCancelAuto}
          />
        </View>
      ) : (
        <Button title="Submit code" icon="checkmark" loading={submitting} onPress={onSubmit} />
      )}
    </>
  );
}

/**
 * Renders the OTP entry sheet.
 * @param props - The request plus submit/dismiss callbacks.
 * @returns The OTP prompt element.
 */
export function OtpPrompt({
  request,
  pairing,
  visible,
  autoSubmitUsed = false,
  onAutoSubmitUsed = () => undefined,
  onSubmitted,
  onDismiss,
}: Readonly<Props>): ReactElement {
  const { code, setCode, submitting, error, setError, submit } = useOtpSubmission(
    request.id,
    pairing,
    onSubmitted,
  );
  const autoEnabled = useAutoSubmitPreference(visible);
  const codeRef = useRef<{ focus: () => void } | null>(null);
  // The parent owns the one-shot guard so it survives this prompt's per-request
  // remount; the guard hook keeps the same-tick check and the attempt token.
  const autoGuard = useAutoSubmitGuard(autoSubmitUsed, request.id);
  const [armed, setArmed] = useState({ token: 0, pairing });
  // The countdown belongs to this prompt; the one-shot guard lives in the
  // parent so it cannot be reset by a remount.
  const countdown = useAutoSubmitCountdown({
    requestId: request.id,
    visible,
    onFire: autoFire({
      autoGuard,
      token: armed.token,
      pairing: armed.pairing,
      submit,
      setError,
    }),
  });

  const cancelCountdown = countdown.cancel;
  usePromptLifecycle({
    requestId: request.id,
    visible,
    autoGuard,
    cancelCountdown,
    setCode,
    setError,
  });

  const handleChange = (text: string): void => {
    autoGuard.invalidate();
    const next = normalizeOtpCodeInput(text);
    const previous = code;
    setCode(next);
    setError(null);
    // Any edit during the window counts as the user taking over.
    countdown.cancel();
    const arm = shouldArmAutoSubmit({
      enabled: autoEnabled,
      alreadyArmed: autoGuard.isUsed(),
      previous,
      next,
    });
    if (arm) {
      autoGuard.markUsed();
      setArmed({ token: autoGuard.currentAttempt().token, pairing });
      onAutoSubmitUsed();
      countdown.arm(next);
      AccessibilityInfo.announceForAccessibility(
        `Sending the code automatically in ${String(
          AUTO_SUBMIT_DELAY_SECONDS,
        )} seconds. Press Cancel auto-send to stop.`,
      );
    }
  };

  const cancelAuto = (): void => {
    autoGuard.invalidate();
    countdown.cancel();
    haptics.warning();
  };

  // A captured code is fed through the same path as a paste, so it inherits
  // every auto-submit bound rather than getting a shortcut around them.
  useOtpCapture(visible, handleChange);

  // Dismissing is a refusal, so it must also drop an armed code: without this
  // the countdown would resume if the same request's sheet were reopened.
  const dismiss = (): void => {
    autoGuard.invalidate();
    countdown.cancel();
    onDismiss(request.id);
  };
  const submitManually = (candidate: string): void => {
    autoGuard.invalidate();
    void submit(candidate);
  };

  return (
    <Sheet
      visible={visible}
      onClose={dismiss}
      onShow={() => {
        codeRef.current?.focus();
      }}
      title={`Enter OTP for ${request.bankId}`}
    >
      <OtpSheetContent
        code={code}
        error={error}
        submitting={submitting}
        countdown={countdown}
        onChange={handleChange}
        onCancelAuto={cancelAuto}
        onSubmit={() => {
          submitManually(code);
        }}
        onInputReady={(input) => {
          codeRef.current = input;
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: 12 },
});
