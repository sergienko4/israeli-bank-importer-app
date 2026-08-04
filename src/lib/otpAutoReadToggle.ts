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

/**
 * The state the switch should settle into after a transition.
 *
 * `failed` is the one answer that carries no information about the device: the
 * write threw, so the stored value is still whatever it was. Moving the switch
 * would claim a change that never happened, and for a failed turn-off it would
 * claim reading has stopped while the receiver is still listening.
 *
 * @param result - What the transition reported.
 * @param shown - What the switch was showing before it ran.
 * @returns The state to show.
 */
export function settledSwitchState(result: AutoReadToggleResult, shown: boolean): boolean {
  if (result === 'failed') return shown;
  return result === 'enabled';
}

/** Everything reading the current state needs from the outside world. */
export interface AutoReadStatePorts {
  /** Reads the stored setting from the device's secure store. */
  readonly stored: () => Promise<boolean>;
  /** Asks Android whether the SMS permission is held, or null if it cannot say. */
  readonly granted: () => Promise<boolean | null>;
  /** Writes the setting to the device's secure store. */
  readonly persist: (enabled: boolean) => Promise<void>;
  /** Pushes the stored preferences down to the native capture flag. */
  readonly applyGate: () => Promise<{ readonly pushed: boolean }>;
}

/**
 * Reads the state the switch should open in, and settles the device to match.
 *
 * Two things can drift apart while the app is not running, in both directions.
 * A permission can be taken away from system settings, leaving a setting that
 * claims more than it is allowed. And the native capture flag is derived from
 * the stored preferences, which read as false whenever the keystore is briefly
 * unreadable, so a single unlucky read can switch capture off underneath a
 * setting that still says on — silently, permanently, and invisibly to a user
 * who has been told codes are handled for them.
 *
 * So this is the one place both are put right. Order matters on the way down:
 * the gate reads the preferences and never the permission, so the repair has to
 * be stored before it is pushed, or pushing it would switch capture back on.
 *
 * @param ports - The injected store, permission check and gate.
 * @returns True only when the setting and the permission agree and the device
 *   was successfully settled to match; false on any failure along the way.
 */
export async function resolveAutoRead(ports: AutoReadStatePorts): Promise<boolean> {
  try {
    const [stored, granted] = await Promise.all([ports.stored(), ports.granted()]);
    if (!stored) return false;
    // A check that could not run has not told us the permission is gone, and
    // what follows would wipe the messages being held on the strength of it.
    if (granted === null) return false;

    if (!granted) await ports.persist(false);
    // The gate reports rather than throws, so asking it whether the write landed
    // is the only way to tell a flag the receiver will read from one that was
    // never written.
    if (!(await ports.applyGate()).pushed) return false;
    return granted;
  } catch {
    // Nothing was reconciled, so nothing can be claimed. Showing on here would
    // be the failure this whole function exists to prevent: a switch promising
    // codes are handled while the receiver may be off. The next mount retries.
    return false;
  }
}
