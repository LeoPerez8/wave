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
  readonly trackId: number;
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
      const { trackId, albumId } = candidate;
      best = { match: { trackId, albumId, onSongsAlbum }, rank };
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
 * is null when unknown.
 */
export interface DeezerTags {
  readonly genre: string | null;
  readonly trackNumber: number | null;
  readonly discNumber: number | null;
  readonly year: number | null;
}

/**
 * What Deezer says about the song [match] is, from its [album] and that
 * album's [tracklist] (null when not fetched: the song has a number). The
 * genre is always the album's; the year and the track's place only when the
 * album is the song's own (`DeezerMatch.onSongsAlbum`), since another album
 * (a compilation, a live record) numbers and dates it differently.
 */
export const deezerTags = (
  match: DeezerMatch,
  album: DeezerAlbum,
  tracklist: readonly DeezerAlbumTrack[] | null,
): DeezerTags => {
  if (!match.onSongsAlbum)
    return { genre: album.genre, trackNumber: null, discNumber: null, year: null };
  const place = tracklist?.find((track) => track.trackId === match.trackId);
  const discs = tracklist?.some((track) => (track.discNumber ?? 1) > 1) ?? false;
  return {
    genre: album.genre,
    trackNumber: place?.trackNumber ?? null,
    discNumber: discs ? (place?.discNumber ?? null) : null,
    year: album.year,
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
};

/** Where a found tag went: the file's tags, nowhere for a format without tag writing, or none to write. */
export type TagDestination = "tags" | "notWritten" | "none";

/**
 * Where the native writer put what was found: lyrics in the file's tags or,
 * for a format it can't write tags to, a sidecar `.lrc`; the genre, track
 * number (with the disc) and year in the tags or, for such a format, nowhere
 * (`notWritten`). `none`: nothing to write, or (track number, year) the file
 * already has one and keeps it.
 */
export interface TagWriteReport {
  readonly lyrics: "tags" | "sidecar" | "none";
  readonly genre: TagDestination;
  readonly trackNumber: TagDestination;
  readonly year: TagDestination;
}

/** How finding a song's lyrics and genre went. */
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
 * What a song's two lookups found, each settled on its own: a service that
 * couldn't be reached found nothing, and what the other found is kept. Null
 * (a failed lookup, which counts towards `lookupsUnreachable`) only when
 * neither LRCLIB nor Deezer answered.
 */
export const settledTags = (
  lyrics: TagLookup<FoundLyrics | null>,
  deezer: TagLookup<DeezerTags | null>,
): FoundTags | null => {
  if (!lyrics.ok && !deezer.ok) return null;
  return {
    lyrics: lyrics.ok ? lyrics.value : null,
    ...((deezer.ok ? deezer.value : null) ?? NOTHING_FROM_DEEZER),
  };
};

/**
 * The outcome of a lookup that found [found] (what was to be written) and,
 * when anything was, wrote it as [written]. Writing anything is an update,
 * the track number and year alone included. A format that can't take the
 * track number or year isn't a failure on its own: only a genre it can't take,
 * with no lyrics for a sidecar, fails.
 */
export const songTagOutcome = (
  found: FoundTags,
  written: TagWriteReport | null,
): SongTagOutcome => {
  const foundAny =
    found.lyrics !== null ||
    found.genre !== null ||
    found.trackNumber !== null ||
    found.year !== null;
  if (!foundAny || written === null) return { kind: "notFound" };
  const wroteAny =
    written.lyrics !== "none" ||
    written.genre === "tags" ||
    written.trackNumber === "tags" ||
    written.year === "tags";
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
export interface IndexedTags extends IndexedLyricsAndGenre, IndexedPlace {}

/** Whether a track number or year is missing (0 counts as missing). */
const lacks = (value: number | null): boolean => value === null || value <= 0;

/**
 * Whether [song] has no track number, so a lookup should find it (Deezer's
 * album tracklist, one more request): one it has is never replaced.
 */
export const lacksTrackNumber = (song: IndexedPlace): boolean => lacks(song.trackNumber);

/**
 * Which songs the whole-Library run looks up: those missing lyrics, a genre,
 * a track number or a year, in the order given. Songs that have all four are
 * skipped (and counted for the summary), so running it again only does new or
 * incomplete songs. Songs the owner picks (a menu, the selection bar) are
 * looked up regardless.
 */
export const libraryLookupSongs = <S extends IndexedTags>(
  songs: readonly S[],
): { readonly lookUp: S[]; readonly skipped: number } => {
  const lookUp = songs.filter(
    (song) =>
      !song.hasLyrics ||
      (song.genre ?? "").trim() === "" ||
      lacks(song.trackNumber) ||
      lacks(song.year),
  );
  return { lookUp, skipped: songs.length - lookUp.length };
};

/**
 * What of [found] to write into a song the owner picked (a menu, the selection
 * bar): its lyrics and genre, replacing the file's, and its track number (with
 * the disc) and year only when the song has none. A file tagged by hand keeps
 * its numbers even when Deezer matched the wrong release.
 */
export const tagsToWrite = (found: FoundTags, song: IndexedPlace): FoundTags => ({
  ...found,
  trackNumber: lacks(song.trackNumber) ? found.trackNumber : null,
  discNumber: lacks(song.trackNumber) ? found.discNumber : null,
  year: lacks(song.year) ? found.year : null,
});

/**
 * What of [found] a song still lacks: its lyrics when it has none, its genre,
 * track number and year likewise. Filling in a song (a download just saved)
 * never replaces what it already has; nothing left means there's nothing to write.
 */
export const missingTags = (found: FoundTags, song: IndexedTags): FoundTags => ({
  ...tagsToWrite(found, song),
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

/** "a", "a and b", "a, b and c". */
const listed = (items: readonly string[]): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** The tags of [written] that went to [where], by name: "genre", "track number", "year". */
const tagsWent = (written: TagWriteReport, where: TagDestination): string[] => [
  ...(written.genre === where ? ["genre"] : []),
  ...(written.trackNumber === where ? ["track number"] : []),
  ...(written.year === where ? ["year"] : []),
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
      title: "Lyrics updated",
      message: `Wave can't write tags to this file's format, so the lyrics were saved beside it as an .lrc file${notWritten}.`,
    };
  }
  const lyrics = written.lyrics !== "none";
  const genre = written.genre === "tags";
  const placed = tagsWent({ ...written, genre: "none" }, "tags");
  const place = listed(placed);
  const was = placed.length === 1 ? "was" : "were";
  const filledIn = place === "" ? "" : ` Its ${place} ${was} filled in.`;
  if (lyrics && genre)
    return {
      title: "Lyrics and genre updated",
      message: `“${title}” has new lyrics and a new genre.${filledIn}`,
    };
  if (genre)
    return {
      title: "Genre updated",
      message: `“${title}” has a new genre. No lyrics were found.${filledIn}`,
    };
  if (lyrics)
    return {
      title: "Lyrics updated",
      message: `“${title}” has new lyrics. No genre was found.${filledIn}`,
    };
  return {
    title: `${place.charAt(0).toUpperCase()}${place.slice(1)} filled in`,
    message: `No lyrics or genre were found for “${title}”, but its ${place} ${was}.`,
  };
};

/** What a song the whole-Library run skips already has (`libraryLookupSongs`). */
const EVERYTHING = "lyrics, a genre, a track number and a year";

/**
 * The message after finding lyrics and genre for [results] (in order): what
 * one song got, or for several the updated / not found / failed counts and the
 * songs whose lyrics went into a sidecar `.lrc`. [stop] says why a run ended early;
 * [skipped] counts the songs the whole-Library run left out as already having
 * lyrics, a genre, a track number and a year (`libraryLookupSongs`).
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
