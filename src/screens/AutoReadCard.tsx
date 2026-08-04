/**
 * The switch that lets the app read a bank one-time code out of an incoming
 * message with no tap at all.
 *
 * It lives in its own file rather than beside the other OTP settings because it
 * carries the heaviest disclosure on the screen: turning it on grants a
 * permission that covers every message the phone receives, not only bank codes.
 * The decision logic itself is in `otpAutoReadToggle`, tested without a device;
 * this file is the presentation of it.
 */
import { type ReactElement, useEffect, useRef, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Banner, Card, ListRow } from '../components/ui';
import { haptics } from '../lib/haptics';
import { checkReceiveSms, requestReceiveSms } from '../lib/otpAutoReadPermission';
import { loadOtpAutoRead, saveOtpAutoRead } from '../lib/otpAutoReadStore';
import { resolveAutoRead, setAutoReadEnabled, settledSwitchState } from '../lib/otpAutoReadToggle';
import { applyStashGate } from '../lib/otpStashGate';
import { useTheme } from '../theme/ThemeContext';

/**
 * What to tell the user for each way turning auto-read on can fail.
 *
 * `blocked` gets its own message because it is the only one they cannot fix
 * from here — Android has stopped showing the dialog.
 */
const ERRORS = {
  denied: 'Without permission to receive messages, codes still need the consent prompt.',
  blocked:
    'Android will not ask again. To turn this on, allow SMS for this app in Android Settings › Apps › Permissions.',
  failed: 'Could not save the auto-read setting.',
} as const;

/**
 * Renders the auto-read switch and the disclosure that belongs with it.
 * @returns The auto-read card.
 */
export function AutoReadCard(): ReactElement {
  const theme = useTheme();
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A tap decides the switch from the device itself, so once one has happened
  // the answer this effect is still waiting for is a snapshot from before it.
  const toggled = useRef(false);

  useEffect(() => {
    let active = true;
    const run = async (): Promise<void> => {
      // The permission can be revoked from Android Settings without this
      // preference hearing about it, so the resolve may repair the stored value
      // and the native flag before answering — hence the second guard, taken
      // after the writes rather than before them.
      const on = await resolveAutoRead({
        stored: loadOtpAutoRead,
        granted: checkReceiveSms,
        persist: saveOtpAutoRead,
        applyGate: applyStashGate,
      });
      if (active && !toggled.current) {
        setEnabled(on);
      }
    };
    void run();
    return () => {
      active = false;
    };
  }, []);

  const toggle = async (next: boolean): Promise<void> => {
    if (next === enabled) {
      return;
    }
    setError(null);
    toggled.current = true;
    const result = await setAutoReadEnabled(next, {
      request: requestReceiveSms,
      persist: saveOtpAutoRead,
    });
    // The receiver reads a flag rather than the preference, so moving the
    // switch has to move the flag too. Turning it off empties the stash.
    await applyStashGate();
    // The result decides the switch, not the tap: a refused permission has to
    // leave it off rather than showing a state the device never reached, and a
    // failed write has to leave it where it was rather than claiming a change.
    setEnabled(settledSwitchState(result, enabled));
    if (result === 'enabled' || result === 'disabled') {
      haptics.success();
      return;
    }
    haptics.warning();
    setError(ERRORS[result]);
  };

  return (
    <View style={styles.section}>
      <Text style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}>
        With this on, a code that arrives by SMS is filled and sent without you opening the app.
      </Text>
      <Card padded={false} style={styles.menu}>
        <ListRow
          icon="chatbox-ellipses-outline"
          title="Read codes from messages"
          subtitle="Android will ask to let this app receive SMS. It never reads your existing messages. A code that arrives before the importer asks is kept for ten minutes, then dropped."
          accessibilityRole="switch"
          accessibilityState={{ checked: enabled }}
          accessibilityHint="Reads a bank one-time code from an incoming message automatically."
          onPress={() => {
            void toggle(!enabled);
          }}
          right={
            <Switch
              value={enabled}
              onValueChange={(next) => {
                void toggle(next);
              }}
              // The row above is already the switch, so leaving this one exposed
              // announces the setting twice, the second time unnamed.
              accessible={false}
              importantForAccessibility="no-hide-descendants"
            />
          }
        />
      </Card>
      <Text style={[theme.typography.small, styles.hint, { color: theme.colors.textMuted }]}>
        This permission covers every incoming message, not only bank codes. The app reads one only
        while it is waiting for a code and discards it immediately. If that trade is not worth it to
        you, leave this off — the consent prompt still works with one tap.
      </Text>
      {error ? <Banner messages={[error]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { marginBottom: 12, marginLeft: 4 },
  menu: { overflow: 'hidden' },
  section: { marginTop: 24 },
});
