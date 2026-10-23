/**
 * A playlist imported from a link (docs/spec.md, "Importing playlists from a
 * link"): what the import card's Import makes, where each of the source's
 * songs goes, all at once, and what the playlist page says of the songs it
 * left out. A Spotify import searches nothing: the songs the Library hasn't
 * go in as unsearched entries, searched when they're needed.
 */

import { UNKNOWN_ARTIST } from "./library.ts";
import { counted } from "./listening.ts";
import { importedPlaylistName } from "./m3u.ts";
import {
  playlistSongKey,
  readPlaylistYtSong,
  writePlaylistYtSong,
  type PlaylistSong,
} from "./playlistEntries.ts";
import type { LinkedPlaylist } from "./playlistLinks.ts";
import { artistNames } from "./spotifyImport.ts";
import type { SpotifyPlaylist, SpotifySong } from "./spotifyPlaylist.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import {
  joinArtists,
  libraryFinder,
  libraryFinderSteps,
  type LibrarySongKey,
  type YtSong,
} from "./ytMusic.ts";

/** Where an import's songs come from: a YouTube Music playlist's stream as they are, a Spotify playlist's are searched when needed. */
export type ImportService = "ytMusic" | "spotify";

/** A playlist as read from its service, before Import. */
export type LinkedSource<S extends YtSong> =
  | { readonly service: "ytMusic"; readonly playlist: LinkedPlaylist<S> }
  | { readonly service: "spotify"; readonly playlist: SpotifyPlaylist };

/**
 * Where one of the source's songs goes: the Library's track, a YouTube Music
 * song, nowhere (a YouTube Music row with no video, a Spotify local file
 * with no artist), or, for a Spotify song the Library hasn't, unsearched.
 */
export type ImportFind<S extends YtSong> =
  | { readonly kind: "library"; readonly trackId: number }
  | { readonly kind: "ytMusic"; readonly song: S }
  | { readonly kind: "notFound" }
  | { readonly kind: "unsearched" };

/** What the import card's Import makes, before the playlist exists. */
export interface LinkImportPlan<S extends YtSong> {
  /** The playlist's name, the source's title as a playlist name can be (before any clash). */
  readonly name: string;
  readonly service: ImportService;
  /** The source's songs, in its order, each once. */
  readonly songs: readonly SpotifySong[];
  /** Where each of [songs] goes. */
  readonly finds: readonly ImportFind<S>[];
  /** How many of [songs] the Library has. */
  readonly inLibrary: number;
  /**
   * How many songs the source lists, as it counts them (Spotify's own count,
   * a YouTube Music playlist's rows); of a playlist only partly read, those
   * read. [songs], [leftOut] and [notSongs] add up to it.
   */
  readonly sourceTotal: number;
  /** The source's songs that don't go in, each with why, in the source's order. */
  readonly leftOut: readonly LeftOutSong[];
  /** How many items the source counts that aren't songs Wave can read (Spotify's podcast episodes). */
  readonly notSongs: number;
  /**
   * Of a playlist that goes on past what was read (its read stopped at a
   * cap), how many of its songs were read; null when it was read whole.
   */
  readonly cut: number | null;
}

/**
 * Why one of the source's songs doesn't go in: it's listed twice (the same
 * song as one before it, which goes in in its place), or, of an import kept
 * by a Wave from before unavailable entries, it wasn't found and that Wave
 * gave the playlist nothing in its place.
 */
export type LeftOutReason = "listedTwice" | "notFound";

/** One of the source's songs that doesn't go in, and why. */
export interface LeftOutSong {
  readonly song: SpotifySong;
  readonly reason: LeftOutReason;
}

const NOT_FOUND: ImportFind<never> = { kind: "notFound" };
const UNSEARCHED: ImportFind<never> = { kind: "unsearched" };

/**
 * What importing [source] makes, given the Library: each song the Library
 * already has (Core's `libraryFinder`) as its track. A YouTube Music
 * playlist's other songs stream as they are; a Spotify playlist's go in
 * unsearched, except a song with no artist, a local file, which can't be
 * searched and goes in unavailable. A song that comes again (the same
 * Library track, the same video, or a Spotify song alike in every field) is
 * left out after its first place, as listed twice, so the card counts it
 * once and says so.
 */
export const planLinkImport = <
  S extends YtSong,
  L extends LibrarySongKey & { readonly id: number },
