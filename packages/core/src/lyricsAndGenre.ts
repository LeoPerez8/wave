/**
 * Fix Song: finding what a song lacks of its lyrics (LRCLIB), genre, track
 * number, year and explicit flag (Deezer) online. Which songs it's for, what is asked and
 * sent, which result is the song, what is written and how a run went.
 * Fetching and writing the tags live in the app and the native module.
 */

import { artistPhotoName, artistPhotoQuery } from "./artistPhoto.ts";
import type { ExplicitFlag } from "./explicit.ts";
import { UNKNOWN_ALBUM } from "./library.ts";

/** What a lookup sends about a song: nothing else leaves the phone. */
export interface SongLookup {
  readonly title: string;
  readonly artist: string;
  /** Null for a song without an album tag. */
  readonly album: string | null;
  /** 0 when unknown. */
  readonly durationMs: number;
}

const tidy = (value: string): string => value.replace(/\s+/g, " ").trim();

/**
 * What to look [song] up by, or null when it can't be told apart from other
 * songs (no title, or an "Unknown Artist" / "Various Artists" stand-in): those
 * are never looked up.
 */
export const songLookup = (song: {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly durationMs: number;
}): SongLookup | null => {
  const title = tidy(song.title);
  const artist = artistPhotoQuery(song.artist);
  if (title === "" || artist === null) return null;
  const album = tidy(song.album);
  return {
    title,
    artist,
    album: album === "" || album === UNKNOWN_ALBUM ? null : album,
    durationMs: song.durationMs,
  };
};

/** A featured-artist credit and everything after it: "Song (feat. X)", "Artist ft. X". */
const FEATURING = /\s*[([]?\s*\b(?:feat|ft|featuring)\b\.?\s.*$/i;
/** A version note after a dash: "Song - Remastered 2011", "Song - Live". */
const VERSION_NOTE =
  /\s+[-–—]\s+.*\b(?:remaster(?:ed)?|live|mono|stereo|version|edit|mix|remix|demo|acoustic|bonus|single|radio|explicit|deluxe|\d{4})\b.*$/i;
/** A note in brackets: "Song (Live)", "Song [Remastered]". */
const BRACKETED = /\s*(?:\([^)]*\)|\[[^\]]*\])/g;

/**
 * A song title as matching compares it: what `artistPhotoName` ignores, plus
 * featured artists and version notes ("(Live)", "- Remastered 2011"), which
 * the length check tells apart instead.
 */
const titleName = (title: string): string => {
  const bare = title.replace(FEATURING, "").replace(VERSION_NOTE, "").replace(BRACKETED, "");
  return artistPhotoName(artistPhotoName(bare) === "" ? title : bare);
};

/** An artist as matching compares it: `artistPhotoName`, without featured artists. */
const artistName = (artist: string): string => {
  const bare = artist.replace(FEATURING, "");
  return artistPhotoName(artistPhotoName(bare) === "" ? artist : bare);
};

/** Whether a result's title and artist are [song]'s. */
const isSameSong = (song: SongLookup, title: string, artist: string): boolean =>
  titleName(title) === titleName(song.title) && artistName(artist) === artistName(song.artist);

/** Whether a result is from [song]'s album. */
const isSameAlbum = (song: SongLookup, album: string | null): boolean =>
  song.album !== null && album !== null && titleName(album) === titleName(song.album);

/** How far a result's length is from [song]'s; 0 when either is unknown. */
const lengthGap = (song: SongLookup, durationMs: number): number =>
  song.durationMs > 0 && durationMs > 0 ? Math.abs(song.durationMs - durationMs) : 0;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/** Lyrics found for a song: LRC when [synced], plain text otherwise. */
export interface FoundLyrics {
  readonly synced: boolean;
  readonly text: string;
}

/** A song an LRCLIB search found. */
export interface LyricsCandidate {
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  /** 0 when unknown. */
  readonly durationMs: number;
  readonly instrumental: boolean;
  readonly plain: string | null;
  /** LRC. */
  readonly synced: string | null;
}

