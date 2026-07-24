// Flat ESLint config for the Expo app. Extends eslint-config-expo (Expo's
// recommended React Native + TypeScript ruleset) and ignores build output.
const expoConfig = require('eslint-config-expo/flat');

module.exports = [
  ...expoConfig,
  {
    ignores: ['dist/*', '.expo/*', 'node_modules/*'],
  },
];
