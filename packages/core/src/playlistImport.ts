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
import type { LinkedPlaylist } from "./playlistLinks.ts";
import {
  artistNames,
  spotifySearchQuery,
  spotifyYtMatch,
  type YtSongSearch,
} from "./spotifyImport.ts";
import type { SpotifyPlaylist, SpotifySong } from "./spotifyPlaylist.ts";
import { logDuration, searchesDoneAt, type SearchAllowance } from "./searchAllowance.ts";
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
  /** The source's songs, in its order, each once. */
  readonly songs: readonly SpotifySong[];
  /** Where each of [songs] is found already (null: it's still to be searched). */
  readonly finds: readonly (ImportFind<S> | null)[];
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

/**
 * What importing [source] makes, given the Library: each song the Library
 * already has (Core's `libraryFinder`) as its track. A YouTube Music
 * playlist's other songs stream as they are; a Spotify playlist's are each
 * searched on YouTube Music once the import runs, except a song with no
 * artist, which is never searched and isn't found. A song that comes again
 * (the same Library track, the same video, or a Spotify song alike in every
 * field) is left out after its first place, as listed twice, so the card
 * counts it once and says so.
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
  const finds: (ImportFind<S> | null)[] = [];
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
    else finds.push(null);
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
    inLibrary: finds.filter((found) => found?.kind === "library").length,
    sourceTotal: listed.length + notSongs,
    leftOut,
    notSongs,
  };
};

/** [song] as the source lists it (its cover when it has one): a YouTube Music song's own fields left behind. */
const listedSong = ({ title, artists, album, durationMs, artworkUrl }: SpotifySong): SpotifySong =>
  typeof artworkUrl === "string"
    ? { title, artists, album, durationMs, artworkUrl }
    : { title, artists, album, durationMs };

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
  /** The source's songs left out before the import started (`LinkImportPlan`'s). */
  readonly leftOut: readonly LeftOutSong[];
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
  leftOut: plan.leftOut,
  added: 0,
  state: { kind: "importing" },
  asking: [],
  refused: {},
  pausedUntil: 0,
});

/**
 * What the source's song [listed] goes in as, once settled as [found]: the
 * Library's track, the YouTube Music song, or, not found, an unavailable song
 * in its place, as the source listed it (a song without an artist is a local
 * file, never searched).
 */
const playlistSong = <S extends YtSong>(
  found: ImportFind<S>,
  listed: SpotifySong | undefined,
): PlaylistSong<S> | null => {
  if (found.kind === "library") return { source: "library", trackId: found.trackId };
  if (found.kind === "ytMusic") return { source: "stream", song: found.song };
  if (listed === undefined) return null;
  const { title, artists, album, durationMs, artworkUrl = null } = listed;
  return {
    source: "unavailable",
    song: {
      title,
      artists,
      album,
      durationMs,
      artworkUrl,
      reason: artistNames(artists).length === 0 ? "localFile" : "notFound",
    },
  };
};

// ---------------------------------------------------------------------------
// What an import's finds come to, kept up as answers arrive

/** The search each of an import's songs is found by, and the songs each search finds. */
interface SongSearches {
  /** By song: its search (`spotifySearchQuery`). */
  readonly queries: readonly string[];
  /** By search: its songs, in the source's order. */
  readonly songsBy: ReadonlyMap<string, readonly number[]>;
}

/** By an import's songs, which never change once it starts. */
const songSearchesKept = new WeakMap<readonly SpotifySong[], SongSearches>();

const songSearches = (songs: readonly SpotifySong[]): SongSearches => {
  const kept = songSearchesKept.get(songs);
  if (kept !== undefined) return kept;
  const queries = songs.map(spotifySearchQuery);
  const songsBy = new Map<string, number[]>();
  queries.forEach((query, index) => {
    const same = songsBy.get(query);
    if (same === undefined) songsBy.set(query, [index]);
    else same.push(index);
  });
  const made = { queries, songsBy };
  songSearchesKept.set(songs, made);
  return made;
};

