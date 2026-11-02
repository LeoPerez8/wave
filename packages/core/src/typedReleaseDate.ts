/**
 * A release date the owner typed for a song (docs/spec.md, "Release date"): their own
 * correction, which wins over every date Wave reads or looks up.
 */

import { artistPhotoName } from "./artistPhoto.ts";
import { UNKNOWN_ALBUM } from "./library.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { titleName } from "./lyricsAndGenre.ts";
import { readReleaseDate, type ReleaseDate } from "./releaseDate.ts";
import type { ReleaseAnswer } from "./releaseLookup.ts";
import { readSyncedBucket } from "./syncedBuckets.ts";

/** What the Release date screen's three fields hold, as typed. */
export interface TypedReleaseDateFields {
  readonly year: string;
  readonly month: string;
  readonly day: string;
}

export type TypedReleaseDateRead =
  | { readonly ok: true; readonly date: ReleaseDate }
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
  readonly typed?: ReleaseDate | null | undefined;
  /** The file's original-date tag, as the index keeps it. */
  readonly original?: ReleaseDate | null | undefined;
  /** The lookup's answer (`releaseAnswer`). */
  readonly answer?: ReleaseAnswer | null | undefined;
  /** The file's Year. */
  readonly year?: number | null | undefined;
}

/**
 * The date a song shows and sorts by: a typed date, then the original-date tag, then a first
 * release the lookup found, then the Year, then the lookup's fallback (the Deezer album's).
 */
export const releaseShownDate = ({
  typed,
  original,
  answer,
  year,
}: ReleaseDateSources): ReleaseDate | null =>
  typed ||
  original ||
  (answer?.source === "first-release" ? answer.date : null) ||
  (year ? String(year) : null) ||
  answer?.date ||
  null;

/**
 * How many synced preferences hold typed dates (Core's `syncedBucket`): each is one value the
 * Wave account caps at 16,384 characters, and the account keeps 200 preferences.
 */
export const TYPED_RELEASE_BUCKETS = 8;

/** One preference's typed dates, by song key, from what it stores; what isn't a date is left out. */
export const readTypedReleaseDates = (stored: string | null): Record<string, ReleaseDate> =>
  readSyncedBucket(stored, readReleaseDate);

/** A song as its release date is kept: its title, its artist credit and its album, when known. */
export interface ReleaseKeySong {
  readonly title: string;
  readonly artist: string;
  readonly album?: string | null | undefined;
}

/**
 * The key the lookup's answer for [song] is kept under: its title and artist, loosely matched
 * (`artistPhotoName`). The lookup searches by them alone, so it answers once for every song
 * that has them.
 */
export const releaseAnswerKey = (song: ReleaseKeySong): string =>
  JSON.stringify([artistPhotoName(song.title), artistPhotoName(song.artist)]);

/** [song]'s album as typed dates tell songs apart by it: loosely matched, "" when unknown. */
const albumName = (album: string | null | undefined): string =>
  album === null || album === undefined || album === UNKNOWN_ALBUM ? "" : titleName(album);

/**
 * The key the date the owner typed for [song] is kept under: its title, artist and album,
 * loosely matched (an album's version notes, such as "(Deluxe)", ignored), so "Intro" on two
 * albums keeps two dates. A song whose album isn't known keys it with none.
 */
export const typedReleaseKey = (song: ReleaseKeySong): string =>
  JSON.stringify([
    artistPhotoName(song.title),
    artistPhotoName(song.artist),
    albumName(song.album),
  ]);

/** A typed date, and the key it's kept under. */
export interface TypedReleaseEntry {
  readonly key: string;
  readonly date: ReleaseDate;
}

const findersByDates = new WeakMap<
  Readonly<Record<string, string>>,
  (song: ReleaseKeySong) => TypedReleaseEntry | null
>();

/**
 * The typed date [song] has among [typed] (by `typedReleaseKey`), and the key that holds it:
 * the one typed for its title, artist and album; else, for a song with an album, the one typed
 * for a song with none of the same title and artist; else, for a song with no album, the one
 * date typed for its title and artist on any album, when only one album has one.
 */
export const typedReleaseEntry = (
  typed: Readonly<Record<string, string>>,
  song: ReleaseKeySong,
): TypedReleaseEntry | null => {
  let find = findersByDates.get(typed);
  if (find === undefined) {
    const byTitleAndArtist = new Map<string, string[]>();
    for (const key of Object.keys(typed)) {
      const parsed: unknown = JSON.parse(key);
      if (!Array.isArray(parsed) || parsed.length !== 3) continue;
      const loose = JSON.stringify(parsed.slice(0, 2));
      byTitleAndArtist.set(loose, [...(byTitleAndArtist.get(loose) ?? []), key]);
    }
    const entry = (key: string): TypedReleaseEntry | null => {
      const date = typed[key];
      return date === undefined ? null : { key, date };
    };
    find = (wanted) => {
      const exact = entry(typedReleaseKey(wanted));
      if (exact !== null) return exact;
      if (albumName(wanted.album) !== "") return entry(typedReleaseKey({ ...wanted, album: null }));
      const keys = byTitleAndArtist.get(releaseAnswerKey(wanted)) ?? [];
      return keys.length === 1 && keys[0] !== undefined ? entry(keys[0]) : null;
    };
    findersByDates.set(typed, find);
  }
  return find(song);
};

/** The typed date [song] has among [typed] (`typedReleaseEntry`), null for none. */
export const typedReleaseDateOf = (
  typed: Readonly<Record<string, string>>,
  song: ReleaseKeySong,
): ReleaseDate | null => typedReleaseEntry(typed, song)?.date ?? null;

/** [date] (`1985`, `1985-06` or `1985-06-21`) as [language] says it, as precise as it's known. */
export const formatReleaseDate = (date: string, language: AppLanguage): string => {
  const [year, month, day] = date.split("-").map(Number);
  return catalogueOf(language).playlists.releaseDate(year ?? 0, month ?? null, day ?? null);
};
