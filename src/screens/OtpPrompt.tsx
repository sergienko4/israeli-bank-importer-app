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
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, StyleSheet, Text, View } from 'react-native';

import { type Session, submitOtp } from '../api/importerClient';
import type { PendingOtpRequest } from '../api/otp';
import { useAuth } from '../auth/AuthContext';
import { Button, Sheet, TextField } from '../components/ui';
import { type AutoSubmitAttempt, submitIfCurrent } from '../lib/autoSubmitAttempt';
import { reportedOrFallback } from '../lib/errorMessages';
import { haptics } from '../lib/haptics';
import { shouldArmAutoSubmit } from '../lib/otpAutoSubmit';
import { loadOtpAutoSubmit } from '../lib/otpAutoSubmitStore';
import { isValidOtpCode, normalizeOtpCodeInput } from '../lib/otpCode';
import { AUTO_SUBMIT_DELAY_SECONDS, useAutoSubmitCountdown } from '../lib/useAutoSubmitCountdown';
import { useAutoSubmitGuard } from '../lib/useAutoSubmitGuard';
import { useOtpCapture } from '../lib/useOtpCapture';
import { useTheme } from '../theme/ThemeContext';

const CODE_REJECTED = 'The importer would not accept that code. Check it and try again.';

/** What one foreground send produced. */
type SendOutcome = { kind: 'sent' } | { kind: 'failed'; message: string } | { kind: 'cancelled' };

/** One foreground send. */
interface SendCodeRequest {
  /** The active importer session. */
  readonly session: Session;
  /** The pending request being answered. */
  readonly requestId: string;
  /** The normalised code to send. */
  readonly code: string;
  /** Re-checks intent after the lane and session renewal. */
  readonly beforeSend?: () => Promise<boolean>;
}

/**
 * Sends a code to the importer and flattens every outcome to one value.
 * @param request - The session, request id, code, and before-send gate.
 * @returns Whether the code left, failed with a message, or was cancelled.
 */
async function sendCode({
  session,
  requestId,
  code,
  beforeSend,
}: SendCodeRequest): Promise<SendOutcome> {
  try {
    const result = await submitOtp({ session, id: requestId, code, beforeSend });
    if (result === null) {
      return { kind: 'cancelled' };
    }
    return result.ok
      ? { kind: 'sent' }
      : { kind: 'failed', message: reportedOrFallback(result.error, CODE_REJECTED) };
  } catch (error: unknown) {
    const reported = error instanceof Error ? error.message : undefined;
    return { kind: 'failed', message: reportedOrFallback(reported, CODE_REJECTED) };
  }
}

/**
 * Reads the stored auto-submit opt-in each time the sheet opens.
 *
 * Re-reading on open matters in the unsafe direction: the prompt can stay
 * mounted across requests, so a user who turns the setting *off* in Settings
 * must not find the next code still leaving on its own. Until the read lands
 * the answer is false, so a slow read costs a button press, never a surprise.
 * @param visible - Whether the sheet is on screen.
 * @returns Whether automatic submission is enabled.
 */
function useAutoSubmitPreference(visible: boolean): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!visible) {
      return undefined;
    }
    let active = true;
    const run = async (): Promise<void> => {
      const stored = await loadOtpAutoSubmit();
      if (active) {
        setEnabled(stored);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [visible]);
  return enabled;
}

/**
 * Builds the before-send gate used after every automatic-send wait.
 * @param attempt - The attempt generation captured at fire time.
 * @param token - The generation that must still be current.
 * @returns A gate that re-reads the opt-in and checks the generation.
 */
function autoSendGate(attempt: AutoSubmitAttempt, token: number): () => Promise<boolean> {
  return async () => (await loadOtpAutoSubmit().catch(() => false)) && attempt.isCurrent(token);
}

interface Props {
  /** The pending request to answer. */
  request: PendingOtpRequest;
  /** Whether the prompt sheet is open. */
  visible: boolean;
  /** Whether this request already used its one automatic attempt. */
  autoSubmitUsed: boolean;
  /** Marks the request as having used its automatic attempt. */
  onAutoSubmitUsed: () => void;
  /** Called after a successful submit. */
  onSubmitted: (requestId: string) => void;
  /** Called when the user dismisses without submitting. */
  onDismiss: (requestId: string) => void;
}

