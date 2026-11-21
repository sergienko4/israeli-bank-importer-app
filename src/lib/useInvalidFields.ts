/**
 * Blocks Save/Back while a numeric field holds text that cannot be parsed.
 *
 * The buttons live in a sticky footer, outside the keyboard-aware scroll view,
 * so pressing them does not blur the focused input. Without this gate the old
 * committed number would be saved while the invalid text stayed on screen.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

/** The validity registry an editor hands to its fields and buttons. */
export interface InvalidFields {
  /** Records one field's validity under a stable key. */
  readonly report: (key: string, valid: boolean) => void;
  /** Runs the action, or explains why a highlighted number must be fixed. */
  readonly guard: (action: () => void) => void;
}

/**
 * Tracks the fields whose current text is invalid.
 * @returns The reporter and the guarded action runner.
 */
export function useInvalidFields(): InvalidFields {
  const [keys, setKeys] = useState<ReadonlySet<string>>(new Set());
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const report = useCallback((key: string, valid: boolean) => {
    if (!mounted.current) {
      return;
    }
    setKeys((current) => {
      if (valid === !current.has(key)) {
        return current;
      }
      const next = new Set(current);
      if (valid) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, []);

  const guard = useCallback(
    (action: () => void) => {
      if (keys.size > 0) {
        Alert.alert('Check the highlighted field', 'Enter a valid number before saving.');
        return;
      }
      action();
    },
    [keys],
  );

  return { report, guard };
}
