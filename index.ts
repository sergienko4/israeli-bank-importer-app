import { registerRootComponent } from 'expo';

import App from './App';
import { registerOtpSmsTask } from './src/lib/otpHeadlessTask';
import { applyStashGate } from './src/lib/otpStashGate';
import { registerOtpPushTask } from './src/push/otpPushTask';

// Registered before the root component so the tasks exist even when the process
// was started by an arriving message or notification rather than by the user
// opening the app.
registerOtpSmsTask();
registerOtpPushTask();

// The receiver decides whether to hold a message with no JavaScript alive, so
// the flag it reads is refreshed at every start the app does get.
void applyStashGate();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
