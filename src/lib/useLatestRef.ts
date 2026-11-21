/**
 * Keeps a ref pointing at the latest value without re-running effects that only
 * need the value when an event or async continuation happens.
 */
import { useEffect, useRef } from 'react';

/**
 * Returns a ref synchronised with the latest render's value.
 * @param value - The value to track.
 * @returns A ref whose `current` is the latest value.
 */
export function useLatestRef<T>(value: T): { current: T } {
  const ref = useRef(value);
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref;
}
