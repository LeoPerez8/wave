/** Whether [value] is a plain JSON object (not null, not an array), to read field by field. */
export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

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
  return isRecord(raw) ? raw : {};
};

/**
 * [map] with [key] as its latest entry, holding [value] (or without it, for
 * null), keeping only the latest [most]: a map remembered in the order its
 * entries were last set.
 */
export const withLatest = <K, V>(
  map: ReadonlyMap<K, V>,
  key: K,
  value: V | null,
  most: number,
): ReadonlyMap<K, V> => {
  const next = new Map(map);
  next.delete(key);
  if (value !== null) next.set(key, value);
  return next.size > most ? new Map([...next].slice(-most)) : next;
};

/**
 * [map] stored as JSON, its entries a list of [tuple]s under [field]
 * (`readStoredTuples` reads them back); null (nothing stored) for none.
 */
export const storedTuples = <K, V>(
  map: ReadonlyMap<K, V>,
  field: string,
  tuple: (key: K, value: V) => readonly unknown[],
): string | null =>
  map.size === 0
    ? null
    : JSON.stringify({ version: 1, [field]: [...map].map(([key, value]) => tuple(key, value)) });

/**
 * The tuples [stored] holds under [field] (as `storedTuples` stored them),
 * each read by [read]: an entry that isn't a list, or that [read] gives null
 * for, is left out. None when nothing readable is stored.
 */
export const readStoredTuples = <T>(
  stored: string | null,
  field: string,
  read: (tuple: readonly unknown[]) => T | null,
): T[] => {
  const record = readStoredRecord(stored);
  const tuples = record[field];
  if (record.version !== 1 || !Array.isArray(tuples)) return [];
  return tuples.flatMap((entry: unknown) => {
    if (!Array.isArray(entry)) return [];
    const value = read(entry);
    return value === null ? [] : [value];
  });
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