/** How LRCLIB asks clients to name themselves. */
export const LRCLIB_HEADERS = {
  "User-Agent": "Wave (https://github.com/LeoPerez8/wave)",
} as const;

/** LRCLIB's search (free, no key) for [song]: by title and artist; the album and length pick among results. */
export const lrclibSearchUrl = (song: SongLookup): string =>
  `https://lrclib.net/api/search?track_name=${encodeURIComponent(song.title)}&artist_name=${encodeURIComponent(song.artist)}`;

/**
 * The songs in an LRCLIB search response, in its order; null when the response
 * isn't a search result (an error, a rate limit): a failed lookup.
 */
export const lrclibCandidates = (response: unknown): LyricsCandidate[] | null => {
  if (!Array.isArray(response)) return null;
  return response.flatMap((song: unknown) => {
    if (!isRecord(song) || typeof song.trackName !== "string") return [];
    if (typeof song.artistName !== "string") return [];
    return [
      {
        title: song.trackName,
        artist: song.artistName,
        album: text(song.albumName),
        durationMs: typeof song.duration === "number" ? Math.round(song.duration * 1000) : 0,
        instrumental: song.instrumental === true,
        plain: text(song.plainLyrics),
        synced: text(song.syncedLyrics),
      },
    ];
  });
};

/** How far apart (ms) a result's length may be from the song's: LRCLIB's own tolerance. */
const LYRICS_LENGTH_TOLERANCE_MS = 2000;

/**
 * [song]'s lyrics among [candidates], or null without a confident match. Only
 * results with the song's title and artist (see `titleName`) and, when both
 * lengths are known, within 2 seconds of its length count. Synced lyrics win
 * over plain ones; then a result from the song's album; then the closest length.
 */
export const pickFoundLyrics = (
  song: SongLookup,
  candidates: readonly LyricsCandidate[],
): FoundLyrics | null => {
  let best: { found: FoundLyrics; rank: readonly number[] } | null = null;
  for (const candidate of candidates) {
    if (candidate.instrumental || !isSameSong(song, candidate.title, candidate.artist)) continue;
    const gap = lengthGap(song, candidate.durationMs);
    if (gap > LYRICS_LENGTH_TOLERANCE_MS) continue;
    const synced = text(candidate.synced);
    const plain = text(candidate.plain);
    const found =
      synced !== null
        ? { synced: true, text: synced }
        : plain !== null
          ? { synced: false, text: plain }
          : null;
    if (found === null) continue;
    const rank = [found.synced ? 0 : 1, isSameAlbum(song, candidate.album) ? 0 : 1, gap];
    if (best === null || isBetter(rank, best.rank)) best = { found, rank };
  }
  return best?.found ?? null;
};

/** A track a Deezer search found, with the album it is on. */
export interface GenreCandidate {
  readonly trackId: number;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly albumId: number;
  /** 0 when unknown. */
  readonly durationMs: number;
  /** Deezer's `explicit_lyrics`; unknown when the response doesn't say. */
  readonly explicit: ExplicitFlag;
}

/**
 * Deezer's open track search (no account or key) for [song], by artist and
 * title; its album's genre is the song's. (Deezer's `artist:"…"` filters
 * return nothing for many songs, so this is a plain query.)
 */
export const deezerTrackSearchUrl = (song: SongLookup): string =>
  `https://api.deezer.com/search/track?q=${encodeURIComponent(`${song.artist} ${song.title}`)}&limit=25`;

