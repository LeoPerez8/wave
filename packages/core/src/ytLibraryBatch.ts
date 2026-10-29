/**
 * From YT Music's batch (docs/spec.md, "Importing playlists from a link",
 * From YT Music): the playlists Import made that are still to be read from
 * YouTube Music, kept on the phone so a Wave Android stopped reads the rest
 * when it starts again, in the same order. A read that failed stays, for its
 * playlist's line and Try Again.
 */

import { finishSteps } from "./buildSteps.ts";
import { importPausedLogLine, importReadFailedLogLine } from "./importLog.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { pendingFavorite, type PendingFavorite } from "./pendingFavorites.ts";
import type { LinkImportPlan } from "./playlistImport.ts";
import { isSpotifyLibrarySource } from "./spotifyLibrary.ts";
import { readStoredRecord } from "./storedJson.ts";
import type { YtSong } from "./ytMusic.ts";

/**
 * Waiting its turn to be read, read and failed (its playlist stays empty),
 * or read and filled with its downloads still to queue (Import & Download):
 * kept until they're queued, so Wave stopping in between still queues them.
 */
export type YtLibraryReadState = "waiting" | "failed" | "filled";

/** A playlist Import made, to be read from YouTube Music. */
export interface YtLibraryRead {
  /**
   * Tells this read apart from any other of the same playlist (a refresh
   * queued while it ran), so a read's answer only ever settles its own
   * entry. Given as it's queued; it lives while Wave runs, as a read does.
   */
  readonly token: number;
  /** The YouTube Music playlist it's read from, without `VL`. */
  readonly source: string;
  /** The Wave playlist it fills. */
  readonly playlistId: number;
  /** That playlist's name as Import made it. */
  readonly name: string;
  /** Whether the read stops at the 5,000-song cap (`YT_PLAYLIST_SONG_CAP`). */
  readonly capped: boolean;
  /**
   * Whether its songs the Library has get the Favorite star once it's read
   * (Liked Songs with Also add to Favorites on; `ytLibraryFavorites`).
   */
  readonly favorites: boolean;
  /**
   * Whether its downloads are queued once it's read and filled, as its
   * Download Playlist would (Import & Download). A read that failed loses it:
   * Try Again imports it without downloading.
   */
  readonly download: boolean;
  /**
   * How many songs its source says it has, as the picker showed it (null
   * when the picker had no count: a Spotify playlist, or a library page that
   * didn't say). Its progress line's "Waiting · N songs" and the first total
   * it's read against (Core's `importProgress`).
   */
  readonly expected: number | null;
  readonly state: YtLibraryReadState;
}

/** The batch: its playlists in the order they're read, and the last token given. */
export interface YtLibraryBatch {
  readonly reads: readonly YtLibraryRead[];
  readonly lastToken: number;
  /**
   * The playlists of the batch's run, by playlist id, in the order they were
   * queued: every one an Import queued since the batch last had none
   * waiting, done or not. Playlists' "Importing playlists · 12 of 80" counts
   * them (Core's `importBatchLine`). Forgotten once the run ends
   * (`endYtLibraryRun`), so Try Again's read later isn't counted.
   */
  readonly run: readonly number[];
}

/** A batch with nothing to read. */
export const NO_YT_LIBRARY_READS: YtLibraryBatch = { reads: [], lastToken: 0, run: [] };

/** A playlist an Import queues: Import & Download's with `download`, Import's without. */
export type YtLibraryReadToQueue = Omit<
  YtLibraryRead,
  "state" | "token" | "download" | "expected"
> & {
  readonly download?: boolean;
  readonly expected?: number | null;
};

/**
 * [batch] with [reads] (the playlists an Import just made or refreshed, in
 * its order) waiting after it, each with a new token. A refreshed playlist
 * still in the batch, waiting or failed, leaves its old place: it's read
 * once, in the new order, and a read of it still running answers nothing.
 * They join the batch's run, which starts afresh when none was waiting.
 */