>(
  source: LinkedSource<S>,
  library: readonly L[],
): LinkImportPlan<S> => {
  const find = libraryFinder(library);
  // A YouTube Music playlist's rows listing a video again come after the rest: each is left out.
  const streams =
    source.service === "ytMusic" ? [...source.playlist.songs, ...source.playlist.repeats] : null;
  const listed: readonly SpotifySong[] = streams ?? source.playlist.songs;
  const seen = new Set<string>();
  const songs: SpotifySong[] = [];
  const finds: ImportFind<S>[] = [];
  const leftOut: LeftOutSong[] = [];
  listed.forEach((song, index) => {
    const track = find(song);
    const stream = streams?.[index];
    const key =
      track !== null
        ? `library:${track.id}`
        : stream !== undefined
          ? `yt:${stream.videoId}`
          : JSON.stringify([song.title, song.artists, song.album, song.durationMs]);
    if (seen.has(key)) {
      leftOut.push({ song: listedSong(song), reason: "listedTwice" });
      return;
    }
    seen.add(key);
    songs.push(song);
    if (track !== null) finds.push({ kind: "library", trackId: track.id });
    else if (stream !== undefined) finds.push({ kind: "ytMusic", song: stream });
    else if (source.service === "ytMusic" || artistNames(song.artists).length === 0)
      finds.push(NOT_FOUND);
    else finds.push(UNSEARCHED);
  });
  // Of a playlist only partly read, Spotify's count includes songs never read.
  const notSongs =
    source.service === "spotify" && !source.playlist.truncated
      ? Math.max(0, source.playlist.total - listed.length)
      : 0;
  return {
    name: importedPlaylistName(source.playlist.title),
    service: source.service,
    songs,
    finds,
    inLibrary: finds.filter((found) => found.kind === "library").length,
    sourceTotal: listed.length + notSongs,
    leftOut,
    notSongs,
    cut: source.playlist.truncated ? source.playlist.songs.length : null,
  };
};

/** [song] as the source lists it (its cover when it has one): a YouTube Music song's own fields left behind. */
const listedSong = ({ title, artists, album, durationMs, artworkUrl }: SpotifySong): SpotifySong =>
  typeof artworkUrl === "string"
    ? { title, artists, album, durationMs, artworkUrl }
    : { title, artists, album, durationMs };

/** Where an import has got to. */
export type ImportState =
  /** Its songs still to be given to the playlist. */
  | { readonly kind: "importing" }
  /** Every song given to the playlist; kept only for its line (its cut, the songs it left out). */
  | { readonly kind: "done" };

/** A link import into the playlist Import made. */
export interface PlaylistImport<S extends YtSong> {
  /** The playlist it fills. */
  readonly playlistId: number;
  /** The playlist's name when it was made. */
  readonly name: string;
  readonly service: ImportService;
  /** The source's songs, in its order; none once it's kept done (`updatePlaylistImport`). */
  readonly songs: readonly SpotifySong[];
  /** Where each of [songs] goes. */
  readonly finds: readonly ImportFind<S>[];
  /**
   * The source's songs left out before the import started (`LinkImportPlan`'s);
   * once it's kept done, those that went in once as the same song as one before them too.
   */
  readonly leftOut: readonly LeftOutSong[];
  /** How many of [songs], from the first, have been given to the playlist. */
  readonly added: number;
  readonly state: ImportState;
  /** The source goes on past [songs]: how many of its songs were read (`LinkImportPlan`'s). */
  readonly cut: number | null;
}

/** The import of [plan] into the playlist it made, [playlistId], named [name]. Nothing is given to it yet. */
export const startPlaylistImport = <S extends YtSong>(
  plan: LinkImportPlan<S>,
  { playlistId, name }: { readonly playlistId: number; readonly name: string },
): PlaylistImport<S> => ({
  playlistId,
  name,
  service: plan.service,
  songs: plan.songs,
  finds: plan.finds,
  leftOut: plan.leftOut,
  added: 0,
  state: { kind: "importing" },
  cut: plan.cut,
});

/**
 * What the source's song [listed] goes in as, given where it goes ([found]):
 * the Library's track, the YouTube Music song, an unsearched song as the
 * source listed it, or, not found, an unavailable song in its place (a song
 * without an artist is a local file, never searched).
 */