/**
 * What an import's finds come to: counted once when first asked for, then
 * kept up as each answer settles its songs, so neither an answer nor a
 * progress line reads every song again (#307). It belongs to one finds
 * array: the answer that makes the next moves it there, and an earlier
 * state of the import asked about later counts its own afresh.
 */
interface FindsTally {
  readonly songs: readonly SpotifySong[];
  /** How many songs are still to be found (null). */
  open: number;
  /** By search: how many of its songs are still to be found (none: left out). */
  readonly openBy: Map<string, number>;
  /** By the key a found song goes in by (`playlistSongKey`): the first song found as it. */
  readonly firstAt: Map<string, number>;
  /**
   * Leads past settled songs: following it from a song reaches the first
   * still to be found from there, or the end. Shortened as it's followed.
   */
  readonly ahead: Int32Array;
}

const tallies = new WeakMap<object, FindsTally>();

/** Counts [found], song [index], as settled in [tally]. */
const countSettled = <S extends YtSong>(
  tally: FindsTally,
  index: number,
  found: ImportFind<S>,
): void => {
  const song = playlistSong(found, tally.songs[index]);
  if (song === null) return;
  const key = playlistSongKey(song);
  const first = tally.firstAt.get(key);
  if (first === undefined || index < first) tally.firstAt.set(key, index);
};

/** [job]'s tally: kept, or counted now. */
const tallyOf = <S extends YtSong>(job: PlaylistImport<S>): FindsTally => {
  const kept = tallies.get(job.finds);
  if (kept !== undefined && kept.songs === job.songs) return kept;
  const { queries } = songSearches(job.songs);
  const { length } = job.finds;
  const tally: FindsTally = {
    songs: job.songs,
    open: 0,
    openBy: new Map(),
    firstAt: new Map(),
    ahead: new Int32Array(length + 1),
  };
  tally.ahead[length] = length;
  for (let index = 0; index < length; index += 1) {
    const found = job.finds[index];
    tally.ahead[index] = found === null ? index : index + 1;
    if (found === undefined) continue;
    if (found !== null) {
      countSettled(tally, index, found);
      continue;
    }
    tally.open += 1;
    const query = queries[index];
    if (query !== undefined) tally.openBy.set(query, (tally.openBy.get(query) ?? 0) + 1);
  }
  tallies.set(job.finds, tally);
  return tally;
};

/** The first song from [from] still to be found; the end when none is. */
const firstOpen = (tally: FindsTally, from: number): number => {
  const { ahead } = tally;
  const end = ahead.length - 1;
  if (from >= end) return end;
  let open = from;
  while (ahead[open] !== open) open = ahead[open] ?? end;
  for (let index = from; index !== open;) {
    const next = ahead[index] ?? end;
    ahead[index] = open;
    index = next;
  }
  return open;
};

/** Counts song [index], to be found by [query], as now [found], in [tally]. */
const settle = <S extends YtSong>(
  tally: FindsTally,
  index: number,
  query: string,
  found: ImportFind<S>,
): void => {
  tally.open -= 1;
  const left = (tally.openBy.get(query) ?? 1) - 1;
  if (left === 0) tally.openBy.delete(query);
  else tally.openBy.set(query, left);
  tally.ahead[index] = index + 1;
  countSettled(tally, index, found);
};

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
  const { firstAt } = tallyOf(job);
  const songs: PlaylistSong<S>[] = [];
  let through = job.added;
  for (; through < job.finds.length; through += 1) {
    const found = job.finds[through];
    if (found === null || found === undefined) break;
    const song = playlistSong(found, job.songs[through]);
    if (song === null) continue;
    // A song found as it earlier in the source went in before it (the songs since the last
    // given are all settled), so this one is left out.
    if ((firstAt.get(playlistSongKey(song)) ?? through) < through) continue;
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
 * The pauses before asking again once YouTube Music refuses a search, about
 * 34 minutes in all; the same search refused once more after the last, the
 * import stops. While refusing, YouTube Music answered most searches by the
 * third try, and refused a few for over half an hour.
 */
const RETRY_PAUSES_MS = [
  2000,
  5000,
  10_000,
  20_000,
  60_000,
  2 * 60_000,
  5 * 60_000,
  10 * 60_000,
  15 * 60_000,
] as const;

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
  const tally = tallyOf(job);
  const { queries } = songSearches(job.songs);
  const asking = new Set(job.asking);
  const end = job.finds.length;
  for (let index = firstOpen(tally, job.added); index < end; index = firstOpen(tally, index + 1)) {
    const query = queries[index];
    if (query !== undefined && !asking.has(query)) return query;
  }
  return null;
};

