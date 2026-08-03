/**
 * OTP delivery settings (app-only): lets the user choose whether bank OTP codes
 * are collected through this app or forwarded via Telegram. This setting lives
 * outside the config manifest, so it is intentionally editable only here and not
 * in the web portal.
 *
 * The auto-submit choice below it is different in kind: it is stored on this
 * device rather than on the importer, because it describes how a code reaches
 * the field on this phone, not how the account behaves.
 */
import { Ionicons } from '@expo/vector-icons';
import { type ReactElement, useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { getOtpSettings, setOtpSettings } from '../api/importerClient';
import type { OtpChannel } from '../api/otp';
import { useAuth } from '../auth/AuthContext';
import {
  AppHeader,
  Banner,
  Card,
  ErrorView,
  ListRow,
  Screen,
  SkeletonList,
} from '../components/ui';
import { haptics } from '../lib/haptics';
import { isAutoReadBuild } from '../lib/otpAutoReadPermission';
import { loadOtpAutoSubmit, saveOtpAutoSubmit } from '../lib/otpAutoSubmitStore';
import { useTheme } from '../theme/ThemeContext';
import { AutoReadCard } from './AutoReadCard';

interface Props {
  onBack: () => void;
}

interface Choice {
  channel: OtpChannel;
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
}

const CHOICES: Choice[] = [
  {
    channel: 'app',
    icon: 'phone-portrait-outline',
    title: 'This app',
    subtitle: 'Get a push and enter the OTP code here — no Telegram needed.',
  },
  {
    channel: 'telegram',
    icon: 'paper-plane-outline',
    title: 'Telegram',
    subtitle: 'The importer asks for the OTP over your Telegram bot.',
  },
];

/**
 * Renders the device-local auto-submit choice.
 *
 * Kept self-contained because nothing else on this screen depends on it: the
 * channel above talks to the importer, this talks to the keystore.
 * @returns The auto-submit card.
 */
function AutoSubmitCard(): ReactElement {
  const theme = useTheme();
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  // Takes the target value rather than inverting current state, so the row and
  // the switch cannot fight each other if both report the same tap.
  const toggle = async (next: boolean): Promise<void> => {
    if (next === enabled) {
      return;
    }
    setEnabled(next);
    setError(null);
    try {
      await saveOtpAutoSubmit(next);
      haptics.success();
    } catch (e) {
      // Reverting matters most when turning it OFF: leaving the switch showing
      // "off" after a failed write would tell the user codes are no longer sent
      // automatically while they still are.
      setEnabled(!next);
      haptics.warning();
      setError(e instanceof Error ? e.message : 'Could not save the auto-submit setting.');
    }
  };

  return (
    <View style={styles.section}>
      <Text style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}>
        When a code arrives by autofill or paste, this app can send it without waiting for you to
        press Submit.
      </Text>
      <Card padded={false} style={styles.menu}>
        <ListRow
          icon="flash-outline"
          title="Submit codes automatically"
          subtitle="You get three seconds to cancel. Only whole codes that arrive at once count — typing is never submitted for you."
          accessibilityRole="switch"
          accessibilityState={{ checked: enabled }}
          accessibilityHint="Sends a filled one-time code without pressing Submit."
          onPress={() => {
            void toggle(!enabled);
          }}
          right={
            <Switch
              value={enabled}
              onValueChange={(next) => {
                void toggle(next);
              }}
            />
          }
        />
      </Card>
      <Text style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}>
        Leave this off if you would rather check every code first. A scam text can look like a real
        one, and an auto-submitted wrong code still costs one of the bank&apos;s few attempts.
      </Text>
      {error ? <Banner messages={[error]} /> : null}
    </View>
  );
}

/**
 * Renders the OTP delivery settings screen.
 * @param props - Callback to return to the previous screen.
 * @returns The settings screen element.
 */
export function OtpSettingsScreen({ onBack }: Readonly<Props>): ReactElement {
  const theme = useTheme();
  const { connection } = useAuth();
  const [channel, setChannel] = useState<OtpChannel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!connection) {
      return undefined;
    }
    let active = true;
    const run = async (): Promise<void> => {
      try {
        const settings = await getOtpSettings(connection);
        if (active) {
          setChannel(settings.channel);
        }
      } catch (e) {
        if (active) {
          setError(e instanceof Error ? e.message : 'Failed to load OTP settings.');
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, [connection, reloadKey]);

  const reload = (): void => {
    setError(null);
    setLoading(true);
    setReloadKey((key) => key + 1);
  };

  const choose = async (next: OtpChannel): Promise<void> => {
    if (!connection || next === channel) {
      return;
    }
    const previous = channel;
    setChannel(next);
    setSaveError(null);
    try {
      const result = await setOtpSettings(connection, next);
      if (result.ok) {
        haptics.success();
      } else {
        setChannel(previous);
        haptics.warning();
        setSaveError(result.error ?? 'Could not save the OTP setting.');
      }
    } catch (e) {
      setChannel(previous);
      haptics.warning();
      setSaveError(e instanceof Error ? e.message : 'Could not save the OTP setting.');
    }
  };

  if (loading) {
    return (
      <Screen header={<AppHeader title="OTP delivery" onBack={onBack} />}>
        <SkeletonList count={2} />
      </Screen>
    );
  }
  if (error) {
    return (
      <Screen scroll={false} header={<AppHeader title="OTP delivery" onBack={onBack} />}>
        <ErrorView message={error} onRetry={reload} />
      </Screen>
    );
  }

  return (
    <Screen
      header={
        <AppHeader title="OTP delivery" subtitle="How bank codes are collected" onBack={onBack} />
      }
      notice={saveError ? <Banner messages={[saveError]} /> : undefined}
    >
      <Text style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}>
        Choose how the importer asks you for a bank&apos;s one-time code during login.
      </Text>
      <Card padded={false} style={styles.menu}>
        {CHOICES.map((choice) => {
          const selected = choice.channel === channel;
          return (
            <ListRow
              key={choice.channel}
              icon={choice.icon}
              title={choice.title}
              subtitle={choice.subtitle}
              accessibilityRole="radio"
              accessibilityState={{ checked: selected, selected }}
              accessibilityHint="Selects this OTP delivery method."
              onPress={() => {
                void choose(choice.channel);
              }}
              right={
                selected ? (
                  <Ionicons name="checkmark-circle" size={22} color={theme.colors.primary} />
                ) : (
                  <View style={[styles.dot, { borderColor: theme.colors.borderStrong }]} />
                )
              }
            />
          );
        })}
      </Card>
      {/* Only shown for the app channel: with Telegram the code never reaches
          this field, so an auto-submit switch here would do nothing. */}
      {channel === 'app' ? <AutoSubmitCard /> : null}
      {/* Auto-read needs somewhere to put the code, so it shares auto-submit's
          channel condition, and only appears in a build carrying the SMS
          permission — elsewhere the switch could never work. */}
      {channel === 'app' && isAutoReadBuild() ? <AutoReadCard /> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: 12, marginLeft: 4 },
  section: { marginTop: 24 },
  menu: { overflow: 'hidden' },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
});
