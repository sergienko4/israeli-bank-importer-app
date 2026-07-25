/**
 * Immutable get/set helpers for editing a nested config object by key path. Each
 * edit returns a new object (structural sharing along the path) so React state
 * updates are detected without mutating the loaded config.
 */
import type { ConfigObject } from '../api/manifest';

/**
 * Reads the value at a key path, or undefined when any segment is missing.
 * @param obj - The root object.
 * @param path - The key path to read.
 * @returns The value at the path, or undefined.
 */
export function getAtPath(obj: ConfigObject, path: string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (typeof current !== 'object' || current === null) {
      return undefined;
    }
    current = (current as ConfigObject)[key];
  }
  return current;
}

/**
 * Returns a copy of the object with the value at a key path replaced, creating
 * intermediate objects as needed.
 * @param obj - The root object.
 * @param path - The key path to write (must be non-empty).
 * @param value - The value to set.
 * @returns A new object with the updated value.
 */
export function setAtPath(obj: ConfigObject, path: string[], value: unknown): ConfigObject {
  if (path.length === 0) {
    return obj;
  }
  const [head, ...rest] = path;
  if (rest.length === 0) {
    return { ...obj, [head]: value };
  }
  const child = obj[head];
  const childObj = typeof child === 'object' && child !== null ? (child as ConfigObject) : {};
  return { ...obj, [head]: setAtPath(childObj, rest, value) };
}
