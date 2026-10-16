/**
 * A playlist imported from a link, in the background (docs/spec.md,
 * "Importing playlists from a link"): what the import card's Import makes,
 * where each of the source's songs was found, what the playlist is given
 * next, and the imports waiting their turn.
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
import type { ImportNotice, LinkedPlaylist } from "./playlistLinks.ts";
import {
  artistNames,
  spotifySearchQuery,
  spotifyYtMatch,
  type YtSongSearch,
} from "./spotifyImport.ts";
import type { SpotifyPlaylist, SpotifySong } from "./spotifyPlaylist.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import { joinArtists, libraryFinder, type LibrarySongKey, type YtSong } from "./ytMusic.ts";

/** Where an import's songs come from: a YouTube Music playlist's stream as they are, a Spotify playlist's are searched. */
export type ImportService = "ytMusic" | "spotify";

/** A playlist as read from its service, before Import. */
export type LinkedSource<S extends YtSong> =
  | { readonly service: "ytMusic"; readonly playlist: LinkedPlaylist<S> }
  | { readonly service: "spotify"; readonly playlist: SpotifyPlaylist };

/** Where one of the source's songs was found: the Library's track, a YouTube Music song, or nowhere. */
export type ImportFind<S extends YtSong> =
  | { readonly kind: "library"; readonly trackId: number }
  | { readonly kind: "ytMusic"; readonly song: S }
  | { readonly kind: "notFound" };

/** What the import card's Import makes, before the playlist exists. */
export interface LinkImportPlan<S extends YtSong> {
  /** The playlist's name, the source's title as a playlist name can be (before any clash). */
  readonly name: string;
  readonly service: ImportService;
  /** The source's songs, in its order. */
  readonly songs: readonly SpotifySong[];
  /** Where each of [songs] is found already (null: it's still to be searched). */
  readonly finds: readonly (ImportFind<S> | null)[];
  /** How many of [songs] the Library has. */
  readonly inLibrary: number;
}

const NOT_FOUND: ImportFind<never> = { kind: "notFound" };

/**
 * What importing [source] makes, given the Library: each song the Library
 * already has (Core's `libraryFinder`) as its track. A YouTube Music
 * playlist's other songs stream as they are; a Spotify playlist's are each
 * searched on YouTube Music once the import runs, except a song with no
 * artist, which is never searched and isn't found.
 */
export const planLinkImport = <
  S extends YtSong,
  L extends LibrarySongKey & { readonly id: number },
>(
  source: LinkedSource<S>,
  library: readonly L[],
): LinkImportPlan<S> => {
  const find = libraryFinder(library);
  const songs: readonly SpotifySong[] = source.playlist.songs;
  const finds = songs.map((song, index): ImportFind<S> | null => {
    const track = find(song);
    if (track !== null) return { kind: "library", trackId: track.id };
    if (source.service === "ytMusic") {
      const stream = source.playlist.songs[index];
      return stream === undefined ? NOT_FOUND : { kind: "ytMusic", song: stream };
    }
    return artistNames(song.artists).length === 0 ? NOT_FOUND : null;
  });
  return {
    name: importedPlaylistName(source.playlist.title),
    service: source.service,
    songs,
    finds,
    inLibrary: finds.filter((found) => found?.kind === "library").length,
  };
};

/** Where an import has got to. */
export type ImportState =
  /** Going on, or waiting its turn behind another import. */
  | { readonly kind: "importing" }
  /** Stopped before every song was found: Try Again, or the next start of Wave, goes on from there. */
  | { readonly kind: "stopped"; readonly reason: ImportStopReason }
  /** Every song found or not, and those found given to the playlist. */
  | { readonly kind: "done" };

/** Why an import stopped: offline, YT Music turned off, or YouTube Music kept refusing its searches. */
export type ImportStopReason = "offline" | "disabled" | "searchFailed";