/** The tracks in a Deezer search response, in its order; null when it isn't a search result. */
export const deezerTrackCandidates = (response: unknown): GenreCandidate[] | null => {
  if (!isRecord(response) || !Array.isArray(response.data)) return null;
  return response.data.flatMap((track: unknown) => {
    if (!isRecord(track) || typeof track.id !== "number" || typeof track.title !== "string")
      return [];
    const { artist, album } = track;
    if (!isRecord(artist) || typeof artist.name !== "string") return [];
    if (!isRecord(album) || typeof album.id !== "number" || typeof album.title !== "string")
      return [];
    return [
      {
        trackId: track.id,
        title: track.title,
        artist: artist.name,
        album: album.title,
        albumId: album.id,
        durationMs: typeof track.duration === "number" ? track.duration * 1000 : 0,
        explicit:
          typeof track.explicit_lyrics === "boolean"
            ? track.explicit_lyrics
              ? "explicit"
              : "clean"
            : "unknown",
      },
    ];
  });
};

/** The Deezer track that is a song, and whether it's on the song's own album. */
export interface DeezerMatch {
  readonly trackId: number;
  readonly albumId: number;
  /**
   * Whether Deezer's album is the song's (titles compared as matching does):
   * only then do its year and the track's place on it describe the song's file.
   */
  readonly onSongsAlbum: boolean;
  /**
   * Whether Deezer marks the track explicit (its `explicit_lyrics`), whichever
   * album it's on: the search's answer, so the flag costs no request.
   */
  readonly explicit: ExplicitFlag;
}

/**
 * The Deezer track that is [song], or null without a confident match: a track
 * with the song's title and artist, preferring one on the song's own album,
 * then the closest length. Its album's genre is the song's.
 */
export const pickDeezerTrack = (
  song: SongLookup,
  candidates: readonly GenreCandidate[],
): DeezerMatch | null => {
  let best: { match: DeezerMatch; rank: readonly number[] } | null = null;
  for (const candidate of candidates) {
    if (!isSameSong(song, candidate.title, candidate.artist)) continue;
    const onSongsAlbum = isSameAlbum(song, candidate.album);
    const rank = [onSongsAlbum ? 0 : 1, lengthGap(song, candidate.durationMs)];
    if (best === null || isBetter(rank, best.rank)) {
      const { trackId, albumId, explicit } = candidate;
      best = { match: { trackId, albumId, onSongsAlbum, explicit }, rank };
    }
  }
  return best?.match ?? null;
};

/** A Deezer album, which lists its genres. */
export const deezerAlbumUrl = (albumId: number): string =>
  `https://api.deezer.com/album/${albumId}`;

/** What Wave takes from a Deezer album: its genre and the year it came out. */
export interface DeezerAlbum {
  readonly genre: string | null;
  readonly year: number | null;
}

/** The year of a Deezer `release_date` ("1997-05-21"); null when missing or malformed ("0000-00-00"). */
const releaseYear = (value: unknown): number | null => {
  const match = typeof value === "string" ? /^(\d{4})(?:-\d{2}-\d{2})?$/.exec(value.trim()) : null;
  const year = match === null ? 0 : Number(match[1]);
  return year > 0 ? year : null;
};

/**
 * The genre (its first one) and year of a Deezer album response; each is null
 * when the album doesn't give it. The whole result is null when the response
 * isn't an album (a failed lookup).
 */
export const deezerAlbum = (response: unknown): DeezerAlbum | null => {
  if (!isRecord(response) || typeof response.id !== "number") return null;
  const genres = isRecord(response.genres) ? response.genres.data : undefined;
  const first: unknown = Array.isArray(genres) ? genres[0] : undefined;
  return {
    genre: isRecord(first) ? (text(first.name)?.trim() ?? null) : null,
    year: releaseYear(response.release_date),
  };
};

/**
 * A Deezer album's tracklist, which says where each track sits on it. One
 * page holds any real album (Deezer's default page is 25 tracks).
 */
export const deezerAlbumTracksUrl = (albumId: number): string =>
  `https://api.deezer.com/album/${albumId}/tracks?limit=500`;

/** Where a track sits on a Deezer album. */
export interface DeezerAlbumTrack {
  readonly trackId: number;
  readonly trackNumber: number;
  /** Null when Deezer doesn't give one. */
  readonly discNumber: number | null;
}

