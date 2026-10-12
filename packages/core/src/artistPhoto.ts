/**
 * Artist photos: which online artist a library artist is (a confident match
 * or none), and when a lookup is due. Fetching lives in the app.
 */

import { foldAccentsAndCase } from "./library.ts";

/**
 * An artist's name as photo matching compares it: case, accents, a leading
 * "The", punctuation and "&" versus "and" don't count.
 */
export const artistPhotoName = (name: string): string =>
  foldAccentsAndCase(name)
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/^the (?=\S)/, "");

/** Stand-ins tags use where there is no single artist (as `artistPhotoName` reads them). */
const NOT_AN_ARTIST = new Set([
  "various artists",
  "various",
  "v a",
  "va",
  "unknown artist",
  "unknown",
]);

/**
 * The name to search a photo for, or null when the name isn't an artist's
 * ("Various Artists", "Unknown Artist", no letters): those are never looked up.
 */
export const artistPhotoQuery = (name: string): string | null => {
  const compared = artistPhotoName(name);
  if (compared === "" || NOT_AN_ARTIST.has(compared)) return null;
  return name.replace(/\s+/g, " ").trim();
};

/** An artist an online search found. */
export interface ArtistPhotoCandidate {
  readonly name: string;
  /** How followed the artist is: tells namesakes apart. */
  readonly fans: number;
  /** The photo for lists, or null when the service has none. */
  readonly thumbUrl: string | null;
  /** The photo for the artist page, or null when the service has none. */
  readonly largeUrl: string | null;
}

/** A photo to download, in both sizes. */
export interface ArtistPhotoUrls {
  readonly thumbUrl: string;
  readonly largeUrl: string;
}

/**
 * The photo of [name] among [candidates], or null without a confident match:
 * only artists whose name matches (`artistPhotoName`) count and, of namesakes,
 * the most followed one is the artist. Its photo or none: a lesser namesake's
 * photo would show the wrong person.
 */
export const pickArtistPhoto = (
  name: string,
  candidates: readonly ArtistPhotoCandidate[],
): ArtistPhotoUrls | null => {
  if (artistPhotoQuery(name) === null) return null;
  const wanted = artistPhotoName(name);
  let best: ArtistPhotoCandidate | undefined;
  for (const candidate of candidates) {
    if (artistPhotoName(candidate.name) !== wanted) continue;
    if (best === undefined || candidate.fans > best.fans) best = candidate;
  }
  const thumbUrl = best?.thumbUrl ?? best?.largeUrl ?? null;
  const largeUrl = best?.largeUrl ?? best?.thumbUrl ?? null;
  return thumbUrl === null || largeUrl === null ? null : { thumbUrl, largeUrl };
};

/** Deezer's open search (no account or key): artists matching [query], best first. */
export const deezerArtistSearchUrl = (query: string): string =>
  `https://api.deezer.com/search/artist?q=${encodeURIComponent(query)}&limit=10`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** A Deezer picture URL, or null for none or the blank placeholder (`/images/artist//…`). */
const deezerPicture = (value: unknown): string | null =>
  typeof value === "string" && value.startsWith("https://") && !value.includes("/artist//")
    ? value
    : null;

/**
 * The artists in a Deezer search response, in its order; null when the
 * response isn't a search result (an error, a quota message): a failed lookup.
 */
export const deezerArtistCandidates = (response: unknown): ArtistPhotoCandidate[] | null => {
  if (!isRecord(response) || !Array.isArray(response.data)) return null;
  return response.data.flatMap((artist: unknown) => {
    if (!isRecord(artist) || typeof artist.name !== "string") return [];
    return [
      {
        name: artist.name,
        fans: typeof artist.nb_fan === "number" ? artist.nb_fan : 0,
        thumbUrl: deezerPicture(artist.picture_medium),
        largeUrl: deezerPicture(artist.picture_xl) ?? deezerPicture(artist.picture_big),
      },
    ];
  });
};

/** How a photo lookup went: a photo saved, no confident match, or no answer (offline, an error). */
export type ArtistPhotoOutcome = "found" | "unmatched" | "failed";

/** The last lookup of an artist's photo. */
export interface ArtistPhotoCheck {
  readonly outcome: ArtistPhotoOutcome;
  /** When it was made (ms since the epoch). */
  readonly checkedAt: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** How long until a lookup is tried again; a found photo is kept for good. */
export const ARTIST_PHOTO_RETRY_MS: Readonly<Record<Exclude<ArtistPhotoOutcome, "found">, number>> =
  { unmatched: 7 * DAY_MS, failed: DAY_MS };

const isDue = (check: ArtistPhotoCheck | undefined, now: number): boolean => {
  if (check === undefined) return true;
  if (check.outcome === "found") return false;
  const since = now - check.checkedAt;
  return since >= 0 && since >= ARTIST_PHOTO_RETRY_MS[check.outcome];
};

/**
 * The artists whose photo to look up now, in the order given, with the name to
 * search: never looked up, or a miss whose retry time has come (see
 * `ARTIST_PHOTO_RETRY_MS`). [checks] is keyed by artist key.
 */
export const artistPhotoLookups = <A extends { readonly key: string; readonly name: string }>(
  artists: readonly A[],
  checks: ReadonlyMap<string, ArtistPhotoCheck>,
  now: number,
): (A & { readonly query: string })[] =>
  artists.flatMap((artist) => {
    const query = artistPhotoQuery(artist.name);
    return query !== null && isDue(checks.get(artist.key), now) ? [{ ...artist, query }] : [];
  });

/** Failed lookups in a row at which the service counts as unreachable. */
const UNREACHABLE_AFTER_FAILURES = 3;

/** Failed lookups in a row, once one more lookup went [outcome]: any answer starts again from 0. */
export const failuresInARow = (before: number, outcome: ArtistPhotoOutcome): number =>
  outcome === "failed" ? before + 1 : 0;

/**
 * Whether [failures] in a row mean the photo service can't be reached (no
 * connection): lookups stop until the next run rather than fail one by one.
 */
export const artistPhotosUnreachable = (failures: number): boolean =>
  failures >= UNREACHABLE_AFTER_FAILURES;
