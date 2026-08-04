/**
 * Decides what happens when the user moves the auto-read switch.
 *
 * Turning this on is the moment the app asks for a permission that lets it see
 * every message the phone receives, so the transition is a security control
 * rather than a preference write. One rule governs it: the stored setting may
 * never claim more than the permission actually allows.
 *
 * That means a refused request stores `false`, not `true`. A setting that reads
 * "on" while the permission is missing would tell the user codes are being
 * handled automatically while nothing is listening — they would stop watching
 * for the prompt and miss the deadline.
 *
 * The logic is separated from the switch so it can be tested without a device,
 * since neither the permission dialog nor the keystore exists under Jest.
 */

/** How the operating system answered a permission request. */
export type PermissionOutcome = 'granted' | 'denied' | 'blocked';

/** Everything the transition needs from the outside world. */
export interface AutoReadTogglePorts {
  /** Asks Android for the SMS permission, surfacing the system dialog. */
  readonly request: () => Promise<PermissionOutcome>;
  /** Writes the setting to the device's secure store. */
  readonly persist: (enabled: boolean) => Promise<void>;
}

/**
 * What the switch should show, and what the user needs to be told.
 *
 * `blocked` is separate from `denied` because it is the only one the user
 * cannot resolve from inside the app — Android stops showing the dialog, so
 * the UI has to point at system settings instead of asking again.
 */
export type AutoReadToggleResult = 'enabled' | 'disabled' | 'denied' | 'blocked' | 'failed';

/**
 * Applies the user's choice, requesting the permission when turning on.
 *
 * @param desired - True when the user is switching auto-read on.
 * @param ports - The injected permission dialog and store.
 * @returns The state the switch should settle into.
 */
export async function setAutoReadEnabled(
  desired: boolean,
  ports: AutoReadTogglePorts,
): Promise<AutoReadToggleResult> {
  try {
    if (!desired) {
      await ports.persist(false);
      return 'disabled';
    }

    const outcome = await ports.request();
    if (outcome !== 'granted') {
      // Store the refusal rather than leaving the previous value in place, so a
      // setting can never survive as "on" without the permission behind it.
      await ports.persist(false);
      return outcome;
    }

    await ports.persist(true);
    return 'enabled';
  } catch {
    // A write that failed must not be reported as success: the user would trust
    // a state the device never recorded.
    return 'failed';
  }
}

/** Everything reading the current state needs from the outside world. */
export interface AutoReadStatePorts {
  /** Reads the stored setting from the device's secure store. */
  readonly stored: () => Promise<boolean>;
  /** Asks Android whether the SMS permission is still held. */
  readonly granted: () => Promise<boolean>;
  /** Writes the setting to the device's secure store. */
  readonly persist: (enabled: boolean) => Promise<void>;
  /** Pushes the stored preferences down to the native capture flag. */
  readonly applyGate: () => Promise<unknown>;
}

/**
 * Reads the state the switch should open in, repairing it if it drifted.
 *
 * A permission can be taken away from system settings while the app is not
 * running, which leaves a setting claiming more than it is allowed — the case
 * the toggle rule exists to prevent. Showing "off" is not enough on its own,
 * because the native side is still holding messages on the strength of the
 * stored value; the stored value has to go first, and only then does pushing
 * the gate down turn capture off and clear what it is holding.
 *
 * @param ports - The injected store, permission check and gate.
 * @returns True only when the setting and the permission agree.
 */
export async function resolveAutoRead(ports: AutoReadStatePorts): Promise<boolean> {
  const [stored, granted] = await Promise.all([ports.stored(), ports.granted()]);
  if (!stored) return false;
  if (granted) return true;

  try {
    await ports.persist(false);
    await ports.applyGate();
  } catch {
    // The switch shows off either way, which is the state the device is in.
  }
  return false;
}