const positive = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

/**
 * The tracks of a Deezer album tracklist response with their place on it
 * (tracks without a number are left out); null when the response isn't a
 * tracklist (a failed lookup).
 */
export const deezerAlbumTracks = (response: unknown): DeezerAlbumTrack[] | null => {
  if (!isRecord(response) || !Array.isArray(response.data)) return null;
  return response.data.flatMap((track: unknown) => {
    if (!isRecord(track) || typeof track.id !== "number") return [];
    const trackNumber = positive(track.track_position);
    if (trackNumber === null) return [];
    return [{ trackId: track.id, trackNumber, discNumber: positive(track.disk_number) }];
  });
};

/**
 * What Deezer says about a song: its album's genre and year, and where it
 * sits on that album (the disc only for an album on more than one disc). Each
 * is null when unknown. And whether it's explicit, from the matched track
 * (unknown when Deezer doesn't say).
 */
export interface DeezerTags {
  readonly genre: string | null;
  readonly trackNumber: number | null;
  readonly discNumber: number | null;
  readonly year: number | null;
  readonly explicit: ExplicitFlag;
}

/**
 * What Deezer says about the song [match] is, from its [album] (null when not
 * fetched: the song has its genre and year) and that album's [tracklist]
 * (null when not fetched: the song has a number). The genre is always the
 * album's and the explicit flag the track's; the year and the track's place
 * only when the album is the song's own (`DeezerMatch.onSongsAlbum`), since
 * another album (a compilation, a live record) numbers and dates it differently.
 */
export const deezerTags = (
  match: DeezerMatch,
  album: DeezerAlbum | null,
  tracklist: readonly DeezerAlbumTrack[] | null,
): DeezerTags => {
  const genre = album?.genre ?? null;
  const { explicit } = match;
  if (!match.onSongsAlbum)
    return { genre, trackNumber: null, discNumber: null, year: null, explicit };
  const place = tracklist?.find((track) => track.trackId === match.trackId);
  const discs = tracklist?.some((track) => (track.discNumber ?? 1) > 1) ?? false;
  return {
    genre,
    trackNumber: place?.trackNumber ?? null,
    discNumber: discs ? (place?.discNumber ?? null) : null,
    year: album?.year ?? null,
    explicit,
  };
};

/**
 * What a lookup found for a song: its lyrics (LRCLIB) and what Deezer says
 * (`DeezerTags`). Any of them may be missing.
 */
export interface FoundTags extends DeezerTags {
  readonly lyrics: FoundLyrics | null;
}

const NOTHING_FROM_DEEZER: DeezerTags = {
  genre: null,
  trackNumber: null,
  discNumber: null,
  year: null,
  explicit: "unknown",
};

/** Where a found tag went: the file's tags, nowhere for a format without tag writing, or none to write. */
export type TagDestination = "tags" | "notWritten" | "none";

/**
 * Where the native writer put what was found: lyrics in the file's tags or,
 * for a format it can't write tags to, a sidecar `.lrc`; the genre, track
 * number (with the disc), year and explicit flag (the advisory tag) in the
 * tags or, for such a format, nowhere (`notWritten`). `none`: nothing to
 * write, or (track number, year, explicit flag) the file already has one and
 * keeps it.
 */
export interface TagWriteReport {
  readonly lyrics: "tags" | "sidecar" | "none";
  readonly genre: TagDestination;
  readonly trackNumber: TagDestination;
  readonly year: TagDestination;
  readonly explicit: TagDestination;
}

/** How fixing a song went. */
export type SongTagOutcome =
  | { readonly kind: "updated"; readonly written: TagWriteReport }
  /** Nothing found: the file is left as it was. */
  | { readonly kind: "notFound" }
  /**
   * LRCLIB or Deezer couldn't be reached (`lookup`), the file couldn't be
   * written (`write`), or no lyrics were found and the format can't take the
   * genre found (`format`). The file is left as it was.
   */
  | { readonly kind: "failed"; readonly reason: "lookup" | "write" | "format" };