const playlistSong = <S extends YtSong>(
  found: ImportFind<S>,
  listed: SpotifySong | undefined,
): PlaylistSong<S> | null => {
  if (found.kind === "library") return { source: "library", trackId: found.trackId };
  if (found.kind === "ytMusic") return { source: "stream", song: found.song };
  if (listed === undefined) return null;
  const { title, artists, album, durationMs, artworkUrl = null } = listed;
  const song = { title, artists, album, durationMs, artworkUrl };
  if (found.kind === "unsearched") return { source: "unsearched", song };
  return {
    source: "unavailable",
    song: { ...song, reason: artistNames(artists).length === 0 ? "localFile" : "notFound" },
  };
};

/** [job]'s songs as they go in, by place, and the first place each key goes in at (`playlistSongKey`). */
const placed = <S extends YtSong>(job: PlaylistImport<S>) => {
  const songs = job.finds.map((found, index) => playlistSong(found, job.songs[index]));
  const firstAt = new Map<string, number>();
  songs.forEach((song, index) => {
    if (song === null) return;
    const key = playlistSongKey(song);
    if (!firstAt.has(key)) firstAt.set(key, index);
  });
  return { songs, firstAt };
};

/** What finishing an import gives its playlist, and the import once it has. */
export interface FinishedImport<S extends YtSong> {
  /** The songs to append, in the source's order. */
  readonly songs: readonly PlaylistSong<S>[];
  /** Done; `updatePlaylistImport` keeps it only while it has a cut or songs left out to show. */
  readonly job: PlaylistImport<S>;
}

/**
 * Finishes [job] at once: the playlist is given every song not given yet, in
 * the source's order, the Library's as its tracks, YouTube Music's as YT
 * Music entries, a Spotify playlist's others unsearched, and the songs not
 * found as unavailable entries in their places. A song that goes in as the
 * same song as one before it (by `playlistSongKey`) goes in once, and counts
 * as listed twice. Nothing is searched.
 */
export const finishPlaylistImport = <S extends YtSong>(
  job: PlaylistImport<S>,
): FinishedImport<S> => {
  const { songs: placedSongs, firstAt } = placed(job);
  const songs: PlaylistSong<S>[] = [];
  for (let index = job.added; index < placedSongs.length; index += 1) {
    const song = placedSongs[index];
    if (song === null || song === undefined) continue;
    if ((firstAt.get(playlistSongKey(song)) ?? index) < index) continue;
    songs.push(song);
  }
  return { songs, job: { ...job, added: job.songs.length, state: { kind: "done" } } };
};

// ---------------------------------------------------------------------------
// The imports with something left to show

/** The imports finishing, or done with songs left out to show, by playlist. */
export type PlaylistImports<S extends YtSong> = readonly PlaylistImport<S>[];

/** The imports without [playlistId]'s: dismissed, or its playlist deleted or replaced. */
export const withoutPlaylistImport = <S extends YtSong>(
  imports: PlaylistImports<S>,
  playlistId: number,
): PlaylistImports<S> => imports.filter((job) => job.playlistId !== playlistId);

/** The imports with [job] after the others, in place of any into the same playlist. */
export const queuePlaylistImport = <S extends YtSong>(
  imports: PlaylistImports<S>,
  job: PlaylistImport<S>,
): PlaylistImports<S> => [...withoutPlaylistImport(imports, job.playlistId), job];

/**
 * The songs [job] lists twice: those left out before it started, then those
 * that go in as the same song as one before them, which go in once. In the
 * source's order within each.
 */
const listedTwice = <S extends YtSong>(job: PlaylistImport<S>): SpotifySong[] => [
  ...job.leftOut.filter((left) => left.reason === "listedTwice").map((left) => left.song),
  ...wentInOnce(job),
];

/** The songs of [job] that go in as the same song as one before them, in the source's order. */
const wentInOnce = <S extends YtSong>(job: PlaylistImport<S>): SpotifySong[] => {
  const { songs, firstAt } = placed(job);
  const once: SpotifySong[] = [];
  songs.forEach((song, index) => {
    if (song === null) return;
    const first = firstAt.get(playlistSongKey(song));
    const listed = job.songs[index];
    if (first !== undefined && first < index && listed !== undefined) once.push(listed);
  });
  return once;
};

/**
 * [job] as kept once done: its line needs only its name, its cut and the
 * songs it left out, so it keeps none of the source's songs (up to 5,000)
 * and names those that went in once as left out, listed twice.
 */
