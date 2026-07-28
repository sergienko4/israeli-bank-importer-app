/**
 * App shell for a connected session: a persistent bottom tab bar over the active
 * destination (Home, Config, Banks, Status). Switching tabs slides the new
 * screen in from the direction of travel. The tab bar hides while a tab drills
 * into an editor (Config section / bank) so that screen's Save bar owns the
 * bottom, and a delivered push notification jumps to the Status tab.
 */
import * as Notifications from 'expo-notifications';
import type { ReactElement, ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import type { PendingOtpRequest } from '../api/otp';
import type { TabItem } from '../components/ui';
import { ScreenSwitch, TabBar } from '../components/ui';
import { useOtpWatcher } from '../push/useOtpWatcher';
import { useTheme } from '../theme/ThemeContext';
import { BanksScreen } from './BanksScreen';
import { ConfigScreen } from './ConfigScreen';
import { HomeScreen } from './HomeScreen';
import { OtpPrompt } from './OtpPrompt';
import { ReconnectBanner } from './ReconnectBanner';
import { StatusScreen } from './StatusScreen';

/** The top-level destinations. */
export type Tab = 'home' | 'config' | 'banks' | 'status';

const TABS: TabItem<Tab>[] = [
  { key: 'home', label: 'Home', icon: 'home-outline', activeIcon: 'home' },
  { key: 'config', label: 'Config', icon: 'options-outline', activeIcon: 'options' },
  { key: 'banks', label: 'Banks', icon: 'business-outline', activeIcon: 'business' },
  { key: 'status', label: 'Status', icon: 'pulse-outline', activeIcon: 'pulse' },
];

const ORDER: Tab[] = TABS.map((tab) => tab.key);

/**
 * Renders the tab shell for a connected session.
 * @returns The app shell element.
 */
export function AppShell(): ReactElement {
  const theme = useTheme();
  const { pending, dismiss } = useOtpWatcher();
  const [active, setActive] = useState<Tab>('home');
  const [depth, setDepth] = useState(0);
  const [promptRequest, setPromptRequest] = useState<PendingOtpRequest | null>(null);
  const prevIndex = useRef(0);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { type?: string } | undefined;
      if (data?.type === 'otp') {
        return;
      }
      setDepth(0);
      setActive('status');
    });
    return () => {
      sub.remove();
    };
  }, []);

  const select = (key: Tab): void => {
    if (key === active) {
      return;
    }
    setDepth(0);
    setActive(key);
  };

  const index = ORDER.indexOf(active);
  const direction = index >= prevIndex.current ? 'forward' : 'back';
  useEffect(() => {
    prevIndex.current = index;
  }, [index]);

  useEffect(() => {
    if (pending) {
      setPromptRequest(pending);
    }
  }, [pending]);

  let content: ReactNode;
  if (active === 'config') {
    content = <ConfigScreen onDepthChange={setDepth} />;
  } else if (active === 'banks') {
    content = <BanksScreen onDepthChange={setDepth} />;
  } else if (active === 'status') {
    content = <StatusScreen />;
  } else {
    content = <HomeScreen onNavigate={select} />;
  }

  return (
    <View style={[styles.fill, { backgroundColor: theme.colors.bg }]}>
      <ScreenSwitch screenKey={active} direction={direction}>
        {content}
      </ScreenSwitch>
      {depth === 0 ? <TabBar tabs={TABS} active={active} onSelect={select} /> : null}
      {promptRequest ? (
        <OtpPrompt
          request={promptRequest}
          visible={pending !== null}
          onSubmitted={dismiss}
          onDismiss={dismiss}
        />
      ) : null}
      <ReconnectBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