/** How one service's lookup went: what it answered (null: nothing matched), or it couldn't be reached. */
export type TagLookup<A> = { readonly ok: true; readonly value: A } | { readonly ok: false };

/**
 * What a song's lookups found, each settled on its own: a service that
 * couldn't be reached found nothing, and what the other found is kept. A
 * service Fix Song didn't ask (null: nothing it could say was missing) found
 * nothing too. Null (a failed lookup, which counts towards
 * `lookupsUnreachable`) only when no service asked answered.
 */
export const settledTags = (
  lyrics: TagLookup<FoundLyrics | null> | null,
  deezer: TagLookup<DeezerTags | null> | null,
): FoundTags | null => {
  if (lyrics?.ok !== true && deezer?.ok !== true) return null;
  return {
    lyrics: lyrics?.ok === true ? lyrics.value : null,
    ...((deezer?.ok === true ? deezer.value : null) ?? NOTHING_FROM_DEEZER),
  };
};

/**
 * The outcome of a lookup that found [found] (what was to be written) and,
 * when anything was, wrote it as [written]. Writing anything is an update,
 * the track number, year or explicit flag alone included. A format that can't
 * take the track number, year or explicit flag isn't a failure on its own:
 * only a genre it can't take, with no lyrics for a sidecar, fails.
 */
export const songTagOutcome = (
  found: FoundTags,
  written: TagWriteReport | null,
): SongTagOutcome => {
  const foundAny =
    found.lyrics !== null ||
    found.genre !== null ||
    found.trackNumber !== null ||
    found.year !== null ||
    found.explicit !== "unknown";
  if (!foundAny || written === null) return { kind: "notFound" };
  const wroteAny =
    written.lyrics !== "none" ||
    written.genre === "tags" ||
    written.trackNumber === "tags" ||
    written.year === "tags" ||
    written.explicit === "tags";
  if (wroteAny) return { kind: "updated", written };
  if (written.genre === "notWritten") return { kind: "failed", reason: "format" };
  return { kind: "notFound" };
};

const FAILURES: Record<
  "lookup" | "write" | "format",
  (title: string) => { title: string; message: string }
> = {
  lookup: (title) => ({
    title: `Couldn't look up “${title}”`,
    message: "LRCLIB or Deezer couldn't be reached. The file wasn't changed.",
  }),
  write: (title) => ({
    title: `Couldn't update “${title}”`,
    message: "Wave couldn't write to the file. It wasn't changed.",
  }),
  format: (title) => ({
    title: `Couldn't update “${title}”`,
    message:
      "No lyrics were found, and Wave can't write tags to this file's format. It wasn't changed.",
  }),
};

/** Lookups failing in a row at which the services count as unreachable (no connection). */
const UNREACHABLE_AFTER_FAILURES = 3;

/**
 * Whether the last outcomes (in the order they ended) mean LRCLIB and Deezer
 * can't be reached: a run stops rather than fail song by song. Files that
 * couldn't be written don't count: the services answered.
 */
export const lookupsUnreachable = (outcomes: readonly SongTagOutcome[]): boolean => {
  const last = outcomes.slice(-UNREACHABLE_AFTER_FAILURES);
  return (
    last.length === UNREACHABLE_AFTER_FAILURES &&
    last.every((outcome) => outcome.kind === "failed" && outcome.reason === "lookup")
  );
};

/** What the Library index knows about a song's lyrics and genre. */
export interface IndexedLyricsAndGenre {
  /** Lyrics in the file's tags or in a sidecar `.lrc`. */
  readonly hasLyrics: boolean;
  /** Null for a song without a genre tag. */
  readonly genre: string | null;
}

/** What the Library index knows about a song's place on its album and its year. */
export interface IndexedPlace {
  /** Null for a song without a track number tag. */
  readonly trackNumber: number | null;
  /** Null for a song without a year tag. */
  readonly year: number | null;
}