/**
 * What the app does next for [job] at [now] (ms), and the import once it's
 * done. The songs still to be found are searched in the source's order, one
 * Songs search per song (its title and artists, `spotifySearchQuery`; a song
 * listed twice is searched once), at most `SPOTIFY_SEARCHES_AT_ONCE` at once,
 * none while paused after a refusal. Each search then waits its turn in the
 * allowance every automatic search shares (`searchTurns`): the import keeps
 * no pacing of its own. The Library's songs are never searched, so they
 * spend none of it.
 */
export const nextImportStep = <S extends YtSong>(
  job: PlaylistImport<S>,
  now: number,
): {
  readonly job: PlaylistImport<S>;
  readonly step: ImportStep;
} => {
  const as = (step: ImportStep) => ({ job, step });
  if (job.state.kind !== "importing") return as({ kind: "none" });
  const waiting =
    job.asking.length > 0 ? ({ kind: "answers" } as const) : ({ kind: "none" } as const);
  if (job.asking.length >= SPOTIFY_SEARCHES_AT_ONCE) return as(waiting);
  const query = nextQuery(job);
  if (query === null) return as(waiting);
  if (now < job.pausedUntil) return as({ kind: "wait", untilMs: job.pausedUntil });
  return { job: { ...job, asking: [...job.asking, query] }, step: { kind: "search", query } };
};

/**
 * The import once YouTube Music answered [query] at [now] (ms). Found, each
 * song searched by it is settled: the result that is its recording
 * (`spotifyYtMatch`), or not found. Refused, the import pauses 2, 5, 10 and
 * 20 seconds, then 1, 2, 5, 10 and 15 minutes, before asking it again, ahead
 * of the songs after it; the same search refused a tenth time, it stops.
 * Offline, or with YT Music turned off, it stops at once.
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
    // Only the songs this search finds are read, through the search's own list of them.
    const tally = tallyOf(job);
    const settled = (songSearches(job.songs).songsBy.get(query) ?? []).filter(
      (index) => index >= job.added && index < job.finds.length && job.finds[index] === null,
    );
    if (settled.length === 0) return { ...job, asking, refused };
    const finds = job.finds.slice();
    tallies.delete(job.finds);
    for (const index of settled) {
      const song = job.songs[index];
      const match = song === undefined ? null : spotifyYtMatch(song, answer.songs);
      const found: ImportFind<S> = match === null ? NOT_FOUND : { kind: "ytMusic", song: match };
      finds[index] = found;
      settle(tally, index, query, found);
    }
    tallies.set(finds, tally);
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

/**
 * The songs [job] lists twice: those left out before it started, then those
 * found as the same song as one before them, which go in once. In the
 * source's order within each.
 */
const listedTwice = <S extends YtSong>(job: PlaylistImport<S>): SpotifySong[] => {
  const { firstAt } = tallyOf(job);
  const twice = job.leftOut
    .filter((left) => left.reason === "listedTwice")
    .map((left) => left.song);
  job.finds.forEach((found, index) => {
    const song =
      found === null || found === undefined ? null : playlistSong(found, job.songs[index]);
    if (song === null) return;
    const first = firstAt.get(playlistSongKey(song));
    const listed = job.songs[index];
    if (first !== undefined && first < index && listed !== undefined) twice.push(listed);
  });
  return twice;
};

/**
 * The imports with [job] as it is now. Done with no song left out, it's
 * gone: there's nothing to show (the songs not found are in the playlist,
 * unavailable).
 */