export const queueYtLibraryReads = (
  batch: YtLibraryBatch,
  reads: readonly YtLibraryReadToQueue[],
): YtLibraryBatch => ({
  run: joinRun(nextYtLibraryRead(batch) === undefined ? [] : batch.run, reads),
  reads: [
    ...batch.reads.filter((queued) => !reads.some((read) => read.playlistId === queued.playlistId)),
    ...reads.map(({ source, playlistId, name, capped, favorites, download, expected }, index) => ({
      token: batch.lastToken + index + 1,
      source,
      playlistId,
      name,
      capped,
      favorites,
      download: download === true,
      expected: expected ?? null,
      state: "waiting" as const,
    })),
  ],
  lastToken: batch.lastToken + reads.length,
});

/** [run] with [reads]' playlists after it, each once. */
const joinRun = (
  run: readonly number[],
  reads: readonly YtLibraryReadToQueue[],
): readonly number[] => {
  const ids = new Set(run);
  const joined = [...run];
  for (const { playlistId } of reads) {
    if (ids.has(playlistId)) continue;
    ids.add(playlistId);
    joined.push(playlistId);
  }
  return joined;
};

/**
 * [batch] once its run ended, none of its playlists waiting: the run is
 * forgotten, so the line at the top of Playlists goes and Try Again's read
 * of a failed playlist isn't counted. With one still waiting (the run
 * paused, or another Import queued meanwhile), [batch] as it is.
 */
export const endYtLibraryRun = (batch: YtLibraryBatch): YtLibraryBatch =>
  batch.run.length === 0 || nextYtLibraryRead(batch) !== undefined ? batch : { ...batch, run: [] };

/**
 * The playlist to read next: the first one waiting. One being read when
 * Wave stopped is still waiting, so it's read again first.
 */
export const nextYtLibraryRead = (batch: YtLibraryBatch): YtLibraryRead | undefined =>
  batch.reads.find((read) => read.state === "waiting");

/**
 * Whether [read] is still in [batch], so its answer fills its playlist. A
 * read whose playlist was refreshed (a newer read fills it) or deleted
 * meanwhile gives its answer to nothing.
 */
export const isYtLibraryReadQueued = (batch: YtLibraryBatch, read: YtLibraryRead): boolean =>
  batch.reads.some((queued) => queued.token === read.token);

/**
 * [batch] once [read]'s playlist was read (its songs go to the link import
 * from then on): it's no longer waiting. One that downloads stays, filled,
 * until its downloads are queued (`ytLibraryDownloadsQueued`); any other
 * leaves the batch. A newer read of the same playlist stays.
 */
export const ytLibraryReadDone = (batch: YtLibraryBatch, read: YtLibraryRead): YtLibraryBatch =>
  read.download
    ? {
        ...batch,
        reads: batch.reads.map((queued) =>
          queued.token === read.token ? { ...queued, state: "filled" as const } : queued,
        ),
      }
    : withoutRead(batch, read);

/** [batch] without [read], by its token. */
const withoutRead = (batch: YtLibraryBatch, read: YtLibraryRead): YtLibraryBatch =>
  isYtLibraryReadQueued(batch, read)
    ? { ...batch, reads: batch.reads.filter((queued) => queued.token !== read.token) }
    : batch;

/**
 * The playlists read and filled whose downloads still need queuing: Wave
 * stopped between filling them and queuing them, so it queues them as it
 * resumes the batch.
 */
export const ytLibraryDownloadsToQueue = (batch: YtLibraryBatch): YtLibraryRead[] =>
  batch.reads.filter((read) => read.state === "filled");

/** [batch] once filled [read]'s downloads were queued: it leaves the batch. */
export const ytLibraryDownloadsQueued = (
  batch: YtLibraryBatch,
  read: YtLibraryRead,
): YtLibraryBatch => withoutRead(batch, read);

/** [batch] without the playlists deleted meanwhile: those not among [playlistIds], here or on another phone. */
export const pruneYtLibraryBatch = (
  batch: YtLibraryBatch,
  playlistIds: readonly number[],
): YtLibraryBatch => {
  const kept = new Set(playlistIds);
  const reads = batch.reads.filter((read) => kept.has(read.playlistId));
  return reads.length === batch.reads.length ? batch : { ...batch, reads };
};

