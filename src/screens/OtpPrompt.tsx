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
import { StyleSheet, Text, View } from 'react-native';

import { type Session, submitOtp } from '../api/importerClient';
import type { PendingOtpRequest } from '../api/otp';
import { useAuth } from '../auth/AuthContext';
import { Banner, Button, Sheet, TextField } from '../components/ui';
import { reportedOrFallback } from '../lib/errorMessages';
import { haptics } from '../lib/haptics';
import { shouldArmAutoSubmit } from '../lib/otpAutoSubmit';
import { loadOtpAutoSubmit } from '../lib/otpAutoSubmitStore';
import { isValidOtpCode, normalizeOtpCodeInput } from '../lib/otpCode';
import { useOtpCapture } from '../lib/useOtpCapture';
import { useTheme } from '../theme/ThemeContext';

const CODE_REJECTED = 'The importer would not accept that code. Check it and try again.';

/** How long the user has to stop an automatic submission. */
const AUTO_SUBMIT_DELAY_SECONDS = 3;

/**
 * Sends a code to the importer and flattens every outcome to one value.
 * @param session - The active importer session.
 * @param requestId - The pending request being answered.
 * @param code - The normalised code to send.
 * @returns Null when the importer accepted the code, else the message to show.
 */
async function sendCode(session: Session, requestId: string, code: string): Promise<string | null> {
  try {
    const result = await submitOtp(session, requestId, code);
    return result.ok ? null : reportedOrFallback(result.error, CODE_REJECTED);
  } catch (error: unknown) {
    const reported = error instanceof Error ? error.message : undefined;
    return reportedOrFallback(reported, CODE_REJECTED);
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

/** What the countdown needs in order to stay tied to one visible request. */
interface CountdownOptions {
  /** The pending request the armed code belongs to. */
  readonly requestId: string;
  /** Whether the sheet is on screen. */
  readonly visible: boolean;
  /** Called with the armed code once the window elapses. */
  readonly onFire: (code: string) => void;
}

/** The countdown state the prompt renders and drives. */
interface Countdown {
  /** Whether a code is waiting to be sent. */
  readonly pending: boolean;
  /** Seconds left in the cancel window. */
  readonly secondsLeft: number;
  /** Starts the window for a code. */
  readonly arm: (code: string) => void;
  /** Stops the window before anything reaches the network. */
  readonly cancel: () => void;
}

/**
 * Holds an armed code for a few seconds so the user can stop it.
 *
 * The armed value carries its own request id, so a dismissed sheet or a new
 * request drops the countdown by making it inactive rather than by racing a
 * reset: there is no window in which a stale code could still be sent.
 * @param options - The request the code belongs to, and what to do on expiry.
 * @returns The countdown state and its controls.
 */
function useAutoSubmitCountdown({ requestId, visible, onFire }: CountdownOptions): Countdown {
  const [armed, setArmed] = useState<{ requestId: string; code: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(AUTO_SUBMIT_DELAY_SECONDS);
  const fireRef = useRef(onFire);
  useEffect(() => {
    fireRef.current = onFire;
  });

  const active = armed !== null && armed.requestId === requestId && visible ? armed : null;

  useEffect(() => {
    if (active === null) {
      return undefined;
    }
    const timer = setTimeout(() => {
      if (secondsLeft <= 1) {
        setArmed(null);
        fireRef.current(active.code);
      } else {
        setSecondsLeft((left) => left - 1);
      }
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [active, secondsLeft]);

  return {
    pending: active !== null,
    secondsLeft,
    arm: (code: string): void => {
      setSecondsLeft(AUTO_SUBMIT_DELAY_SECONDS);
      setArmed({ requestId, code });
    },
    cancel: (): void => {
      setArmed(null);
    },
  };
}

interface Props {
  /** The pending request to answer. */
  request: PendingOtpRequest;
  /** Whether the prompt sheet is open. */
  visible: boolean;
  /** Called after a successful submit. */
  onSubmitted: () => void;
  /** Called when the user dismisses without submitting. */
  onDismiss: () => void;
}

/**
 * Renders the OTP entry sheet.
 * @param props - The request plus submit/dismiss callbacks.
 * @returns The OTP prompt element.
 */
export function OtpPrompt({
  request,
  visible,
  onSubmitted,
  onDismiss,
}: Readonly<Props>): ReactElement {
  const theme = useTheme();
  const { connection } = useAuth();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const autoEnabled = useAutoSubmitPreference(visible);

  // Holds the request this prompt has already armed for. Because it is never
  // cleared for the same id, a rejected automatic code cannot re-arm: the user
  // finishes that request by hand.
  const autoUsedForRequest = useRef<string | null>(null);

  const submit = async (candidate: string): Promise<void> => {
    if (submitting) {
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
    setSubmitting(true);
    setError(null);
    const failure = await sendCode(connection, request.id, trimmed);
    setSubmitting(false);
    if (failure !== null) {
      haptics.warning();
      setError(failure);
      return;
    }
    haptics.success();
    setCode('');
    onSubmitted();
  };

  const countdown = useAutoSubmitCountdown({
    requestId: request.id,
    visible,
    onFire: (value: string): void => {
      void submit(value);
    },
  });

  const handleChange = (text: string): void => {
    const next = normalizeOtpCodeInput(text);
    const previous = code;
    setCode(next);
    setError(null);
    // Any edit during the window counts as the user taking over.
    countdown.cancel();
    const arm = shouldArmAutoSubmit({
      enabled: autoEnabled,
      alreadyArmed: autoUsedForRequest.current === request.id,
      previous,
      next,
    });
    if (arm) {
      autoUsedForRequest.current = request.id;
      countdown.arm(next);
    }
  };

  const cancelAuto = (): void => {
    countdown.cancel();
    haptics.warning();
  };

  // A captured code is fed through the same path as a paste, so it inherits
  // every auto-submit bound rather than getting a shortcut around them.
  useOtpCapture(visible, handleChange);

  // Dismissing is a refusal, so it must also drop an armed code: without this
  // the countdown would resume if the same request's sheet were reopened.
  const dismiss = (): void => {
    countdown.cancel();
    onDismiss();
  };

  return (
    <Sheet visible={visible} onClose={dismiss} title={`Enter OTP for ${request.bankId}`}>
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
      />
      {error ? (
        <View style={styles.banner}>
          <Banner messages={[error]} />
        </View>
      ) : null}
      {countdown.pending ? (
        <View>
          <Text
            accessibilityLiveRegion="polite"
            style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}
          >
            {`Sending this code automatically in ${String(countdown.secondsLeft)}s.`}
          </Text>
          <Button title="Cancel" icon="close" variant="secondary" onPress={cancelAuto} />
        </View>
      ) : (
        <Button
          title="Submit code"
          icon="checkmark"
          loading={submitting}
          onPress={() => {
            void submit(code);
          }}
        />
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: 12 },
  banner: { marginBottom: 12 },
});