export const updatePlaylistImport = <S extends YtSong>(
  imports: PlaylistImports<S>,
  job: PlaylistImport<S>,
): PlaylistImports<S> =>
  nothingToShow(job)
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
        found?.kind === "ytMusic"
          ? { kind: "ytMusic", song: writePlaylistYtSong(found.song) }
          : found,
      ),
      leftOut: job.leftOut.map(({ song, reason }) => ({ song: listedSong(song), reason })),
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
  const { title, artists, album, durationMs, artworkUrl } = value;
  if (typeof title !== "string" || !isStrings(artists)) return null;
  if (album !== null && typeof album !== "string") return null;
  if (durationMs !== null && typeof durationMs !== "number") return null;
  return typeof artworkUrl === "string"
    ? { title, artists, album, durationMs, artworkUrl }
    : { title, artists, album, durationMs };
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

const LEFT_OUT_REASONS: readonly string[] = ["listedTwice", "notFound"] satisfies LeftOutReason[];

/** A kept song left out; null when unreadable. */
const readLeftOut = (value: unknown): LeftOutSong | null => {
  if (!isFields(value) || !LEFT_OUT_REASONS.includes(String(value.reason))) return null;
  const song = readSong(value.song);
  return song === null ? null : { song, reason: value.reason as LeftOutReason };
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

/**
 * The songs not found among the first [added] of an import an older Wave
 * kept: it gave the playlist nothing for them, so they're left out.
 */
const passedOver = (
  songs: readonly SpotifySong[],
  finds: readonly (ImportFind<YtAlbumSong> | null)[],
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
  const { playlistId, name, service, songs, finds, leftOut = [], added, state } = value;
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
  const keptFinds = readFinds as (ImportFind<YtAlbumSong> | null)[];
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
    asking: [],
    refused: {},
    pausedUntil: 0,
  };
};

/**
 * The imports kept as [stored] (`writePlaylistImports`), as they go on once
 * Wave starts again: each from where it got to, a stopped one going on again,
 * the searches unanswered when Wave closed asked afresh. None when nothing
 * readable is kept. An older Wave's done import names the songs it didn't
 * find, or, with nothing to name, is gone.
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
    .map(resumed);
};

// ---------------------------------------------------------------------------
// What the playlist page and the notification show

/** How many of [job]'s songs are settled: found, in the Library, or not found. */
const settledCount = <S extends YtSong>(job: PlaylistImport<S>): number =>
  job.finds.length - tallyOf(job).open;

