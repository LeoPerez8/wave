/**
 * Home's cold-start snapshot (docs/spec.md › Fluidity, #1353): what Home
 * last showed, saved when the app goes to the background, so the first
 * frame of the next cold start draws it before any Library read answers.
 * Each section is checked as it's read back: one that doesn't hold what Home
 * draws is left out and that section waits for its read, while the rest
 * still show. A snapshot of another format, or one that can't be read, is
 * none at all: Home opens as it would without one.
 */
import { readStoredRecord } from "./storedJson.ts";

/**
 * The snapshot's format; a stored one of another version reads as none.
 * Version 2 keeps Stats as totals, drawn in the language of the moment.
 */
export const HOME_SNAPSHOT_VERSION = 2;

/**
 * The most a stored snapshot may take, in characters (about 512 KB of
 * JSON). Home's sections are a few dozen rows each, so a real snapshot is a
 * fraction of it; one over the bound isn't kept, and the next cold start
 * opens without one.
 */
export const HOME_SNAPSHOT_MAX_LENGTH = 512 * 1024;

export interface HomeSnapshot<S> {
  /** When it was saved (ms since the epoch). */
  readonly savedAt: number;
  /** The Magic Queue carousel's page in sight, or null for none kept. */
  readonly page: number | null;
  /** The sections that had answered when it was saved. */
  readonly sections: Partial<S>;
}

/** How each section is checked as it's read back. */
export type HomeSnapshotChecks<S> = {
  readonly [K in keyof S]-?: (value: unknown) => value is S[K];
};

/**
 * What a checked field holds; a `?` also lets it be null or missing.
 * "object" is any record or array, "boolean" true or false.
 */
export type HomeSnapshotField =
  "number" | "string" | "boolean" | "object" | "number?" | "string?" | "object?";

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null;

const fieldHolds = (value: unknown, field: HomeSnapshotField): boolean => {
  const optional = field.endsWith("?");
  if (optional && (value === null || value === undefined)) return true;
  const kind = optional ? field.slice(0, -1) : field;
  return kind === "object" ? isRecord(value) : typeof value === kind;
};

const recordHolds = (value: unknown, fields: Readonly<Record<string, HomeSnapshotField>>) =>
  isRecord(value) &&
  !Array.isArray(value) &&
  Object.entries(fields).every(([name, field]) => fieldHolds(value[name], field));

/** A check for a record with [fields]. */
export const homeSnapshotRecord =
  <A>(fields: Readonly<Record<string, HomeSnapshotField>>) =>
  (value: unknown): value is A =>
    recordHolds(value, fields);

/** A check for a list whose every entry is a record with [fields]. */
export const homeSnapshotList =
  <A>(fields: Readonly<Record<string, HomeSnapshotField>>) =>
  (value: unknown): value is A =>
    Array.isArray(value) && value.every((entry) => recordHolds(entry, fields));

/**
 * What to store for [snapshot] (`parseHomeSnapshot` reads it back), or null
 * when there's nothing to keep: no section answered, or over
 * `HOME_SNAPSHOT_MAX_LENGTH`.
 */
export const storedHomeSnapshot = <S>(snapshot: HomeSnapshot<S>): string | null => {
  const sections = Object.fromEntries(
    Object.entries(snapshot.sections).filter(([, value]) => value !== undefined),
  );
  if (Object.keys(sections).length === 0) return null;
  const stored = JSON.stringify({
    version: HOME_SNAPSHOT_VERSION,
    savedAt: snapshot.savedAt,
    page: snapshot.page,
    sections,
  });
  return stored.length > HOME_SNAPSHOT_MAX_LENGTH ? null : stored;
};

/**
 * The snapshot [stored] holds, its sections checked by [checks]: null for
 * nothing stored, text that isn't a snapshot, or another format. Sections
 * [checks] doesn't name, or that fail their check, are left out.
 */
export const parseHomeSnapshot = <S>(
  stored: string | null,
  checks: HomeSnapshotChecks<S>,
): HomeSnapshot<S> | null => {
  const { version, savedAt, page, sections } = readStoredRecord(stored);
  if (version !== HOME_SNAPSHOT_VERSION || typeof savedAt !== "number") return null;
  if (!isRecord(sections) || Array.isArray(sections)) return null;
  const kept: Partial<Record<keyof S, unknown>> = {};
  for (const name of Object.keys(checks) as (keyof S & string)[]) {
    const value = sections[name];
    if (value !== undefined && checks[name](value)) kept[name] = value;
  }
  return {
    savedAt,
    page: typeof page === "number" && Number.isInteger(page) && page >= 0 ? page : null,
    sections: kept as Partial<S>,
  };
};
