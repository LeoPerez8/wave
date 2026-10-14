/**
 * Finding a song's lyrics (LRCLIB) and genre (Deezer) online: what is sent,
 * which result is the song, and how a run went. Fetching and writing the tags
 * live in the app and the native module.
 */

import { artistPhotoName, artistPhotoQuery } from "./artistPhoto.ts";
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
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly albumId: number;
  /** 0 when unknown. */
  readonly durationMs: number;
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
    if (!isRecord(track) || typeof track.title !== "string") return [];
    const { artist, album } = track;
    if (!isRecord(artist) || typeof artist.name !== "string") return [];
    if (!isRecord(album) || typeof album.id !== "number" || typeof album.title !== "string")
      return [];
    return [
      {
        title: track.title,
        artist: artist.name,
        album: album.title,
        albumId: album.id,
        durationMs: typeof track.duration === "number" ? track.duration * 1000 : 0,
      },
    ];
  });
};

/**
 * The Deezer album whose genre is [song]'s, or null without a confident match:
 * the album of a track with the song's title and artist, preferring the song's
 * own album, then the closest length.
 */
export const pickGenreAlbum = (
  song: SongLookup,
  candidates: readonly GenreCandidate[],
): number | null => {
  let best: { albumId: number; rank: readonly number[] } | null = null;
  for (const candidate of candidates) {
    if (!isSameSong(song, candidate.title, candidate.artist)) continue;
    const rank = [
      isSameAlbum(song, candidate.album) ? 0 : 1,
      lengthGap(song, candidate.durationMs),
    ];
    if (best === null || isBetter(rank, best.rank)) best = { albumId: candidate.albumId, rank };
  }
  return best?.albumId ?? null;
};

/** A Deezer album, which lists its genres. */
export const deezerAlbumUrl = (albumId: number): string =>
  `https://api.deezer.com/album/${albumId}`;

/**
 * The genre of a Deezer album response: its first genre, or null when it has
 * none. The whole result is null when the response isn't an album (a failed lookup).
 */
export const deezerAlbumGenre = (response: unknown): { readonly genre: string | null } | null => {
  if (!isRecord(response) || typeof response.id !== "number") return null;
  const genres = isRecord(response.genres) ? response.genres.data : undefined;
  const first: unknown = Array.isArray(genres) ? genres[0] : undefined;
  return { genre: isRecord(first) ? (text(first.name)?.trim() ?? null) : null };
};

/** What a lookup found for a song: either or both may be missing. */
export interface FoundTags {
  readonly lyrics: FoundLyrics | null;
  readonly genre: string | null;
}

/**
 * Where the native writer put what was found: lyrics in the file's tags or,
 * for a format it can't write tags to, a sidecar `.lrc`; the genre in the
 * tags or, for such a format, nowhere (`notWritten`). `none`: nothing to write.
 */
export interface TagWriteReport {
  readonly lyrics: "tags" | "sidecar" | "none";
  readonly genre: "tags" | "notWritten" | "none";
}

/** How finding a song's lyrics and genre went. */
export type SongTagOutcome =
  | { readonly kind: "updated"; readonly written: TagWriteReport }
  /** Nothing found: the file is left as it was. */
  | { readonly kind: "notFound" }
  /**
   * LRCLIB or Deezer couldn't be reached (`lookup`), the file couldn't be
   * written (`write`), or only a genre was found for a format that can't take
   * it (`format`). The file is left as it was.
   */
  | { readonly kind: "failed"; readonly reason: "lookup" | "write" | "format" };

/** How one service's lookup went: what it answered (null: nothing matched), or it couldn't be reached. */
export type TagLookup<A> = { readonly ok: true; readonly value: A } | { readonly ok: false };

/**
 * What a song's two lookups found, each settled on its own: a service that
 * couldn't be reached found nothing, and what the other found is kept. Null
 * (a failed lookup, which counts towards `lookupsUnreachable`) only when
 * neither LRCLIB nor Deezer answered.
 */