const STOPPED_LINES: Record<ImportStopReason, string> = {
  offline: "Import paused: you're offline.",
  disabled: "Import paused: YT Music is off in Settings.",
  searchFailed: "Import paused: YouTube Music stopped answering.",
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
 * unavailable.
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

/** Whether [job] is done with no song left out to show. */
const nothingToShow = <S extends YtSong>(job: PlaylistImport<S>): boolean =>
  job.state.kind === "done" && leftOutNotice(job) === null;

/** The import line on a playlist's page. */
export interface PlaylistImportView {
  readonly line: string;
  /** Cancel stops the import, keeping the songs it gave the playlist. */
  readonly canCancel: boolean;
  /** Try Again goes on from where a stopped import got to. */
  readonly canRetry: boolean;
  /** Once done, the songs left out (the line opens them); the page can dismiss them. */
  readonly leftOut: ImportLeftOut | null;
}

/** The searches [job] still has to ask (not those asked and unanswered): one per query. */
const searchesLeft = <S extends YtSong>(job: PlaylistImport<S>): number => {
  const tally = tallyOf(job);
  const { queries } = songSearches(job.songs);
  // Songs still to be found before those given (none, as the app goes on) aren't searched.
  const before = new Map<string, number>();
  const given = Math.min(job.added, job.finds.length);
  for (let index = firstOpen(tally, 0); index < given; index = firstOpen(tally, index + 1)) {
    const query = queries[index];
    if (query !== undefined) before.set(query, (before.get(query) ?? 0) + 1);
  }
  const searched = (query: string): boolean => {
    const open = tally.openBy.get(query);
    return open !== undefined && before.get(query) !== open;
  };
  let left = tally.openBy.size;
  for (const query of before.keys()) if (!searched(query)) left -= 1;
  for (const query of new Set(job.asking)) if (searched(query)) left -= 1;
  return left;
};

/** "less than a minute left", "about 25 min left", "about 2 h 18 min left". */
const timeLeftLine = (ms: number): string => {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "less than a minute left";
  const hours = Math.floor(minutes / 60);
  return hours === 0 ? `about ${minutes} min left` : `about ${hours} h ${minutes % 60} min left`;
};

/**
 * About how long [job]'s searches still take at [now], given the searches
 * asked lately ([searches], the shared allowance's): at about 6 a second,
 * within `SEARCH_ALLOWANCE` in any `SEARCH_WINDOW_MS`, after any pause for a
 * refusal. Null when none is left to ask.
 */
const timeLeft = <S extends YtSong>(
  job: PlaylistImport<S>,
  now: number,
  searches: Pick<SearchAllowance, "searchesAt">,
): number | null => {
  const left = searchesLeft(job);
  if (left === 0) return null;
  return searchesDoneAt(searches.searchesAt, Math.max(now, job.pausedUntil), left) - now;
};

/**
 * What [playlistId]'s page shows of its import at [now] (ms), given the
 * searches asked lately ([searches], the shared allowance's); null with
 * none. The import going on says how far it got and, while it has searches
 * to ask, about how long they take.
 */
export const playlistImportView = <S extends YtSong>(
  imports: PlaylistImports<S>,
  playlistId: number,
  now: number,
  searches: Pick<SearchAllowance, "searchesAt">,
): PlaylistImportView | null => {
  const job = imports.find((queued) => queued.playlistId === playlistId);
  if (job === undefined) return null;
  const total = job.songs.length;
  const shown = (line: string, canRetry = false): PlaylistImportView => ({
    line,
    canCancel: true,
    canRetry,
    leftOut: null,
  });
  switch (job.state.kind) {
    case "importing": {
      if (importTurn(imports) !== job) return shown(`Waiting to import ${counted(total, "song")}`);
      const progress = `Importing ${settledCount(job).toLocaleString("en")} of ${counted(total, "song")}`;
      const left = timeLeft(job, now, searches);
      return shown(left === null ? progress : `${progress} · ${timeLeftLine(left)}`);
    }
    case "stopped":
      return shown(STOPPED_LINES[job.state.reason], true);
    case "done": {
      const leftOut = leftOutNotice(job);
      if (leftOut === null) return null;
      return { line: leftOut.title, canCancel: false, canRetry: false, leftOut };
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

/**
 * How often the playlist page's import line and the notification follow an
 * import's progress: each search answered would otherwise redraw them.
 */
export const IMPORT_PROGRESS_SHOWN_EVERY_MS = 1000;

const sameState = (a: ImportState, b: ImportState): boolean =>
  a.kind === b.kind && (a.kind !== "stopped" || b.kind !== "stopped" || a.reason === b.reason);

/**
 * Whether the imports [next] differ from those [shown] only in how far they
 * got (songs found and given, searches asked, refused or paused): the page
 * and the notification take that at most every
 * `IMPORT_PROGRESS_SHOWN_EVERY_MS`. Anything else (an import queued,
 * cancelled, stopped, done or tried again) shows at once.
 */
export const importProgressOnly = <S extends YtSong>(
  shown: PlaylistImports<S>,
  next: PlaylistImports<S>,
): boolean =>
  shown.length === next.length &&
  shown.every((job, index) => {
    const other = next[index];
    return (
      other !== undefined &&
      other.playlistId === job.playlistId &&
      other.name === job.name &&
      other.songs === job.songs &&
      sameState(other.state, job.state)
    );
  });

// ---------------------------------------------------------------------------
// The app log

/** How long an import has run, for its last line: kept by the app while Wave runs. */
export interface ImportRun {
  /** When it started, or went on after a restart (ms). */
  readonly startedAt: number;
  /** The searches it asked, and how many of them YouTube Music refused. */
  readonly searches: number;
  readonly refusals: number;
  /** How long its searches waited for the search allowance (ms). */
  readonly waitedMs: number;
  /** Whether it went on after a restart: the counts are since then. */
  readonly resumed: boolean;
}

/** Something an import did that the app log notes. */
export type ImportLogEvent =
  | { readonly kind: "started"; readonly resumed: boolean }
  /** Paused at [now] after YouTube Music refused [query] (`importSearchAnswered`). */
  | { readonly kind: "paused"; readonly query: string; readonly now: number }
  | { readonly kind: "stopped" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "retried" }
  | { readonly kind: "done"; readonly run: ImportRun; readonly now: number };

const SERVICE_NAMES: Record<ImportService, string> = {
  ytMusic: "YouTube Music",
  spotify: "Spotify",
};

const STOP_NAMES: Record<ImportStopReason, string> = {
  offline: "offline",
  disabled: "YT Music off",
  searchFailed: "YouTube Music stopped answering",
};

/** "1 found, 3 not found, 2 left": the songs found (the Library's too), not found, and still to settle. */
const findsLine = <S extends YtSong>(job: PlaylistImport<S>, withLeft: boolean): string => {
  let found = 0;
  let notFound = 0;
  for (const find of job.finds) {
    if (find === null) continue;
    if (find.kind === "notFound") notFound += 1;
    else found += 1;
  }
  const counts = `${found.toLocaleString("en")} found, ${notFound.toLocaleString("en")} not found`;
  return withLeft ? `${counts}, ${tallyOf(job).open.toLocaleString("en")} left` : counts;
};

/** "3 searches needed", "no searches needed". */
const searchesNeeded = <S extends YtSong>(job: PlaylistImport<S>): string => {
  const left = searchesLeft(job);
  return left === 0 ? "no searches needed" : `${counted(left, "search", "searches")} needed`;
};

/**
 * The app log's line for [event] of [job]: a few per import, never one per
 * search answered (docs/spec.md, "App log"). Song titles and artists may
 * appear, as in any search; nothing else about the Library does.
 */
export const importLogLine = <S extends YtSong>(
  job: PlaylistImport<S>,
  event: ImportLogEvent,
): string => {
  const name = `Import of "${job.name}"`;
  const total = job.songs.length;
  const from = SERVICE_NAMES[job.service];
  switch (event.kind) {
    case "started":
      return event.resumed
        ? `${name} from ${from} goes on after a restart: ${settledCount(job).toLocaleString("en")} of ${counted(total, "song")} settled, ${searchesNeeded(job)}`
        : `${name} from ${from} started: ${counted(total, "song")}, ${searchesNeeded(job)}`;
    case "paused": {
      const refusals = job.refused[event.query] ?? 0;
      const pause = logDuration(Math.max(0, job.pausedUntil - event.now));
      return `${name} pauses ${pause}: YouTube Music refused "${event.query}" ${counted(refusals, "time")} in a row`;
    }
    case "stopped":
      return job.state.kind === "stopped"
        ? `${name} stopped (${STOP_NAMES[job.state.reason]}): ${findsLine(job, true)}`
        : `${name} stopped: ${findsLine(job, true)}`;
    case "cancelled":
      return `${name} cancelled: ${findsLine(job, true)}`;
    case "retried":
      return `${name} tried again: ${counted(tallyOf(job).open, "song")} left`;
    case "done": {
      const { run, now } = event;
      const since = run.resumed ? " since Wave started again" : "";
      const searches = counted(run.searches, "search", "searches");
      const waited = `${logDuration(run.waitedMs)} of it waiting for the search allowance`;
      return `${name} done: ${findsLine(job, false)}; ${searches}, ${run.refusals.toLocaleString("en")} refused; ${logDuration(now - run.startedAt)} in all${since}, ${waited}`;
    }
  }
};