/** A link import going on in the background, into the playlist it made at once. */
export interface PlaylistImport<S extends YtSong> {
  /** The playlist it fills. */
  readonly playlistId: number;
  /** The playlist's name when it was made. */
  readonly name: string;
  readonly service: ImportService;
  /** The source's songs, in its order. */
  readonly songs: readonly SpotifySong[];
  /** Where each of [songs] was found; null while it's still to be searched. */
  readonly finds: readonly (ImportFind<S> | null)[];
  /** How many of [songs], from the first, have been given to the playlist. */
  readonly added: number;
  readonly state: ImportState;
  /** The searches asked and not yet answered. Not kept past a restart. */
  readonly asking: readonly string[];
  /** How many times in a row YouTube Music refused each search. */
  readonly refused: Readonly<Record<string, number>>;
  /** No search is asked before this time (ms): a pause after a refusal. */
  readonly pausedUntil: number;
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
  added: 0,
  state: { kind: "importing" },
  asking: [],
  refused: {},
  pausedUntil: 0,
});

/** What a found song goes in as. */
const playlistSong = <S extends YtSong>(found: ImportFind<S>): PlaylistSong<S> | null =>
  found.kind === "library"
    ? { source: "library", trackId: found.trackId }
    : found.kind === "ytMusic"
      ? { source: "stream", song: found.song }
      : null;

/** What the playlist is given next, and how far through the source's songs that takes it. */
export interface ImportAdditions<S extends YtSong> {
  /** The songs to append, in the source's order. */
  readonly songs: readonly PlaylistSong<S>[];
  /** Once they're in, `importAdded` with this. */
  readonly through: number;
}

/**
 * What the playlist is given now: the songs found since the last given, up
 * to the first still being searched, so they arrive in the source's order.
 * A song the import gave the playlist before (by its key, `playlistSongKey`)
 * isn't given again, so one listed twice goes in once, and one the owner
 * removed meanwhile stays out. Songs not found are passed over.
 */
export const importAdditions = <S extends YtSong>(job: PlaylistImport<S>): ImportAdditions<S> => {
  const given = new Set<string>();
  for (const found of job.finds.slice(0, job.added)) {
    const song = found === null ? null : playlistSong(found);
    if (song !== null) given.add(playlistSongKey(song));
  }
  const songs: PlaylistSong<S>[] = [];
  let through = job.added;
  for (; through < job.finds.length; through += 1) {
    const found = job.finds[through];
    if (found === null || found === undefined) break;
    const song = playlistSong(found);
    if (song === null) continue;
    const key = playlistSongKey(song);
    if (given.has(key)) continue;
    given.add(key);
    songs.push(song);
  }
  return { songs, through };
};

/**
 * The import once `importAdditions`' songs are in the playlist, up to
 * [through]; done once every song is.
 */
export const importAdded = <S extends YtSong>(
  job: PlaylistImport<S>,
  through: number,
): PlaylistImport<S> => {
  const added = Math.min(Math.max(job.added, through), job.songs.length);
  const done = added === job.songs.length && job.state.kind === "importing";
  return { ...job, added, state: done ? { kind: "done" } : job.state };
};

// ---------------------------------------------------------------------------
// Searching a Spotify playlist's songs

/**
 * How many YouTube Music searches run at once. Measured from a PC on
 * 2026-10-14: four at once searched a 495-song playlist in 85 seconds (about
 * 6 a second) with no refusals. YouTube Music began refusing some (HTTP 403,
 * about one in eight, never more than three in a row) only after about 2,300
 * searches in 15 minutes, and kept refusing a few for over half an hour.
 */
export const SPOTIFY_SEARCHES_AT_ONCE = 4;

/**
 * The pauses before asking again once YouTube Music refuses a search; the
 * same search refused once more after the last, the import stops. While
 * refusing, YouTube Music answered every search by the third try.
 */
const RETRY_PAUSES_MS = [2000, 5000, 10_000, 20_000] as const;

/** What the app does next for an import. */
export type ImportStep =
  /** Ask YouTube Music this Songs search, then `importSearchAnswered` with its answer. */
  | { readonly kind: "search"; readonly query: string }
  /** Ask nothing before this time (ms), unless an answer comes first. */
  | { readonly kind: "wait"; readonly untilMs: number }
  /** Wait for a search asked to be answered. */
  | { readonly kind: "answers" }
  /** Nothing more to search: every song is settled, or the import isn't going on. */
  | { readonly kind: "none" };

/** The first search still to ask: the next unsettled song's, in the source's order, not already asked. */
const nextQuery = <S extends YtSong>(job: PlaylistImport<S>): string | null => {
  const asking = new Set(job.asking);
  for (let index = job.added; index < job.finds.length; index += 1) {
    const song = job.songs[index];
    if (job.finds[index] !== null || song === undefined) continue;
    const query = spotifySearchQuery(song);
    if (!asking.has(query)) return query;
  }
  return null;
};