const slimmed = <S extends YtSong>(job: PlaylistImport<S>): PlaylistImport<S> =>
  job.state.kind !== "done" || job.songs.length === 0
    ? job
    : {
        ...job,
        songs: [],
        finds: [],
        added: 0,
        leftOut: [
          ...job.leftOut,
          ...wentInOnce(job).map((song): LeftOutSong => ({ song, reason: "listedTwice" })),
        ],
      };

/**
 * The imports with [job] as it is now. Done with no song left out, it's
 * gone: there's nothing to show. Done with something to show, it keeps only
 * what its line shows.
 */
export const updatePlaylistImport = <S extends YtSong>(
  imports: PlaylistImports<S>,
  job: PlaylistImport<S>,
): PlaylistImports<S> =>
  nothingToShow(job)
    ? withoutPlaylistImport(imports, job.playlistId)
    : imports.map((queued) => (queued.playlistId === job.playlistId ? slimmed(job) : queued));

// ---------------------------------------------------------------------------
// Kept while Wave is closed

/**
 * The version of the imports kept. Kept with none, they're an older Wave's,
 * which gave the playlist nothing for a song not found (since #333 one goes
 * in as an unavailable entry).
 */
const KEPT_VERSION = 2;

/** [imports] as kept until Wave starts again (`readPlaylistImports`). */
export const writePlaylistImports = <S extends YtSong & { readonly albumId?: string | null }>(
  imports: PlaylistImports<S>,
): string =>
  JSON.stringify({
    version: KEPT_VERSION,
    imports: imports.map((job) => ({
      playlistId: job.playlistId,
      name: job.name,
      service: job.service,
      songs: job.songs.map(listedSong),
      finds: job.finds.map((found) =>
        found.kind === "ytMusic"
          ? { kind: "ytMusic", song: writePlaylistYtSong(found.song) }
          : found,
      ),
      leftOut: job.leftOut.map(({ song, reason }) => ({ song: listedSong(song), reason })),
      added: job.added,
      state: job.state,
      cut: job.cut,
    })),
  });

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const readSong = (value: unknown): SpotifySong | null => {
  if (!isFields(value)) return null;
  const { title, artists, album, durationMs, artworkUrl } = value;
  if (typeof title !== "string" || !isStrings(artists)) return null;
  if (album !== null && typeof album !== "string") return null;
  if (durationMs !== null && typeof durationMs !== "number") return null;
  return typeof artworkUrl === "string"
    ? { title, artists, album, durationMs, artworkUrl }
    : { title, artists, album, durationMs };
};

/**
 * A kept find; undefined when unreadable. A song an import going on before
 * Spotify imports stopped searching hadn't found yet (kept as null) goes in
 * unsearched.
 */
const readFind = (value: unknown): ImportFind<YtAlbumSong> | undefined => {
  if (value === null) return UNSEARCHED;
  if (!isFields(value)) return undefined;
  if (value.kind === "notFound") return NOT_FOUND;
  if (value.kind === "unsearched") return UNSEARCHED;
  if (value.kind === "library" && typeof value.trackId === "number") {
    return { kind: "library", trackId: value.trackId };
  }
  if (value.kind === "ytMusic" && typeof value.song === "string") {
    const song = readPlaylistYtSong(value.song);
    return song === null ? undefined : { kind: "ytMusic", song };
  }
  return undefined;
};

const LEFT_OUT_REASONS: readonly string[] = ["listedTwice", "notFound"] satisfies LeftOutReason[];

/** A kept song left out; null when unreadable. */
const readLeftOut = (value: unknown): LeftOutSong | null => {
  if (!isFields(value) || !LEFT_OUT_REASONS.includes(String(value.reason))) return null;
  const song = readSong(value.song);
  return song === null ? null : { song, reason: value.reason as LeftOutReason };
};

/**
 * A kept state: done, or anything else (going on, waiting its turn, or
 * stopped, as imports were while they searched) still to be given to the
 * playlist.
 */
const readState = (value: unknown): ImportState | null => {
  if (!isFields(value)) return null;
  if (value.kind === "done") return { kind: "done" };
  if (value.kind === "importing" || value.kind === "stopped") return { kind: "importing" };
  return null;
};

/**
 * The songs not found among the first [added] of an import an older Wave
 * kept: it gave the playlist nothing for them, so they're left out.
 */