export const settledTags = (
  lyrics: TagLookup<FoundLyrics | null>,
  genre: TagLookup<string | null>,
): FoundTags | null => {
  if (!lyrics.ok && !genre.ok) return null;
  return { lyrics: lyrics.ok ? lyrics.value : null, genre: genre.ok ? genre.value : null };
};

/** The outcome of a lookup that found [found] and, when anything was, wrote it as [written]. */
export const songTagOutcome = (
  found: FoundTags,
  written: TagWriteReport | null,
): SongTagOutcome => {
  if ((found.lyrics === null && found.genre === null) || written === null)
    return { kind: "notFound" };
  if (written.lyrics === "none" && written.genre !== "tags")
    return { kind: "failed", reason: "format" };
  return { kind: "updated", written };
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
      "Only a genre was found, and Wave can't write tags to this file's format. It wasn't changed.",
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

/**
 * Which songs the whole-Library run looks up: those missing lyrics or a genre,
 * in the order given. Songs that already have both are skipped (and counted
 * for the summary), so running it again only does new or incomplete songs.
 * Songs the owner picks (a menu, the selection bar) are looked up regardless.
 */
export const libraryLookupSongs = <S extends IndexedLyricsAndGenre>(
  songs: readonly S[],
): { readonly lookUp: S[]; readonly skipped: number } => {
  const lookUp = songs.filter((song) => !song.hasLyrics || (song.genre ?? "").trim() === "");
  return { lookUp, skipped: songs.length - lookUp.length };
};

/**
 * What of [found] a song still lacks: its lyrics when it has none, its genre
 * when it has none. Filling in a song (a download just saved) never replaces
 * what it already has; nothing left means there's nothing to write.
 */
export const missingTags = (found: FoundTags, song: IndexedLyricsAndGenre): FoundTags => ({
  lyrics: song.hasLyrics ? null : found.lyrics,
  genre: (song.genre ?? "").trim() === "" ? found.genre : null,
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

/** What one song got, as a sentence about it. */
const describeUpdate = (title: string, written: TagWriteReport) => {
  const lyrics = written.lyrics !== "none";
  const genre = written.genre === "tags";
  if (written.lyrics === "sidecar")
    return {
      title: "Lyrics updated",
      message: `Wave can't write tags to this file's format, so the lyrics were saved beside it as an .lrc file${written.genre === "notWritten" ? " and the genre wasn't written" : ""}.`,
    };
  if (lyrics && genre)
    return {
      title: "Lyrics and genre updated",
      message: `“${title}” has new lyrics and a new genre.`,
    };
  if (genre)
    return { title: "Genre updated", message: `“${title}” has a new genre. No lyrics were found.` };
  return { title: "Lyrics updated", message: `“${title}” has new lyrics. No genre was found.` };
};

/**
 * The message after finding lyrics and genre for [results] (in order): what
 * one song got, or for several the updated / not found / failed counts and the
 * songs whose lyrics went into a sidecar `.lrc`. [stop] says why a run ended early;
 * [skipped] counts the songs the whole-Library run left out as already having
 * lyrics and a genre (`libraryLookupSongs`).
 */
export const describeTagLookups = (
  results: readonly { readonly title: string; readonly outcome: SongTagOutcome }[],
  stop?: TagLookupStop,
  skipped = 0,
): { readonly title: string; readonly message: string } => {
  if (results.length === 0 && stop === undefined && skipped > 0)
    return {
      title: "Nothing to look up",
      message:
        skipped === 1
          ? "The only song already has lyrics and a genre."
          : `All ${count(skipped)} songs already have lyrics and a genre.`,
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
          message: `No lyrics or genre were found for “${title}”. The file wasn't changed.`,
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
    `${count(tally.updated)} updated · ${count(tally.notFound)} not found · ${count(tally.failed)} failed`,
  ];
  if (skipped > 0)
    paragraphs.push(
      `${songs(skipped)} already had lyrics and a genre, so ${skipped === 1 ? "it was" : "they were"} skipped.`,
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
    title: stop === undefined ? "Lyrics and genre found" : "Lyrics and genre stopped",
    message: paragraphs.join("\n\n"),
  };
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