/**
 * What the app does next for [job] at [now] (ms), and the import once it's
 * done. The songs still to be found are searched in the source's order, one
 * Songs search per song (its title and artists, `spotifySearchQuery`; a song
 * listed twice is searched once), at most `SPOTIFY_SEARCHES_AT_ONCE` at once,
 * none while paused after a refusal. This is the one place deciding whether
 * a search may be asked now.
 */
export const nextImportStep = <S extends YtSong>(
  job: PlaylistImport<S>,
  now: number,
): { readonly job: PlaylistImport<S>; readonly step: ImportStep } => {
  if (job.state.kind !== "importing") return { job, step: { kind: "none" } };
  const waiting =
    job.asking.length > 0 ? ({ kind: "answers" } as const) : ({ kind: "none" } as const);
  if (job.asking.length >= SPOTIFY_SEARCHES_AT_ONCE) return { job, step: waiting };
  const query = nextQuery(job);
  if (query === null) return { job, step: waiting };
  if (now < job.pausedUntil) return { job, step: { kind: "wait", untilMs: job.pausedUntil } };
  return { job: { ...job, asking: [...job.asking, query] }, step: { kind: "search", query } };
};

/**
 * The import once YouTube Music answered [query] at [now] (ms). Found, each
 * song searched by it is settled: the result that is its recording
 * (`spotifyYtMatch`), or not found. Refused, the import pauses 2, 5, 10 and
 * then 20 seconds before asking again; the same search refused a fifth
 * time, it stops. Offline, or with YT Music turned off, it stops at once.
 */
export const importSearchAnswered = <S extends YtSong>(
  job: PlaylistImport<S>,
  query: string,
  answer: YtSongSearch<S>,
  now: number,
): PlaylistImport<S> => {
  const asking = job.asking.filter((asked) => asked !== query);
  const { [query]: refusals = 0, ...refused } = job.refused;
  if (answer.ok) {
    const finds = job.finds.map((found, index): ImportFind<S> | null => {
      const song = job.songs[index];
      if (found !== null || song === undefined || index < job.added) return found;
      if (spotifySearchQuery(song) !== query) return found;
      const match = spotifyYtMatch(song, answer.songs);
      return match === null ? NOT_FOUND : { kind: "ytMusic", song: match };
    });
    return { ...job, finds, asking, refused };
  }
  const stop = (reason: ImportStopReason): PlaylistImport<S> => ({
    ...job,
    asking,
    state: job.state.kind === "importing" ? { kind: "stopped", reason } : job.state,
  });
  if (answer.reason !== "failed") return stop(answer.reason);
  const pause = RETRY_PAUSES_MS[refusals];
  if (pause === undefined) return stop("searchFailed");
  return {
    ...job,
    asking,
    refused: { ...refused, [query]: refusals + 1 },
    pausedUntil: Math.max(job.pausedUntil, now + pause),
  };
};

// ---------------------------------------------------------------------------
// The imports, in turn

/**
 * The imports going on, waiting or with something left to show, in the
 * order they go on: the first still importing is the one going on now.
 */
export type PlaylistImports<S extends YtSong> = readonly PlaylistImport<S>[];

/** The import going on now: the first still importing (a stopped one steps aside); null when none is. */
export const importTurn = <S extends YtSong>(
  imports: PlaylistImports<S>,
): PlaylistImport<S> | null => imports.find((job) => job.state.kind === "importing") ?? null;

/** The imports without [playlistId]'s: cancelled, dismissed, or its playlist deleted. */
export const withoutPlaylistImport = <S extends YtSong>(
  imports: PlaylistImports<S>,
  playlistId: number,
): PlaylistImports<S> => imports.filter((job) => job.playlistId !== playlistId);

/** The imports with [job] waiting its turn after the others, in place of any into the same playlist. */
export const queuePlaylistImport = <S extends YtSong>(
  imports: PlaylistImports<S>,
  job: PlaylistImport<S>,
): PlaylistImports<S> => [...withoutPlaylistImport(imports, job.playlistId), job];

const notFoundCount = <S extends YtSong>(job: PlaylistImport<S>): number =>
  job.finds.filter((found) => found?.kind === "notFound").length;