const passedOver = (
  songs: readonly SpotifySong[],
  finds: readonly ImportFind<YtAlbumSong>[],
  added: number,
): LeftOutSong[] =>
  songs.flatMap((song, index): LeftOutSong[] =>
    index < added && finds[index]?.kind === "notFound" ? [{ song, reason: "notFound" }] : [],
  );

/**
 * A kept import; null when unreadable. One an older Wave kept ([older])
 * leaves out the songs it gave the playlist nothing for.
 */
const readImport = (value: unknown, older: boolean): PlaylistImport<YtAlbumSong> | null => {
  if (!isFields(value)) return null;
  // An import kept before songs left out were named has none.
  const { playlistId, name, service, songs, finds, leftOut = [], added, state, cut } = value;
  if (typeof playlistId !== "number" || typeof name !== "string") return null;
  if (service !== "ytMusic" && service !== "spotify") return null;
  if (!Array.isArray(songs) || !Array.isArray(finds) || songs.length !== finds.length) return null;
  if (typeof added !== "number" || !Array.isArray(leftOut)) return null;
  const readLeftOuts = leftOut.map(readLeftOut);
  if (readLeftOuts.some((left) => left === null)) return null;
  const readSongs = songs.map(readSong);
  const readFinds = finds.map(readFind);
  const keptState = readState(state);
  if (keptState === null) return null;
  if (readSongs.some((song) => song === null) || readFinds.some((found) => found === undefined)) {
    return null;
  }
  const keptSongs = readSongs as SpotifySong[];
  const keptFinds = readFinds as ImportFind<YtAlbumSong>[];
  const keptAdded = Math.min(Math.max(0, added), songs.length);
  return {
    playlistId,
    name,
    service,
    songs: keptSongs,
    finds: keptFinds,
    leftOut: [
      ...(readLeftOuts as LeftOutSong[]),
      ...(older ? passedOver(keptSongs, keptFinds, keptAdded) : []),
    ],
    added: keptAdded,
    state: keptState,
    // An import kept before a cut playlist said so says nothing of it.
    cut: typeof cut === "number" ? cut : null,
  };
};

/**
 * The imports kept as [stored] (`writePlaylistImports`). One still going on
 * when Wave closed (imports searched YouTube Music before #358, and could be
 * stopped or waiting) is to be finished at once (`finishPlaylistImport`):
 * the songs it hadn't found go in unsearched, and those found as they were
 * found. None when nothing readable is kept. An older Wave's done import
 * names the songs it didn't find, or, with nothing to name, is gone. A done
 * one keeps only what its line shows.
 */
export const readPlaylistImports = (stored: string | null): PlaylistImports<YtAlbumSong> => {
  if (stored === null) return [];
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return [];
  }
  if (!isFields(value) || !Array.isArray(value.imports)) return [];
  const older = value.version !== KEPT_VERSION;
  return value.imports
    .map((kept) => readImport(kept, older))
    .filter((job): job is PlaylistImport<YtAlbumSong> => job !== null && !nothingToShow(job))
    .map(slimmed);
};

// ---------------------------------------------------------------------------
// What the playlist page shows

const SERVICE_NAMES: Record<ImportService, string> = {
  ytMusic: "YouTube Music",
  spotify: "Spotify",
};

/** A song as the list of songs left out names it: "Title · Artist & Artist". */
const songLine = (song: SpotifySong): string =>
  `${song.title} · ${joinArtists(song.artists) || UNKNOWN_ARTIST}`;

/** The list of songs a done import left out, opened from its line. */
export interface ImportLeftOut {
  readonly title: string;
  readonly message: string;
  /** The songs by why they're left out, each by title and artist: not found (an older Wave's), listed twice. */
  readonly sections: readonly ImportLeftOutSection[];
}

export interface ImportLeftOutSection {
  readonly heading: string;
  readonly songs: readonly string[];
}

/**
 * The songs [job] left out, by title and artist, under their headings: those
 * listed twice (which went in once) and, of an import an older Wave kept,
 * those it didn't find and gave the playlist nothing for. Null with none.
 * The songs this Wave doesn't find aren't left out: they're in the playlist,
 * unsearched or unavailable.
 */
