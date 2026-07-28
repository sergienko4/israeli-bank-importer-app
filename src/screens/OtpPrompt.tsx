/**
 * OTP entry prompt: a spring bottom sheet that appears when the importer is
 * waiting for a bank one-time code (app OTP channel). The user types the code
 * and submits it to the importer, which resumes the blocked bank login.
 */
import { type ReactElement, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { submitOtp } from '../api/importerClient';
import type { PendingOtpRequest } from '../api/otp';
import { useAuth } from '../auth/AuthContext';
import { Banner, Button, Sheet, TextField } from '../components/ui';
import { haptics } from '../lib/haptics';
import { isValidOtpCode, normalizeOtpCodeInput } from '../lib/otpCode';
import { useTheme } from '../theme/ThemeContext';

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
export function OtpPrompt({ request, visible, onSubmitted, onDismiss }: Props): ReactElement {
  const theme = useTheme();
  const { connection } = useAuth();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    const trimmed = normalizeOtpCodeInput(code);
    if (!isValidOtpCode(trimmed)) {
      setError('Enter the 4–8 digit app OTP code.');
      return;
    }
    if (!connection) {
      haptics.warning();
      setError('Reconnect to the importer before submitting this app OTP code.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await submitOtp(connection, request.id, trimmed);
      if (result.ok) {
        haptics.success();
        setCode('');
        onSubmitted();
      } else {
        haptics.warning();
        setError(result.error ?? 'The importer rejected the code.');
      }
    } catch (error: unknown) {
      haptics.warning();
      setError(error instanceof Error ? error.message : 'The importer rejected the code.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet visible={visible} onClose={onDismiss} title={`Enter OTP for ${request.bankId}`}>
      <Text style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}>
        The importer is waiting for the bank one-time code delivered through the app OTP channel.
      </Text>
      <TextField
        label="OTP code"
        value={code}
        onChangeText={(text) => {
          setCode(normalizeOtpCodeInput(text));
          setError(null);
        }}
        placeholder="123456"
        keyboardType="number-pad"
        icon="keypad-outline"
        error={error}
      />
      {error ? (
        <View style={styles.banner}>
          <Banner messages={[error]} />
        </View>
      ) : null}
      <Button
        title="Submit code"
        icon="checkmark"
        loading={submitting}
        onPress={() => {
          void submit();
        }}
      />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: 12 },
  banner: { marginBottom: 12 },
});