/** The submit state and controls the prompt renders. */
interface OtpSubmission {
  /** Whether a code is on its way to the importer. */
  readonly submitting: boolean;
  /** Why the last submission failed, or null. */
  readonly error: string | null;
  /** Clears the failure as the user edits. */
  readonly setError: (error: string | null) => void;
  /** Validates and sends one code, optionally re-checking intent at send time. */
  readonly submit: (candidate: string, beforeSend?: () => Promise<boolean>) => Promise<void>;
}

/**
 * Owns the one network write the prompt performs.
 *
 * The countdown and the button can both reach `submit` in the same tick, and a
 * state flag does not become true until React re-renders. A ref closes that
 * gap, which is worth a bank attempt.
 * @param requestId - The pending request being answered.
 * @param onSubmitted - Called after the importer accepts a code.
 * @returns The submit state and controls.
 */
function useOtpSubmission(
  requestId: string,
  onSubmitted: (requestId: string) => void,
): OtpSubmission {
  const { connection } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const submit = async (candidate: string, beforeSend?: () => Promise<boolean>): Promise<void> => {
    if (inFlight.current) {
      return;
    }
    const trimmed = normalizeOtpCodeInput(candidate);
    if (!isValidOtpCode(trimmed)) {
      setError('Enter the 4–8 digit app OTP code.');
      return;
    }
    if (!connection) {
      haptics.warning();
      setError('Reconnect to the importer, then enter the code again.');
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    const outcome = await sendCode({ session: connection, requestId, code: trimmed, beforeSend });
    inFlight.current = false;
    setSubmitting(false);
    if (outcome.kind === 'cancelled') {
      return;
    }
    if (outcome.kind === 'failed') {
      haptics.warning();
      setError(outcome.message);
      return;
    }
    haptics.success();
    onSubmitted(requestId);
  };

  return { submitting, error, setError, submit };
}

/**
 * Renders the OTP entry sheet.
 * @param props - The request plus submit/dismiss callbacks.
 * @returns The OTP prompt element.
 */
export function OtpPrompt({
  request,
  visible,
  autoSubmitUsed,
  onAutoSubmitUsed,
  onSubmitted,
  onDismiss,
}: Readonly<Props>): ReactElement {
  const theme = useTheme();
  const [code, setCode] = useState('');
  const { submitting, error, setError, submit } = useOtpSubmission(request.id, onSubmitted);
  const autoEnabled = useAutoSubmitPreference(visible);
  const codeRef = useRef<{ focus: () => void } | null>(null);
  // The parent owns the one-shot guard so it survives this prompt's per-request
  // remount; the guard hook keeps the same-tick check and the attempt token.
  const autoGuard = useAutoSubmitGuard(autoSubmitUsed);
  // The countdown belongs to this prompt; the one-shot guard lives in the
  // parent so it cannot be reset by a remount.
  const countdown = useAutoSubmitCountdown({
    requestId: request.id,
    visible,
    onFire: (value: string): void => {
      const attempt = autoGuard.currentAttempt();
      // Re-read after every wait: the user may have turned auto-submit off,
      // edited, or dismissed while the lane or session guard was busy.
      void submitIfCurrent({
        attempt,
        token: attempt.token,
        readPreference: loadOtpAutoSubmit,
        send: (candidate) => submit(candidate, autoSendGate(attempt, attempt.token)),
        code: value,
      });
    },
  });

  const cancelCountdown = countdown.cancel;

  // A hidden prompt must not keep an armed countdown: it would resume and
  // send the old code when the same request reappears.
  useEffect(() => {
    if (!visible) {
      autoGuard.invalidate();
      cancelCountdown();
    }
  }, [visible, autoGuard, cancelCountdown]);

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
      <Text style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}>
        The importer is waiting for the bank one-time code delivered through the app OTP channel.
      </Text>
      <TextField
        label="OTP code"
        value={code}
        onChangeText={handleChange}
        placeholder="123456"
        keyboardType="number-pad"
        autoComplete="sms-otp"
        textContentType="oneTimeCode"
        icon="keypad-outline"
        error={error}
        onInputReady={(input) => {
          codeRef.current = input;
        }}
      />
      {countdown.pending ? (
        <View>
          <Text style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}>
            {`Sending this code automatically in ${String(countdown.secondsLeft)}s.`}
          </Text>
          <Button title="Cancel auto-send" icon="close" variant="secondary" onPress={cancelAuto} />
        </View>
      ) : (
        <Button
          title="Submit code"
          icon="checkmark"
          loading={submitting}
          onPress={() => {
            submitManually(code);
          }}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: 12 },
});
