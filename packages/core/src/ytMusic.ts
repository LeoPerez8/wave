/**
 * YT Music songs: songs found on YouTube Music rather than in the Library.
 * A YT Music song is identified by its YouTube video id and becomes a Track
 * only once it's downloaded into the Library. Requests and parsing live in the
 * native module; Core decides how the songs sit beside the Library.
 */

import { finishSteps } from "./buildSteps.ts";
import { splitCredit } from "./credits.ts";
import { UNKNOWN_ARTIST } from "./library.ts";
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
export const joinArtists = (artists: readonly string[]): string =>
  artists.length <= 1
    ? (artists[0] ?? "")
    : `${artists.slice(0, -1).join(", ")} & ${artists[artists.length - 1]}`;

/** A YT Music song's artists as one credit, as the player shows it in place of a track's artist. */
export const ytSongArtist = (song: YtSong): string => joinArtists(song.artists);

/** A YT Music song's line under its title: its artists, then its album when known. */
export const ytSongCredit = (song: YtSong): string =>
  [ytSongArtist(song), song.album].filter((part) => part !== null && part !== "").join(" · ");

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

const REMASTER = /\bremaster(?:ed)?\b/iu;
/** Words that make a note more than a remaster: another take or cut of the song. */
const ANOTHER_VERSION =
  /\b(?:live|edit|mix|remix|demo|acoustic|instrumental|session|take|karaoke|cover)\b/iu;
const BRACKETED_NOTE = /\s*(?:\([^)]*\)|\[[^\]]*\])/gu;
const DASHED_NOTE = /\s+[-–—]\s+([^-–—]*)$/u;

/** Whether [note] only says the song was remastered ("Remastered 2011", "2011 Remaster"). */
const isRemasterNote = (note: string): boolean =>
  REMASTER.test(note) && !ANOTHER_VERSION.test(note);

/**
 * A title without its remaster notes ("(Remastered 2011)", "- 2011 Remaster",
 * "[Remastered]"): a remaster is the same recording. A note that also names
 * another version ("(Live)", "(Remastered Live Version)") stays.
 */
const withoutRemasterNotes = (title: string): string => {
  const bare = title
    .replace(BRACKETED_NOTE, (note) => (isRemasterNote(note) ? "" : note))
    .replace(DASHED_NOTE, (whole, note: string) => (isRemasterNote(note) ? "" : whole))
    .trim();
  return bare === "" ? title : bare;
};

/** A title without its featured-artist credit and remaster notes, as matching compares it. */
export const recordingMatchTitle = (title: string): string =>
  normalizeSearchText(
    withoutRemasterNotes(title.replace(BRACKETED_FEATURE, "").replace(TRAILING_FEATURE, "")),
  );

/** "+" joins artists too when matching ("Florence + Jamie xx"), though the Library keeps it in a name. */
const PLUS = /\s*\+\s*/u;

const UNKNOWN = normalizeSearchText(UNKNOWN_ARTIST);

/**
 * The names in an artist credit ("A feat. B & C" is A, B and C), split as the
 * Library splits credits (`splitCredit`) and on "+", compared as matching
 * compares them. A credit naming nobody gives no names, so it shares no artist.
 */
const artistNames = (credit: string): string[] =>
  credit
    .split(PLUS)
    .flatMap((part) => splitCredit(part))
    .map(normalizeSearchText)
    .filter((name) => name !== "" && name !== UNKNOWN);

const knownLength = (ms: number | null): number | null => (ms === null || ms <= 0 ? null : ms);

interface Candidate<L> {
  readonly song: L;
  readonly artists: ReadonlySet<string>;
  readonly durationMs: number | null;
}

const candidateMatches = (
  candidate: { readonly artists: ReadonlySet<string>; readonly durationMs: number | null },
  artists: readonly string[],
  length: number | null,
): boolean =>
  artists.some((artist) => candidate.artists.has(artist)) &&
  (length === null ||
    candidate.durationMs === null ||
    Math.abs(candidate.durationMs - length) <= SAME_LENGTH_MS);

/** Compare one Library candidate with one streamed song, without building a Library finder. */
export const recordingMatches = (
  library: LibrarySongKey,
  song: Pick<YtSong, "title" | "artists" | "durationMs">,
): boolean => {
  const title = recordingMatchTitle(library.title);
  return (
    title !== "" &&
    title === recordingMatchTitle(song.title) &&
    candidateMatches(
      {
        artists: new Set(artistNames(library.artist)),
        durationMs: knownLength(library.durationMs),
      },
      song.artists.flatMap(artistNames),
      knownLength(song.durationMs),
    )
  );
};

/**
 * The Library song a YT Music song already is, or null: one with its title
 * (case, accents, punctuation, featured credits and remaster notes aside) that shares an
 * artist with it and, when both lengths are known, is as long within a few
 * seconds, so a live take or an edit of the same song is a different song.
 */
export const libraryFinder = <L extends LibrarySongKey>(
  library: readonly L[],
): ((song: Pick<YtSong, "title" | "artists" | "durationMs">) => L | null) => {
  const matches = libraryMatches(library);
  return (song) => matches(song)[0] ?? null;
};

/**
 * Every Library song a YT Music song could be, as [libraryFinder] matches
 * them, in Library order: a caller that can't tell them apart by length can
 * refuse to guess.
 */
export const libraryMatches = <L extends LibrarySongKey>(
  library: readonly L[],
): ((song: Pick<YtSong, "title" | "artists" | "durationMs">) => L[]) =>
  finishSteps(libraryMatchesSteps(library));

export function* libraryMatchesSteps<L extends LibrarySongKey>(
  library: readonly L[],
): Generator<void, (song: Pick<YtSong, "title" | "artists" | "durationMs">) => L[]> {
  const byTitle = new Map<string, Candidate<L>[]>();
  for (const song of library) {
    yield;
    const title = recordingMatchTitle(song.title);
    if (title === "") continue;
    const candidates = byTitle.get(title) ?? [];
    candidates.push({
      song,
      artists: new Set(artistNames(song.artist)),
      durationMs: knownLength(song.durationMs),
    });
    byTitle.set(title, candidates);
  }
  return (song) => {
    const candidates = byTitle.get(recordingMatchTitle(song.title));
    if (candidates === undefined) return [];
    const artists = song.artists.flatMap(artistNames);
    const length = knownLength(song.durationMs);
    return candidates
      .filter((candidate) => candidateMatches(candidate, artists, length))
      .map((candidate) => candidate.song);
  };
}

/**
 * Whether a YT Music song is already in the Library (see [libraryFinder]),
 * so a live take or an edit of the same song still shows.
 */
export const libraryMatcher = (library: readonly LibrarySongKey[]): ((song: YtSong) => boolean) => {
  const find = libraryFinder(library);
  return (song) => find(song) !== null;
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

export function* libraryFinderSteps<L extends LibrarySongKey>(
  library: readonly L[],
): Generator<void, (song: Pick<YtSong, "title" | "artists" | "durationMs">) => L | null> {
  const matches = yield* libraryMatchesSteps(library);
  return (song) => matches(song)[0] ?? null;
}