const leftOutNotice = <S extends YtSong>(job: PlaylistImport<S>): ImportLeftOut | null => {
  const notFound = job.leftOut
    .filter((left) => left.reason === "notFound")
    .map((left) => left.song);
  const twice = listedTwice(job);
  if (notFound.length === 0 && twice.length === 0) return null;
  const missing = `${counted(notFound.length, "song")} ${notFound.length === 1 ? "wasn't" : "weren't"} found`;
  const sections: ImportLeftOutSection[] = [];
  if (notFound.length > 0) sections.push({ heading: "Not found", songs: notFound.map(songLine) });
  if (twice.length > 0) sections.push({ heading: "Listed twice", songs: twice.map(songLine) });
  if (twice.length === 0) {
    return {
      title: missing,
      message: `${job.name} was imported without ${notFound.length === 1 ? "it" : "them"}.`,
      sections,
    };
  }
  if (notFound.length === 0) {
    return {
      title: `${counted(twice.length, "song")} ${twice.length === 1 ? "was" : "were"} listed twice`,
      message: `Each went into ${job.name} once.`,
      sections,
    };
  }
  return {
    title: `${missing} · ${twice.length.toLocaleString("en")} listed twice`,
    message: `${job.name} was imported without the songs not found. Each song listed twice went in once.`,
    sections,
  };
};

/** Whether [job] is done with no song left out and nothing cut to show. */
const nothingToShow = <S extends YtSong>(job: PlaylistImport<S>): boolean =>
  job.state.kind === "done" && job.cut === null && leftOutNotice(job) === null;

/**
 * The import line on a playlist's page: that only the source's first songs
 * came, and the songs its import left out, which it opens. The page can
 * dismiss it.
 */
export interface PlaylistImportView {
  readonly line: string;
  /** The songs left out; null when the line only says the source was cut. */
  readonly leftOut: ImportLeftOut | null;
}

/**
 * What [playlistId]'s page shows of its import once it's done: that only the
 * source's first songs came ("Only its first 5,000 songs came from YouTube
 * Music"), then the songs it left out ("2 songs were listed twice"); null
 * with neither, or while its songs go in, which takes a moment and shows
 * nothing.
 */
export const playlistImportView = <S extends YtSong>(
  imports: PlaylistImports<S>,
  playlistId: number,
): PlaylistImportView | null => {
  const job = imports.find((queued) => queued.playlistId === playlistId);
  if (job?.state.kind !== "done") return null;
  const leftOut = leftOutNotice(job);
  const cut =
    job.cut === null
      ? null
      : `Only its first ${counted(job.cut, "song")} came from ${SERVICE_NAMES[job.service]}`;
  const lines = [cut, leftOut?.title].filter((line) => line !== null && line !== undefined);
  return lines.length === 0 ? null : { line: lines.join(" · "), leftOut };
};

// ---------------------------------------------------------------------------
// The app log

/**
 * The app log's line for [job] once the playlist has its songs: the source,
 * the name, how many songs went in and where from (the Library's, YouTube
 * Music's, unsearched, unavailable) and how many were listed twice. One kept
 * from before Spotify imports stopped searching ([resumed]) says it ended
 * once Wave started. Song titles never appear.
 */
export const importLogLine = <S extends YtSong>(
  job: PlaylistImport<S>,
  { resumed }: { readonly resumed: boolean },
): string => {
  const counts = { library: 0, ytMusic: 0, unsearched: 0, notFound: 0 };
  for (const found of job.finds) counts[found.kind] += 1;
  const twice = listedTwice(job).length;
  return importLine(job, counts, twice, resumed);
};

const importLine = <S extends YtSong>(
  job: PlaylistImport<S>,
  counts: Record<ImportFind<S>["kind"], number>,
  twice: number,
  resumed: boolean,
): string => {
  const parts = [
    `${counts.library.toLocaleString("en")} from the Library`,
    ...(job.service === "ytMusic" || counts.ytMusic > 0
      ? [`${counts.ytMusic.toLocaleString("en")} from YouTube Music`]
      : []),
    ...(job.service === "spotify" ? [`${counts.unsearched.toLocaleString("en")} unsearched`] : []),
    `${counts.notFound.toLocaleString("en")} unavailable`,
    ...(twice > 0 ? [`${twice.toLocaleString("en")} listed twice`] : []),
  ];
  const what = `${counted(job.songs.length, "song")}: ${parts.join(", ")}`;
  const name = `Import of "${job.name}" from ${SERVICE_NAMES[job.service]}`;
  return resumed
    ? `${name}, kept from before the update, ended as Wave started: ${what}`
    : `${name} done at once: ${what}`;
};

