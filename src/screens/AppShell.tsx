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

import type { TabItem } from '../components/ui';
import { ScreenSwitch, TabBar } from '../components/ui';
import { type OwnedPendingOtpRequest, useOtpWatcher } from '../push/useOtpWatcher';
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
  const { pending, dismiss, clearAnswered, autoSubmitted, markAutoSubmitted } = useOtpWatcher();
  const [active, setActive] = useState<Tab>('home');
  const [depth, setDepth] = useState(0);
  const [lastPending, setLastPending] = useState<OwnedPendingOtpRequest | null>(null);
  const prevIndex = useRef(0);
  const depthRef = useRef(0);

  useEffect(() => {
    depthRef.current = depth;
  }, [depth]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as { type?: string } | undefined;
      if (data?.type === 'otp') {
        return;
      }
      // Do not discard an open editor's draft from a background notification;
      // the user finishes the save or backs out first.
      if (depthRef.current > 0) {
        return;
      }
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
      setLastPending(pending);
    }
  }, [pending]);

  // The prompt always shows the request the watcher currently has pending. The
  // last one is kept only so the sheet can animate closed after it goes null.
  const shownRequest = pending ?? lastPending;

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
      {shownRequest ? (
        <OtpPrompt
          key={shownRequest.pairing}
          request={shownRequest}
          pairing={shownRequest.pairing}
          visible={pending !== null}
          autoSubmitUsed={autoSubmitted.has(shownRequest.id)}
          onAutoSubmitUsed={() => {
            markAutoSubmitted(shownRequest.id, shownRequest.deadline);
          }}
          onSubmitted={(id) => {
            clearAnswered(id, shownRequest.deadline);
          }}
          onDismiss={(id) => {
            dismiss(id, shownRequest.deadline);
          }}
        />
      ) : null}
      <ReconnectBanner />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
