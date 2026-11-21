/**
 * Fans might also like and About on the Library's artist page (docs/spec.md,
 * "Artist page"): Wave finds the artist's YouTube Music page by name once,
 * keeps it with the artist's saved answer (`YtArtistSaved`), and reads it
 * again when it's old. Core decides when a lookup is due, how much it reads
 * and what the page shows of what's kept; the app asks and saves.
 */

import { ARTIST_PHOTO_RETRY_MS } from "./artistPhoto.ts";
import { identityKey } from "./library.ts";
import { readStoredTuples, storedTuples, withLatest } from "./storedJson.ts";
import {
  ytArtistAbout,
  ytArtistQuery,
  type YtArtistAbout,
  type YtArtistCandidate,
  type YtArtistSaved,
} from "./ytArtist.ts";
import type { YtQuietReason } from "./ytSearch.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long a kept page shows before it's read again, in the background. */
export const ARTIST_PAGE_KEPT_MS = 30 * DAY_MS;

export interface ArtistPageLookupContext {
  /** The Library artist's name. */
  readonly name: string;
  /** Whether YT Music is on in Settings. */
  readonly enabled: boolean;
  /** Whether a request can be sent now. */
  readonly online: boolean;
  /** Whether the screen has settled. */
  readonly settled: boolean;
  /** Whether the page's own songs and albums are read. */
  readonly contentReady: boolean;
  /** What's saved for the artist, or null for nothing. */
  readonly saved: YtArtistSaved | null;
  /** When a lookup of theirs last got no answer (ms), if one did. */
  readonly failedAt: number | undefined;
  readonly now: number;
}

/** Whether [since] (ms) has reached [wait]; a clock set back waits. */
const reached = (since: number, wait: number): boolean => since >= 0 && since >= wait;

/**
 * Whether to look the artist's YouTube Music page up now: never before the
 * page's own content is read and the screen has settled, never offline, with
 * YT Music off or for a name that isn't an artist's. Then an artist never
 * looked up is due; "no match" is tried again after a week and a lookup that
 * got no answer after a day (the artist-photo lookup's schedule,
 * `ARTIST_PHOTO_RETRY_MS`); a kept page is read again once it's 30 days old
 * (`ARTIST_PAGE_KEPT_MS`), or when it was saved before Wave read the About.
 */
export const artistPageLookupDue = ({
  name,
  enabled,
  online,
  settled,
  contentReady,
  saved,
  failedAt,
  now,
}: ArtistPageLookupContext): boolean => {
  if (!enabled || !online || !settled || !contentReady) return false;
  if (ytArtistQuery(name) === null) return false;
  if (failedAt !== undefined && !reached(now - failedAt, ARTIST_PHOTO_RETRY_MS.failed))
    return false;
  if (saved === null) return true;
  const since = now - saved.checkedAt;
  if (saved.outcome === "unmatched") return reached(since, ARTIST_PHOTO_RETRY_MS.unmatched);
  return saved.page.description === undefined || reached(since, ARTIST_PAGE_KEPT_MS);
};

/**
 * How much a lookup reads given what's [saved]: the page alone, unless the
 * saved page holds every song of the artist (Online read it). That one is
 * read whole again, so the artist's song list is never traded for an About.
 */
export const artistPageLookupReads = (
  saved: YtArtistSaved | null,
): { readonly allSongs: boolean } => ({
  allSongs: saved?.outcome === "found" && saved.page.allSongs !== undefined,
});

/** What the Library's artist page shows of the artist's kept YouTube Music page. */
export interface ArtistPageKept {
  /** Fans might also like, in YouTube Music's order; none when the page lists none. */
  readonly similar: readonly YtArtistCandidate[];
  /** About, or null when the page has no description. */
  readonly about: YtArtistAbout | null;
}

const NOTHING_KEPT: ArtistPageKept = { similar: [], about: null };

/**
 * What shows of what's [saved] for a Library artist: the kept page's similar
 * artists and About, however old it is (it's read again in the background).
 * Nothing with no page kept, with "no match", or with YT Music off.
 */
export const artistPageKept = (saved: YtArtistSaved | null, enabled: boolean): ArtistPageKept =>
  !enabled || saved === null || saved.outcome !== "found"
    ? NOTHING_KEPT
    : { similar: saved.page.similar ?? [], about: ytArtistAbout(saved.page) };

/** How a lookup ended, for the app log: the page kept, no match, or why it got no answer. */
export type ArtistPageLookupEnd = "found" | "unmatched" | YtQuietReason | "disabled";

const LOOKUP_ENDS: Readonly<Record<ArtistPageLookupEnd, string>> = {
  found: "found their page",
  unmatched: "found no match",
  offline: "failed (offline)",
  disabled: "failed (YT Music off)",
  failed: "failed (failed)",
};

/** What the app log says once the lookup of the Library artist [name] ends. */
// not UI text: the app log's line
export const artistPageLookupLine = (name: string, end: ArtistPageLookupEnd): string =>
  `The YouTube Music page lookup for the Library artist "${name}" ${LOOKUP_ENDS[end]}`;

/** When each Library artist's lookup last got no answer (ms), by `identityKey` of the name, the latest last. */
export type ArtistPageLookupFailures = ReadonlyMap<string, number>;

export const NO_ARTIST_PAGE_LOOKUP_FAILURES: ArtistPageLookupFailures = new Map();

/** How many artists' failures are remembered: the latest. */
const FAILURES_KEPT = 200;

/** When [name]'s lookup last got no answer, or undefined when none is remembered. */
export const artistPageLookupFailedAt = (
  failures: ArtistPageLookupFailures,
  name: string,
): number | undefined => failures.get(identityKey(name));

/**
 * [failures] once [name]'s lookup ended at [now]: an answer (null [reason])
 * forgets their failure, a request YouTube Music didn't answer is remembered,
 * and one that couldn't be sent (offline) changes nothing, so it's tried again
 * with the network back.
 */
export const withArtistPageLookupEnded = (
  failures: ArtistPageLookupFailures,
  name: string,
  reason: YtQuietReason | "disabled" | null,
  now: number,
): ArtistPageLookupFailures => {
  if (reason === "offline" || reason === "disabled") return failures;
  const key = identityKey(name);
  if (reason === null && !failures.has(key)) return failures;
  return withLatest(failures, key, reason === null ? null : now, FAILURES_KEPT);
};

/** What to save for [failures]; null (nothing saved) for none. */
export const storedArtistPageLookupFailures = (failures: ArtistPageLookupFailures): string | null =>
  storedTuples(failures, "failures", (key, at) => [key, at]);

/** The failures [stored] holds; none when nothing readable is saved. */
export const parseArtistPageLookupFailures = (stored: string | null): ArtistPageLookupFailures =>
  new Map(
    readStoredTuples(stored, "failures", ([key, at]): readonly [string, number] | null =>
      typeof key === "string" && typeof at === "number" && Number.isFinite(at) ? [key, at] : null,
    ),
  );
