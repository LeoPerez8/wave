import { catalogueOf, type AppLanguage } from "./localisation.ts";

/**
 * A release date the owner typed for a song (docs/spec.md, "Release date"): their own
 * correction, which wins over every date Wave reads or looks up.
 */

/** What the Release date screen's three fields hold, as typed. */
export interface TypedReleaseDateFields {
  readonly year: string;
  readonly month: string;
  readonly day: string;
}

export type TypedReleaseDateRead =
  | { readonly ok: true; readonly date: string }
  /** `empty`: no year yet, nothing to say. `impossible`: no such day, or a day still to come. */
  | { readonly ok: false; readonly problem: "empty" | "impossible" };

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * The date [fields] give, as the index keeps it (`1985`, `1985-06` or `1985-06-21`), or why
 * not: a year of four digits, a month only with it, a day only with a month, and a day the
 * calendar has, no later than [today] (`YYYY-MM-DD`, the phone's).
 */
export const readTypedReleaseDate = (
  fields: TypedReleaseDateFields,
  today: string,
): TypedReleaseDateRead => {
  const [year, month, day] = [fields.year, fields.month, fields.day].map((field) => field.trim());
  if (year === "" && month === "" && day === "") return { ok: false, problem: "empty" };
  const impossible = { ok: false, problem: "impossible" } as const;
  if (!/^\d{4}$/.test(year ?? "") || year === "0000") return impossible;
  if (!/^\d{0,2}$/.test(month ?? "") || !/^\d{0,2}$/.test(day ?? "")) return impossible;
  if (month === "" && day !== "") return impossible;
  const y = Number(year);
  const m = month === "" ? null : Number(month);
  const d = day === "" ? null : Number(day);
  if (m !== null && (m < 1 || m > 12)) return impossible;
  // Day 0 of the next month is this month's last.
  if (m !== null && d !== null && (d < 1 || d > new Date(Date.UTC(y, m, 0)).getUTCDate()))
    return impossible;
  const date = m === null ? String(y) : d === null ? `${y}-${pad(m)}` : `${y}-${pad(m)}-${pad(d)}`;
  return date > today.slice(0, date.length) ? impossible : { ok: true, date };
};

/** What a song's release date can come from; each is optional. */
export interface ReleaseDateSources {
  /** The owner's own, typed on the Release date screen. */
  readonly typed?: string | null | undefined;
  /** The file's original-date tag, as the index keeps it. */
  readonly original?: string | null | undefined;
  /** The lookup's answer (`releaseAnswer`). */
  readonly answer?: { readonly date: string | null; readonly source: string } | null | undefined;
  /** The file's Year. */
  readonly year?: number | null | undefined;
}

/**
 * The date a song shows and sorts by: a typed date, then the original-date tag, then a first
 * release the lookup found, then the Year, then the lookup's fallback (the Deezer album's).
 */
export const releaseShownDate = ({ typed, original, answer, year }: ReleaseDateSources) =>
  typed ||
  original ||
  (answer?.source === "first-release" ? answer.date : null) ||
  (year ? String(year) : null) ||
  answer?.date ||
  null;

const DATE = /^(?!0000)\d{4}(?:-(?:0[1-9]|1[0-2])(?:-(?:0[1-9]|[12]\d|3[01]))?)?$/;

/**
 * How many synced preferences hold typed dates. Each is one value the Wave account caps at
 * 16,384 characters, and the account keeps 200 preferences, so a few share the songs.
 */
export const TYPED_RELEASE_BUCKETS = 8;

/** The longest value a synced preference may have (the sync service's `MAX_TEXT_LENGTH`). */
const MAX_STORED = 16_384;

/** Which of the preferences holds the typed date of the song with key [key], always the same. */
export const typedReleaseBucket = (key: string): number => {
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  return hash % TYPED_RELEASE_BUCKETS;
};

/** One preference's typed dates, by song key, from what it stores; what isn't a date is left out. */
export const readTypedReleaseDates = (stored: string | null): Record<string, string> => {
  let value: unknown;
  try {
    value = stored === null ? null : JSON.parse(stored);
  } catch {
    return {};
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && DATE.test(entry[1]),
    ),
  );
};

/**
 * [dates] with the song [key]'s typed date set to [date], or taken out (null). Null when the
 * preference would grow too long for the Wave account to keep.
 */
export const withTypedReleaseDate = (
  dates: Readonly<Record<string, string>>,
  key: string,
  date: string | null,
): Record<string, string> | null => {
  const { [key]: _old, ...rest } = dates;
  const next = date === null ? rest : { ...rest, [key]: date };
  return date !== null && JSON.stringify(next).length > MAX_STORED ? null : next;
};

/**
 * What a typed date writes into the song's file, or null for none (a song without a file keeps
 * it in the index alone). Unlike a found date (`releaseTagDate`), which never replaces an
 * original date the file has, a typed date is the owner's own correction: it replaces the
 * file's, and clearing it ([date] null) takes the file's out, so the lookup can find one again.
 */
export const typedReleaseTag = (song: {
  readonly date: string | null;
  readonly hasFile: boolean;
}): { readonly date: string | null } | null => (song.hasFile ? { date: song.date } : null);

/** [date] (`1985`, `1985-06` or `1985-06-21`) as [language] says it, as precise as it's known. */
export const formatReleaseDate = (date: string, language: AppLanguage): string => {
  const [year, month, day] = date.split("-").map(Number);
  return catalogueOf(language).playlists.releaseDate(year ?? 0, month ?? null, day ?? null);
};