/** What the Library index knows about the tags a lookup finds. */
export interface IndexedTags extends IndexedLyricsAndGenre, IndexedPlace {
  /**
   * Its advisory tag's flag (Core's `explicitFromAdvisory`): unknown when it
   * was never checked, which Fix Song fills in from Deezer's match.
   */
  readonly explicit: ExplicitFlag;
  /**
   * Its file, when known: one in a format Wave can't write tags to (`.opus`,
   * raw `.aac`) can't take the flag, so it never lacks one. An Opus stream in
   * an `.ogg` file isn't told apart by its name and still counts as lacking it.
   */
  readonly path?: string | null;
}

/** Extensions of the formats Wave can't write tags to (`SongTagWriter.takesTags`). */
const UNTAGGABLE = /\.(?:opus|aac)$/i;

/** Whether a track number or year is missing (0 counts as missing). */
const lacks = (value: number | null): boolean => value === null || value <= 0;

const lacksGenre = (song: IndexedLyricsAndGenre): boolean => (song.genre ?? "").trim() === "";

/**
 * Whether [song]'s explicit flag was never checked (no advisory tag) and its
 * file can take one: Fix Song would write it.
 */
const lacksFlag = (song: IndexedTags): boolean =>
  song.explicit === "unknown" && !UNTAGGABLE.test(song.path ?? "");

/**
 * Whether Fix Song can do something for [song]: it lacks lyrics, a genre, a
 * track number, a year or a checked explicit flag. Only such songs offer it,
 * and only they are fixed.
 */
export const canFixSong = (song: IndexedTags): boolean =>
  !song.hasLyrics ||
  lacksGenre(song) ||
  lacks(song.trackNumber) ||
  lacks(song.year) ||
  lacksFlag(song);

/**
 * Which of [songs] Fix Song works on: those it can do something for
 * (`canFixSong`), in the order given, each file once. The others are skipped
 * (and counted for the summary, each file once), so running it again on the
 * whole Library only does new or incomplete songs. Songs started while a run
 * goes on join it: the files [given] holds (those the run was given already,
 * fixed or skipped) are left out, not counted again.
 */
export const songsToFix = <S extends IndexedTags>(
  songs: readonly S[],
  given: ReadonlySet<string> = new Set(),
): { readonly fix: S[]; readonly skipped: number } => {
  const seen = new Set<string>();
  const fix: S[] = [];
  let skipped = 0;
  for (const song of songs) {
    if (song.path != null) {
      if (given.has(song.path) || seen.has(song.path)) continue;
      seen.add(song.path);
    }
    if (canFixSong(song)) fix.push(song);
    else skipped += 1;
  }
  return { fix, skipped };
};

/**
 * Which services Fix Song asks about [song]: LRCLIB only when it has no
 * lyrics, Deezer only when it lacks a genre, a track number, a year or a
 * checked explicit flag (its search's match carries the flag, so that needs
 * no request of its own). A request whose answer couldn't fill anything isn't made.
 */
export const fixLookups = (
  song: IndexedTags,
): { readonly lyrics: boolean; readonly deezer: boolean } => ({
  lyrics: !song.hasLyrics,
  deezer: lacksGenre(song) || lacks(song.trackNumber) || lacks(song.year) || lacksFlag(song),
});

/**
 * Which of Deezer's requests after its search Fix Song makes for [song], now
 * that [match] is the song: the album for a missing genre, or for a missing
 * year when the album is the song's own (only then is its year the song's);
 * the tracklist for a missing track number, on the song's own album.
 */
export const deezerFollowUps = (
  song: IndexedTags,
  match: DeezerMatch,
): { readonly album: boolean; readonly tracklist: boolean } => ({
  album: lacksGenre(song) || (lacks(song.year) && match.onSongsAlbum),
  tracklist: lacks(song.trackNumber) && match.onSongsAlbum,
});

