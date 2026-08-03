import { registerRootComponent } from 'expo';

import App from './App';
import { registerOtpSmsTask } from './src/lib/otpHeadlessTask';

// Registered before the root component so the task exists even when the process
// was started by an arriving message rather than by the user opening the app.
registerOtpSmsTask();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