/**
 * Why a read failed when every read would fail alike, so the batch pauses:
 * no network, YT Music off, or (From Spotify) no Spotify session Spotify accepts.
 */
export type YtLibraryPauseReason = "offline" | "disabled" | "signedOut";

const PAUSING_REASONS: ReadonlySet<string> = new Set<YtLibraryPauseReason>([
  "offline",
  "disabled",
  "signedOut",
]);

/** Whether a read that failed because of [reason] pauses the batch. */
export const isYtLibraryPauseReason = (reason: string): reason is YtLibraryPauseReason =>
  PAUSING_REASONS.has(reason);

/** What a failed read leaves (`ytLibraryReadFailed`). */
export interface YtLibraryReadFailure {
  readonly batch: YtLibraryBatch;
  /**
   * Why the batch stops reading for now, as every read after it would fail
   * alike; null when it goes on.
   */
  readonly pausedBy: YtLibraryPauseReason | null;
}

/**
 * What [batch] becomes once [read] failed because of [reason]. Offline
 * (`offline`), with YT Music off (`disabled`) or signed out of Spotify
 * (`signedOut`), nothing changes and the batch pauses: its playlist and the rest keep waiting, in order, and a
 * failed one Try Again read keeps its line. Refused, or an answer Wave
 * can't read, marks its playlist failed (it stays empty, with Try Again,
 * which imports it without downloading) and the rest goes on. A newer read
 * of the same playlist stays as it was.
 */
export const ytLibraryReadFailed = (
  batch: YtLibraryBatch,
  read: YtLibraryRead,
  reason: string,
): YtLibraryReadFailure => {
  if (isYtLibraryPauseReason(reason)) return { batch, pausedBy: reason };
  if (!isYtLibraryReadQueued(batch, read)) return { batch, pausedBy: null };
  return {
    batch: {
      ...batch,
      reads: batch.reads.map((queued) =>
        queued.token === read.token
          ? { ...queued, download: false, state: "failed" as const }
          : queued,
      ),
    },
    pausedBy: null,
  };
};

/** What Also add to Favorites does once Liked Songs is read (`ytLibraryFavorites`). */
export interface YtLibraryFavorites<S extends YtSong = YtSong> {
  /** The Library tracks starred at once. */
  readonly star: readonly number[];
  /** The liked songs the Library hasn't: each starred once it enters the Library. */
  readonly pending: readonly PendingFavorite[];
  /**
   * The pending favorites' songs, as YT Music found them: their stars ask for
   * their downloads (a star means downloaded), which join the queue under
   * Favorites. None for Import & Download's read, whose playlist Download
   * asks for them all itself.
   */
  readonly download: readonly S[];
}

/**
 * What [read]'s playlist, read as [plan], stars: with Also add to Favorites
 * on, each of its songs that goes in as a Library track (`libraryFinder`, as
 * `planLinkImport` matched it) at once, and each that goes in as a YT Music
 * entry becomes a pending favorite (`pendingFavorite`), starred once a
 * download or a scan brings it into the Library (`settlePendingFavorites`),
 * its download asked for as any star's is. Each once. Only stars: the import
 * never takes one away.
 */
export const ytLibraryFavorites = <S extends YtSong>(
  read: YtLibraryRead,
  plan: Pick<LinkImportPlan<S>, "finds">,
): YtLibraryFavorites<S> => finishSteps(ytLibraryFavoritesSteps(read, plan));

/** What a playlist's page shows when its read failed: the line, and the read Try Again makes. */
export interface YtLibraryReadView {
  readonly line: string;
  readonly read: YtLibraryRead;
}

/** What [playlistId]'s page shows of its read: null unless it failed. */
export const ytLibraryReadView = (
  batch: YtLibraryBatch,
  playlistId: number,
  language: AppLanguage = "en",
): YtLibraryReadView | null => {
  const read = batch.reads.find((queued) => queued.playlistId === playlistId);
  return read?.state === "failed"
    ? { line: catalogueOf(language).imports.couldntReadOnline, read }
    : null;
};

