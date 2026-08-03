/**
 * Pins the translation of Android's permission answers.
 *
 * The distinction that matters is `never_ask_again`: it is not just another
 * refusal, it means the dialog will never appear again. Treating it as a plain
 * denial would leave the user tapping a switch that can never move.
 */
import { PermissionsAndroid } from 'react-native';

import { toPermissionOutcome } from './otpAutoReadPermission';

describe('toPermissionOutcome', () => {
  it('reads a grant as granted', () => {
    expect(toPermissionOutcome(PermissionsAndroid.RESULTS.GRANTED)).toBe('granted');
  });

  it('reads a refusal as denied, which the user can still change', () => {
    expect(toPermissionOutcome(PermissionsAndroid.RESULTS.DENIED)).toBe('denied');
  });

  it('reads a permanent refusal as blocked, which needs system settings', () => {
    expect(toPermissionOutcome(PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN)).toBe('blocked');
  });

  it('treats an unrecognised answer as a refusal rather than a grant', () => {
    expect(toPermissionOutcome('something-new')).toBe('denied');
  });
});