/** The imports with [job] as it is now. Done with every song found, it's left out: there's nothing to show. */
export const updatePlaylistImport = <S extends YtSong>(
  imports: PlaylistImports<S>,
  job: PlaylistImport<S>,
): PlaylistImports<S> =>
  job.state.kind === "done" && notFoundCount(job) === 0
    ? withoutPlaylistImport(imports, job.playlistId)
    : imports.map((queued) => (queued.playlistId === job.playlistId ? job : queued));

/** [job] going on again from where it got to, its searches all to be asked afresh. */
const resumed = <S extends YtSong>(job: PlaylistImport<S>): PlaylistImport<S> => ({
  ...job,
  state: job.state.kind === "stopped" ? { kind: "importing" } : job.state,
  asking: [],
  refused: {},
  pausedUntil: 0,
});

/** The imports once Try Again on [playlistId]'s stopped import: it goes on again, behind the others. */
export const retryPlaylistImport = <S extends YtSong>(
  imports: PlaylistImports<S>,
  playlistId: number,
): PlaylistImports<S> => {
  const job = imports.find((queued) => queued.playlistId === playlistId);
  return job?.state.kind === "stopped" ? queuePlaylistImport(imports, resumed(job)) : imports;
};

// ---------------------------------------------------------------------------
// Kept while Wave is closed

/** [imports] as kept until Wave starts again (`readPlaylistImports`). */
export const writePlaylistImports = <S extends YtSong & { readonly albumId?: string | null }>(
  imports: PlaylistImports<S>,
): string =>
  JSON.stringify({
    imports: imports.map((job) => ({
      playlistId: job.playlistId,
      name: job.name,
      service: job.service,
      songs: job.songs.map(({ title, artists, album, durationMs }) => ({
        title,
        artists,
        album,
        durationMs,
      })),
      finds: job.finds.map((found) =>
        found?.kind === "ytMusic"
          ? { kind: "ytMusic", song: writePlaylistYtSong(found.song) }
          : found,
      ),
      added: job.added,
      state: job.state,
    })),
  });

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const readSong = (value: unknown): SpotifySong | null => {
  if (!isFields(value)) return null;
  const { title, artists, album, durationMs } = value;
  if (typeof title !== "string" || !isStrings(artists)) return null;
  if (album !== null && typeof album !== "string") return null;
  if (durationMs !== null && typeof durationMs !== "number") return null;
  return { title, artists, album, durationMs };
};

/** A kept find; undefined when unreadable. */
const readFind = (value: unknown): ImportFind<YtAlbumSong> | null | undefined => {
  if (value === null) return null;
  if (!isFields(value)) return undefined;
  if (value.kind === "notFound") return NOT_FOUND;
  if (value.kind === "library" && typeof value.trackId === "number") {
    return { kind: "library", trackId: value.trackId };
  }
  if (value.kind === "ytMusic" && typeof value.song === "string") {
    const song = readPlaylistYtSong(value.song);
    return song === null ? undefined : { kind: "ytMusic", song };
  }
  return undefined;
};

const STOP_REASONS: readonly string[] = ["offline", "disabled", "searchFailed"];

const readState = (value: unknown): ImportState | null => {
  if (!isFields(value)) return null;
  if (value.kind === "importing" || value.kind === "done") return { kind: value.kind };
  if (value.kind === "stopped" && STOP_REASONS.includes(String(value.reason))) {
    return { kind: "stopped", reason: value.reason as ImportStopReason };
  }
  return null;
};

const readImport = (value: unknown): PlaylistImport<YtAlbumSong> | null => {
  if (!isFields(value)) return null;
  const { playlistId, name, service, songs, finds, added, state } = value;
  if (typeof playlistId !== "number" || typeof name !== "string") return null;
  if (service !== "ytMusic" && service !== "spotify") return null;
  if (!Array.isArray(songs) || !Array.isArray(finds) || songs.length !== finds.length) return null;
  if (typeof added !== "number") return null;
  const readSongs = songs.map(readSong);
  const readFinds = finds.map(readFind);
  const keptState = readState(state);
  if (keptState === null) return null;
  if (readSongs.some((song) => song === null) || readFinds.some((found) => found === undefined)) {
    return null;
  }
  return {
    playlistId,
    name,
    service,
    songs: readSongs as SpotifySong[],
    finds: readFinds as (ImportFind<YtAlbumSong> | null)[],
    added: Math.min(Math.max(0, added), songs.length),
    state: keptState,
    asking: [],
    refused: {},
    pausedUntil: 0,
  };
};