/**
 * What of [found] to write into [song]: only what it lacks. Lyrics, a genre,
 * a track number (with its disc), a year or an explicit flag (explicit or
 * clean, from a YT Music download or another app) the song has are never
 * replaced, so a file tagged by hand keeps its values even when a lookup
 * matched the wrong release. Nothing left means there's nothing to write.
 */
export const missingTags = (found: FoundTags, song: IndexedTags): FoundTags => ({
  lyrics: song.hasLyrics ? null : found.lyrics,
  genre: lacksGenre(song) ? found.genre : null,
  trackNumber: lacks(song.trackNumber) ? found.trackNumber : null,
  discNumber: lacks(song.trackNumber) ? found.discNumber : null,
  year: lacks(song.year) ? found.year : null,
  explicit: lacksFlag(song) ? found.explicit : "unknown",
});

/** How a run over many songs ended early, and how many songs it didn't get to. */
export interface TagLookupStop {
  readonly stopped: "cancelled" | "unreachable";
  readonly left: number;
}

/** Songs named in a summary's list; the rest are counted. */
const NAMED_SONGS = 5;

const count = (n: number): string => n.toLocaleString("en");
const songs = (n: number): string => (n === 1 ? "1 song" : `${count(n)} songs`);

/** "a", "a and b", "a, b and c". */
const listed = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** The tags of [written] that went to [where], by name: "genre", "track number", "year", "explicit flag". */
const tagsWent = (written: TagWriteReport, where: TagDestination): string[] => [
  ...(written.genre === where ? ["genre"] : []),
  ...(written.trackNumber === where ? ["track number"] : []),
  ...(written.year === where ? ["year"] : []),
  ...(written.explicit === where ? ["explicit flag"] : []),
];

/** What one song got, as a sentence about it. */
const describeUpdate = (title: string, written: TagWriteReport) => {
  if (written.lyrics === "sidecar") {
    const skipped = tagsWent(written, "notWritten");
    const notWritten =
      skipped.length === 0
        ? ""
        : ` and the ${listed(skipped)} ${skipped.length === 1 ? "wasn't" : "weren't"} written`;
    return {
      title: "Song fixed",
      message: `Wave can't write tags to this file's format, so the lyrics were saved beside it as an .lrc file${notWritten}.`,
    };
  }
  const filled = [...(written.lyrics === "none" ? [] : ["lyrics"]), ...tagsWent(written, "tags")];
  return { title: "Song fixed", message: `Filled in the ${listed(filled)} of “${title}”.` };
};

/** What a song Fix Song skips already has (`songsToFix`). */
const EVERYTHING = "lyrics, a genre, a track number, a year and an explicit flag";

/**
 * The message after Fix Song on [results] (in order): what one song got, or
 * for several the fixed / not found / failed counts and the songs whose
 * lyrics went into a sidecar `.lrc`. [stop] says why a run ended early;
 * [skipped] counts the songs left out as already having lyrics, a genre, a
 * track number, a year and an explicit flag (`songsToFix`).
 */
