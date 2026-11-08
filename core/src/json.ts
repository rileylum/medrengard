/** True for a JSON string. */
export function isText(value: unknown): value is string {
  return value === String(value);
}

/** True for a plain JSON object. */
export function isRecord(value: unknown): value is object {
  return value !== null && value !== undefined && Object.getPrototypeOf(value) === Object.prototype;
}

/** True for a plain JSON object with exactly these keys. */
export function hasExactly(value: unknown, keys: readonly string[]): value is object {
  if (!isRecord(value)) {
    return false;
  }

  const present = Object.keys(value);

  return present.length === keys.length && keys.every((key) => present.includes(key));
}