/** Background import planning yields during Library indexing and per source row. */
export function* planLinkImportSteps<
  S extends YtSong,
  L extends LibrarySongKey & { readonly id: number },
>(source: LinkedSource<S>, library: readonly L[]): Generator<void, LinkImportPlan<S>> {
  const find = yield* libraryFinderSteps(library);
  // Visit both arrays without an unbounded synchronous concatenation for Liked Songs.
  const streams = source.service === "ytMusic" ? source.playlist : null;
  const listedLength = source.playlist.songs.length + (streams?.repeats.length ?? 0);
  const seen = new Set<string>();
  const songs: SpotifySong[] = [];
  const finds: ImportFind<S>[] = [];
  const leftOut: LeftOutSong[] = [];
  let inLibrary = 0;
  for (let index = 0; index < listedLength; index++) {
    const stream =
      streams === null
        ? undefined
        : (streams.songs[index] ?? streams.repeats[index - streams.songs.length]);
    const song = stream ?? source.playlist.songs[index]!;
    const track = yield* find(song);
    const key =
      track !== null
        ? `library:${track.id}`
        : stream !== undefined
          ? `yt:${stream.videoId}`
          : JSON.stringify([song.title, song.artists, song.album, song.durationMs]);
    if (seen.has(key)) {
      leftOut.push({ song: listedSong(song), reason: "listedTwice" });
      yield;
      continue;
    }
    seen.add(key);
    songs.push(song);
    if (track !== null) {
      finds.push({ kind: "library", trackId: track.id });
      inLibrary++;
    } else if (stream !== undefined) finds.push({ kind: "ytMusic", song: stream });
    else if (source.service === "ytMusic" || artistNames(song.artists).length === 0)
      finds.push(NOT_FOUND);
    else finds.push(UNSEARCHED);
    yield;
  }
  // Of a playlist only partly read, Spotify's count includes songs never read.
  const notSongs =
    source.service === "spotify" && !source.playlist.truncated
      ? Math.max(0, source.playlist.total - listedLength)
      : 0;
  return {
    name: importedPlaylistName(source.playlist.title),
    service: source.service,
    songs,
    finds,
    inLibrary,
    sourceTotal: listedLength + notSongs,
    leftOut,
    notSongs,
    cut: source.playlist.truncated ? source.playlist.songs.length : null,
  };
}

/** Resuming keeps duplicate detection over the entire job, including already added rows. */
export function* finishPlaylistImportSteps<S extends YtSong>(
  job: PlaylistImport<S>,
): Generator<void, FinishedImport<S>> {
  const seen = new Set<string>();
  const songs: PlaylistSong<S>[] = [];
  for (let index = 0; index < job.finds.length; index++) {
    const song = playlistSong(job.finds[index]!, job.songs[index]);
    if (song !== null) {
      const key = playlistSongKey(song);
      if (!seen.has(key) && index >= job.added) songs.push(song);
      seen.add(key);
    }
    yield;
  }
  return { songs, job: { ...job, added: job.songs.length, state: { kind: "done" } } };
}

/** Prepare the kept notice and log without another synchronous whole-job placed()/count pass. */
export function* playlistImportCompletionSteps<S extends YtSong>(
  job: PlaylistImport<S>,
  resumed: boolean,
): Generator<void, { kept: PlaylistImport<S>; line: string }> {
  const counts = { library: 0, ytMusic: 0, unsearched: 0, notFound: 0 };
  let twice = 0;
  const leftOut: LeftOutSong[] = [];
  for (const left of job.leftOut) {
    leftOut.push(left);
    if (left.reason === "listedTwice") twice++;
    yield;
  }
  const seen = new Set<string>();
  for (let index = 0; index < job.finds.length; index++) {
    const found = job.finds[index]!;
    counts[found.kind]++;
    const song = playlistSong(found, job.songs[index]);
    if (song !== null) {
      const key = playlistSongKey(song);
      const listed = job.songs[index];
      if (seen.has(key) && listed !== undefined) {
        leftOut.push({ song: listed, reason: "listedTwice" });
        twice++;
      }
      seen.add(key);
    }
    yield;
  }
  return {
    kept: { ...job, songs: [], finds: [], added: 0, leftOut },
    line: importLine(job, counts, twice, resumed),
  };
}