export const describeTagLookups = (
  results: readonly { readonly title: string; readonly outcome: SongTagOutcome }[],
  stop?: TagLookupStop,
  skipped = 0,
): { readonly title: string; readonly message: string } => {
  if (results.length === 0 && stop === undefined && skipped > 0)
    return {
      title: "Nothing to fix",
      message:
        skipped === 1
          ? `The only song already has ${EVERYTHING}.`
          : `All ${count(skipped)} songs already have ${EVERYTHING}.`,
    };
  const only = results.length === 1 && stop === undefined && skipped === 0 ? results[0] : undefined;
  if (only !== undefined) {
    const { title, outcome } = only;
    switch (outcome.kind) {
      case "updated":
        return describeUpdate(title, outcome.written);
      case "notFound":
        return {
          title: "Nothing found",
          message: `Nothing “${title}” is missing was found. The file wasn't changed.`,
        };
      case "failed":
        return FAILURES[outcome.reason](title);
    }
  }
  const tally = { updated: 0, notFound: 0, failed: 0 };
  const sidecars: string[] = [];
  for (const { title, outcome } of results) {
    tally[outcome.kind] += 1;
    if (outcome.kind === "updated" && outcome.written.lyrics === "sidecar") sidecars.push(title);
  }
  const paragraphs = [
    `${count(tally.updated)} fixed · ${count(tally.notFound)} not found · ${count(tally.failed)} failed`,
  ];
  if (skipped > 0)
    paragraphs.push(
      `${songs(skipped)} already had ${EVERYTHING}, so ${skipped === 1 ? "it was" : "they were"} skipped.`,
    );
  if (sidecars.length > 0) {
    const named = sidecars.slice(0, NAMED_SONGS).join(", ");
    const more = sidecars.length - NAMED_SONGS;
    paragraphs.push(
      `Lyrics saved as .lrc files, genre not written (Wave can't write tags to their format): ${named}${more > 0 ? ` and ${count(more)} more` : ""}.`,
    );
  }
  if (stop !== undefined) {
    const notLookedUp = `${songs(stop.left)} ${stop.left === 1 ? "wasn't" : "weren't"} looked up.`;
    paragraphs.push(
      stop.stopped === "unreachable"
        ? `LRCLIB and Deezer couldn't be reached, so ${notLookedUp}`
        : notLookedUp.charAt(0).toUpperCase() + notLookedUp.slice(1),
    );
  }
  return {
    title: stop === undefined ? "Songs fixed" : "Fix Songs stopped",
    message: paragraphs.join("\n\n"),
  };
};

/** What one song's Fix Song came to, as a toast says it. */
const toastAboutSong = (title: string, outcome: SongTagOutcome): string => {
  switch (outcome.kind) {
    case "updated":
      return outcome.written.lyrics === "sidecar"
        ? `Fixed “${title}” · lyrics saved as .lrc`
        : `Fixed “${title}”`;
    case "notFound":
      return `Nothing found for “${title}”`;
    case "failed":
      return FAILURES[outcome.reason](title).title;
  }
};

/**
 * The one line a toast says after Fix Song on [results], taking the same
 * [stop] and [skipped] as `describeTagLookups`: what one song came to, or for
 * a run the counts that aren't zero ("Fixed 3 songs · 1 not found"). The
 * details (which songs got an .lrc file) are `describeTagLookups`'s.
 */
export const tagLookupsToast = (
  results: readonly { readonly title: string; readonly outcome: SongTagOutcome }[],
  stop?: TagLookupStop,
  skipped = 0,
): string => {
  if (results.length === 0 && stop === undefined && skipped > 0) return "Nothing to fix";
  const only = results.length === 1 && stop === undefined && skipped === 0 ? results[0] : undefined;
  if (only !== undefined) return toastAboutSong(only.title, only.outcome);
  const tally = { updated: 0, notFound: 0, failed: 0 };
  for (const { outcome } of results) tally[outcome.kind] += 1;
  const parts = [tally.updated === 0 ? "Nothing fixed" : `Fixed ${songs(tally.updated)}`];
  if (tally.notFound > 0) parts.push(`${count(tally.notFound)} not found`);
  if (tally.failed > 0) parts.push(`${count(tally.failed)} failed`);
  if (skipped > 0) parts.push(`${count(skipped)} already complete`);
  if (stop !== undefined)
    parts.push(
      `${count(stop.left)} not looked up${stop.stopped === "unreachable" ? " (offline)" : ""}`,
    );
  return parts.join(" · ");
};

/** Whether [rank] comes before [other], comparing field by field (lower is better). */
const isBetter = (rank: readonly number[], other: readonly number[]): boolean => {
  for (let i = 0; i < rank.length; i += 1) {
    const a = rank[i] ?? 0;
    const b = other[i] ?? 0;
    if (a !== b) return a < b;
  }
  return false;
};