/**
 * The imports kept as [stored] (`writePlaylistImports`), as they go on once
 * Wave starts again: each from where it got to, a stopped one going on again,
 * the searches unanswered when Wave closed asked afresh. None when nothing
 * readable is kept.
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
  return value.imports
    .map(readImport)
    .filter((job): job is PlaylistImport<YtAlbumSong> => job !== null)
    .map(resumed);
};

// ---------------------------------------------------------------------------
// What the playlist page and the notification show

/** How many of [job]'s songs are settled: found, in the Library, or not found. */
const settledCount = <S extends YtSong>(job: PlaylistImport<S>): number =>
  job.finds.filter((found) => found !== null).length;

const STOPPED_LINES: Record<ImportStopReason, string> = {
  offline: "Import paused: you're offline.",
  disabled: "Import paused: YT Music is off in Settings.",
  searchFailed: "Import paused: YouTube Music stopped answering.",
};

/** "1 song wasn't found" / "3 songs weren't found". */
const notFoundLine = (count: number): string =>
  `${counted(count, "song")} ${count === 1 ? "wasn't" : "weren't"} found`;

/** The songs [job] didn't find, by title and artist, as the playlist page lists them. */
const notFoundNotice = <S extends YtSong>(job: PlaylistImport<S>): ImportNotice => {
  const songs = job.songs
    .filter((_, index) => job.finds[index]?.kind === "notFound")
    .map((song) => `${song.title} · ${joinArtists(song.artists) || UNKNOWN_ARTIST}`)
    .join("\n");
  return {
    title: notFoundLine(notFoundCount(job)),
    message: `${job.name} was imported without them:\n\n${songs}`,
  };
};

/** The import line on a playlist's page. */
export interface PlaylistImportView {
  readonly line: string;
  /** Cancel stops the import, keeping the songs it gave the playlist. */
  readonly canCancel: boolean;
  /** Try Again goes on from where a stopped import got to. */
  readonly canRetry: boolean;
  /** Once done, the songs not found (the line opens them); the page can dismiss them. */
  readonly notFound: ImportNotice | null;
}

/** What [playlistId]'s page shows of its import; null with none. */
export const playlistImportView = <S extends YtSong>(
  imports: PlaylistImports<S>,
  playlistId: number,
): PlaylistImportView | null => {
  const job = imports.find((queued) => queued.playlistId === playlistId);
  if (job === undefined) return null;
  const total = job.songs.length;
  const shown = (line: string, canRetry = false): PlaylistImportView => ({
    line,
    canCancel: true,
    canRetry,
    notFound: null,
  });
  switch (job.state.kind) {
    case "importing":
      return importTurn(imports) === job
        ? shown(`Importing ${settledCount(job).toLocaleString("en")} of ${counted(total, "song")}`)
        : shown(`Waiting to import ${counted(total, "song")}`);
    case "stopped":
      return shown(STOPPED_LINES[job.state.reason], true);
    case "done": {
      const notFound = notFoundNotice(job);
      return { line: notFound.title, canCancel: false, canRetry: false, notFound };
    }
  }
};

/** The import notification while an import goes on. */
export interface PlaylistImportProgress {
  readonly title: string;
  readonly detail: string;
  /** Songs settled, of [total], for the progress bar. */
  readonly done: number;
  readonly total: number;
}

/** What the notification shows of the import going on now; null when none is. */
export const playlistImportProgress = <S extends YtSong>(
  imports: PlaylistImports<S>,
): PlaylistImportProgress | null => {
  const job = importTurn(imports);
  if (job === null) return null;
  const done = settledCount(job);
  const total = job.songs.length;
  const waiting = imports.filter(
    (queued) => queued !== job && queued.state.kind === "importing",
  ).length;
  const counts = `${done.toLocaleString("en")} of ${counted(total, "song")}`;
  return {
    title: `Importing ${job.name}`,
    detail:
      waiting === 0
        ? counts
        : `${counts} · ${counted(waiting, "more playlist", "more playlists")} waiting`,
    done,
    total,
  };
};
