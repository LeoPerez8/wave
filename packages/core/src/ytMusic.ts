/**
 * YT Music songs: songs found on YouTube Music rather than in the Library.
 * A YT Music song is identified by its YouTube video id and becomes a Track
 * only once it's downloaded into the Library. Requests and parsing live in the
 * native module; Core decides how the songs sit beside the Library.
 */

import { normalizeSearchText } from "./search.ts";

/** A song found on YouTube Music. */
export interface YtSong {
  readonly videoId: string;
  readonly title: string;
  /** Its artists, as YouTube Music credits them (at least one). */
  readonly artists: readonly string[];
  /** The album it's on, when YouTube Music says. */
  readonly album: string | null;
  readonly durationMs: number | null;
  /** The cover's address on YouTube's image server, when there is one. */
  readonly artworkUrl: string | null;
  readonly explicit: boolean;
}

/** The artists as one credit: "A", "A & B", "A, B & C". */
const joinArtists = (artists: readonly string[]): string =>
  artists.length <= 1
    ? (artists[0] ?? "")
    : `${artists.slice(0, -1).join(", ")} & ${artists[artists.length - 1]}`;

/** A YT Music song's line under its title: its artists, then its album when known. */
export const ytSongCredit = (song: YtSong): string =>
  [joinArtists(song.artists), song.album].filter((part) => part !== null && part !== "").join(" · ");

/** A Library song as matching sees it. */
export interface LibrarySongKey {
  readonly title: string;
  readonly artist: string;
  /** 0 when the file's length couldn't be read. */
  readonly durationMs: number;
}

/** Lengths this close are one recording: YouTube rounds to the second, and masters differ slightly. */
const SAME_LENGTH_MS = 3000;

const FEATURING = String.raw`(?:feat\.?|ft\.?|featuring|with)`;
const BRACKETED_FEATURE = new RegExp(String.raw`\s*[([]${FEATURING}\s[^)\]]*[)\]]`, "giu");
const TRAILING_FEATURE = new RegExp(String.raw`\s+(?:feat\.?|ft\.?|featuring)\s.*$`, "iu");
const ARTIST_SEPARATORS = /\s*(?:,|&|;|\/|\+|\bx\b|\band\b|\bfeat\.?|\bft\.?|\bfeaturing\b|\bwith\b)\s*/giu;

/** A title without its featured-artist credit, as matching compares it. */
const matchTitle = (title: string): string =>
  normalizeSearchText(title.replace(BRACKETED_FEATURE, "").replace(TRAILING_FEATURE, ""));

/** The names in an artist credit ("A feat. B & C" is A, B and C), as matching compares them. */
const artistNames = (credit: string): string[] =>
  credit
    .split(ARTIST_SEPARATORS)
    .map(normalizeSearchText)
    .filter((name) => name !== "");

const knownLength = (ms: number | null): number | null => (ms === null || ms <= 0 ? null : ms);

interface Candidate {
  readonly artists: ReadonlySet<string>;
  readonly durationMs: number | null;
}

/**
 * Whether a YT Music song is already in the Library: a Library song has its
 * title (case, accents, punctuation and featured credits aside), shares an
 * artist with it and, when both lengths are known, is as long within a few
 * seconds, so a live take or an edit of the same song still shows.
 */
export const libraryMatcher = (
  library: readonly LibrarySongKey[],
): ((song: YtSong) => boolean) => {
  const byTitle = new Map<string, Candidate[]>();
  for (const song of library) {
    const title = matchTitle(song.title);
    if (title === "") continue;
    const candidates = byTitle.get(title) ?? [];
    candidates.push({
      artists: new Set(artistNames(song.artist)),
      durationMs: knownLength(song.durationMs),
    });
    byTitle.set(title, candidates);
  }
  return (song) => {
    const candidates = byTitle.get(matchTitle(song.title));
    if (candidates === undefined) return false;
    const artists = song.artists.flatMap(artistNames);
    const length = knownLength(song.durationMs);
    return candidates.some(
      (candidate) =>
        artists.some((artist) => candidate.artists.has(artist)) &&
        (length === null ||
          candidate.durationMs === null ||
          Math.abs(candidate.durationMs - length) <= SAME_LENGTH_MS),
    );
  };
};

/** What a queue track id stands for: a Library track or a YT Music song. */
export type TrackRef =
  | { readonly kind: "library"; readonly id: number }
  | { readonly kind: "yt"; readonly videoId: string };

const YT_PREFIX = "yt:";

/**
 * The track id a YT Music song goes by in the queue. Library ids are numbers,
 * so the prefix keeps the two apart.
 */
export const ytTrackId = (videoId: string): string => `${YT_PREFIX}${videoId}`;

/** What [id] stands for, or null when it's neither a Library id nor a YT Music song's. */
export const parseTrackId = (id: string): TrackRef | null => {
  if (id.startsWith(YT_PREFIX)) {
    const videoId = id.slice(YT_PREFIX.length);
    return videoId === "" ? null : { kind: "yt", videoId };
  }
  return /^\d+$/.test(id) ? { kind: "library", id: Number(id) } : null;
};
