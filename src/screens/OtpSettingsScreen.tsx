/**
 * OTP delivery settings (app-only): lets the user choose whether bank OTP codes
 * are collected through this app or forwarded via Telegram. This setting lives
 * outside the config manifest, so it is intentionally editable only here and not
 * in the web portal.
 */
import { Ionicons } from '@expo/vector-icons';
import { type ReactElement, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

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
import { useTheme } from '../theme/ThemeContext';

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
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: 12, marginLeft: 4 },
  menu: { overflow: 'hidden' },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
});
