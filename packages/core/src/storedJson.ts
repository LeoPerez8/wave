/**
 * A setting stored as a JSON object, as a plain record to read field by field.
 * Nothing stored, unreadable JSON or anything but an object reads as empty, so
 * each field falls back to its default.
 */
export const readStoredRecord = (stored: string | null): Readonly<Record<string, unknown>> => {
  if (stored === null) return {};
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return {};
  }
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
};

/**
 * A setting stored as a JSON array, as a set of the items [isItem] accepts.
 * Nothing stored, unreadable JSON or anything but an array reads as empty;
 * stray entries are left out.
 */
export const readStoredSet = <T>(
  stored: string | null,
  isItem: (value: unknown) => value is T,
): ReadonlySet<T> => {
  if (stored === null) return new Set();
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return new Set();
  }
  return new Set(Array.isArray(raw) ? raw.filter(isItem) : []);
};

/** [items] as `readStoredSet` reads them back; null (nothing stored) for none. */
export const writeStoredSet = <T>(items: ReadonlySet<T>): string | null =>
  items.size === 0 ? null : JSON.stringify([...items]);