/** The service [read] is read from, as the app log names it. */
const serviceName = (read: YtLibraryRead): string =>
  isSpotifyLibrarySource(read.source) ? "Spotify" : "YouTube Music";

/** The app log's line for [read] that failed because of [reason]; no song titles. */
export const ytLibraryReadLogLine = (read: YtLibraryRead, reason: string): string =>
  importReadFailedLogLine(read.name, serviceName(read), reason);

/** The app log's line for the batch paused at [read] because of [reason] (`ytLibraryReadFailed`). */
export const ytLibraryPauseLogLine = (read: YtLibraryRead, reason: string): string =>
  importPausedLogLine(read.name, serviceName(read), reason);

// ---------------------------------------------------------------------------
// Kept while Wave is closed

const KEPT_VERSION = 1;

/**
 * [batch] as kept on the phone (`readYtLibraryBatch`); null when there's
 * nothing to keep. Tokens aren't kept: no read outlives Wave.
 */
export const writeYtLibraryBatch = (batch: YtLibraryBatch): string | null =>
  batch.reads.length === 0
    ? null
    : JSON.stringify({
        version: KEPT_VERSION,
        run: batch.run,
        batch: batch.reads.map(
          ({ source, playlistId, name, capped, favorites, download, expected, state }) => ({
            source,
            playlistId,
            name,
            capped,
            favorites,
            download,
            expected,
            state,
          }),
        ),
      });

/**
 * A kept playlist, given [token]; null when unreadable. One kept by a Wave
 * from before Also add to Favorites stars nothing, and one from before
 * Import & Download downloads nothing, and one from before the expected
 * count has none.
 */
const readRead = (value: unknown, token: number): YtLibraryRead | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { source, playlistId, name, capped, favorites, download, expected, state } =
    value as Record<string, unknown>;
  if (typeof source !== "string" || typeof playlistId !== "number" || typeof name !== "string") {
    return null;
  }
  if (typeof capped !== "boolean") return null;
  if (state !== "waiting" && state !== "failed" && state !== "filled") return null;
  return {
    token,
    source,
    playlistId,
    name,
    capped,
    favorites: favorites === true,
    download: download === true,
    expected:
      typeof expected === "number" && Number.isSafeInteger(expected) && expected >= 0
        ? expected
        : null,
    state,
  };
};

/**
 * The batch kept as [stored] (`writeYtLibraryBatch`), in its order, each
 * playlist with a new token; a playlist kept unreadably is left out. Empty
 * when nothing readable is kept, or it was kept another way. A batch kept
 * by a Wave from before the run has the playlists it kept as its run.
 */
export const readYtLibraryBatch = (stored: string | null): YtLibraryBatch => {
  const { version, batch, run } = readStoredRecord(stored);
  if (version !== KEPT_VERSION || !Array.isArray(batch)) return NO_YT_LIBRARY_READS;
  const reads = batch
    .map((value: unknown, index) => readRead(value, index + 1))
    .filter((read): read is YtLibraryRead => read !== null);
  return {
    reads,
    lastToken: batch.length,
    run: Array.isArray(run)
      ? run.filter((id: unknown): id is number => typeof id === "number")
      : reads.map((read) => read.playlistId),
  };
};

/** Per-song favorite preparation for a resumed background library import. */
export function* ytLibraryFavoritesSteps<S extends YtSong>(
  read: YtLibraryRead,
  plan: Pick<LinkImportPlan<S>, "finds">,
): Generator<void, YtLibraryFavorites<S>> {
  const star: number[] = [];
  const pending: PendingFavorite[] = [];
  const download: S[] = [];
  if (!read.favorites) return { star, pending, download };
  for (const found of plan.finds) {
    if (found.kind === "library") star.push(found.trackId);
    else if (found.kind === "ytMusic") {
      pending.push(pendingFavorite(found.song));
      if (!read.download) download.push(found.song);
    }
    yield;
  }
  return { star, pending, download };
}
