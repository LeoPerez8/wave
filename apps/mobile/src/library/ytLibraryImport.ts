/**
 * From YT Music's Import (docs/spec.md, "Importing playlists from a link"):
 * each ticked playlist becomes a Wave playlist at once, empty and named by
 * Core (`planYtLibraryImport`: Keep Both's name on a clash, without asking).
 * Wave then reads them one at a time, in the picker's order, and fills each
 * as a YouTube Music link import does (`readYtPlaylist`, `planLinkImport`,
 * `finishPlaylistImport`), Liked Songs whole and the others up to the cap.
 * Nothing is downloaded or searched; there's no notification and no service.
 * The batch is kept on the phone (Core's `writeYtLibraryBatch`), so the
 * playlists not read when Android stopped Wave are read once it starts again,
 * in the same order. Offline or with YT Music off the batch pauses, every
 * playlist still waiting, and goes on when Wave starts again, comes back to
 * the foreground or imports again. A read that fails otherwise leaves its
 * playlist empty, with a line and Try Again on its page. With Also add to Favorites on, Liked Songs'
 * read stars its songs the Library has (Core's `ytLibraryFavorites`), kept
 * in the batch so a resumed read or Try Again still stars; the star syncs
 * like any other, and the import never takes one away.
 *
 * Each playlist's origin (the YouTube Music playlist it came from) is kept
 * on this phone, unsynced: the picker marks those rows Imported, and ticking
 * one refreshes that playlist as Replace does. Deleting it forgets it.
 */
import {
  isYtLibraryReadQueued,
  liveYtLibraryOrigins,
  nextYtLibraryRead,
  planLinkImport,
  planYtLibraryImport,
  pruneYtLibraryBatch,
  queueYtLibraryReads,
  readYtLibraryBatch,
  readYtLibraryOrigins,
  writeYtLibraryBatch,
  writeYtLibraryOrigins,
  ytLibraryFavorites,
  ytLibraryPauseLogLine,
  ytLibraryReadDone,
  ytLibraryReadFailed,
  ytLibraryReadLogLine,
  ytLibraryReadView,
  type YtLibraryBatch,
  type YtLibraryOrigins,
  type YtLibraryPicker,
  type YtLibraryRead,
} from "@wave/core";
import * as Result from "effect/Result";
import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { makeExternalStore } from "@/lib/externalStore";
import { persistedSetting } from "@/lib/persistedSetting";
import { appLog } from "@/log/appLog";
import { askYtMusic } from "@/ytmusic/askYtMusic";

import { setFavorites } from "./favorites";
import { listLibrary } from "./playlistImports";
import { cancelPlaylistImport, startLinkImport } from "./playlistImports";
import { createPlaylist, currentPlaylists, replacePlaylistSongs } from "./playlists";

const LOG_TAG = "WaveImport";

/** Which YouTube Music playlist each playlist From YT Music made came from (this phone only). */
const origins = persistedSetting<YtLibraryOrigins>({
  key: "ytLibraryOrigins",
  read: readYtLibraryOrigins,
  write: (value) => (value.size === 0 ? null : writeYtLibraryOrigins(value)),
});

/**
 * The origins of the playlists that still exist, for the picker; those of
 * playlists deleted (here or on another phone) are forgotten. Should the
 * playlists not read, the kept ones stand: Import checks them again.
 */
export const currentYtLibraryOrigins = async (): Promise<YtLibraryOrigins> => {
  const playlists = await currentPlaylists().catch(() => null);
  if (playlists === null) return origins.get();
  const live = liveYtLibraryOrigins(origins.get(), playlists);
  if (live.size !== origins.get().size) origins.set(live);
  return live;
};

/** After a delete: the deleted playlists forget where they came from. */
export const forgetDeletedYtLibraryOrigins = async (): Promise<void> => {
  if (origins.get().size > 0) await currentYtLibraryOrigins();
};

/** The playlists still to be read, and those whose read failed; phone-local, never synced. */
const batch = persistedSetting<YtLibraryBatch>({
  key: "ytLibraryBatch",
  read: readYtLibraryBatch,
  write: writeYtLibraryBatch,
});

/** The batch, for a playlist page's line. */
export const useYtLibraryBatch = (): YtLibraryBatch => batch.useValue();

/** The playlists Try Again is reading now. */
const readingAgain = makeExternalStore<ReadonlySet<number>>(new Set());

/** Whether Try Again is reading [playlistId] now. */
export const useReadingAgain = (playlistId: number): boolean =>
  useSyncExternalStore(readingAgain.subscribe, () => readingAgain.get().has(playlistId));

/** Whether the batch is reading its playlists now. */
let reading = false;

/**
 * Reads [read]'s playlist and gives its Wave playlist the songs, as a link
 * import does (whose line goes to the app log), starring the Library's songs
 * when it was asked to. A read whose playlist was refreshed or deleted
 * meanwhile gives its answer to nothing (Core's `isYtLibraryReadQueued`).
 * Offline or with YT Music off, nothing changes and it resolves the reason:
 * the batch pauses there. Any other failure leaves the playlist empty, marks
 * it failed and says so in the log.
 */
const fill = async (read: YtLibraryRead): Promise<string | null> => {
  let reason: string;
  try {
    const answer = await askYtMusic((ytMusic) =>
      ytMusic.playlist(read.source, { uncapped: !read.capped }),
    );
    if (Result.isSuccess(answer)) {
      if (!isYtLibraryReadQueued(batch.get(), read)) return null;
      const plan = planLinkImport(
        { service: "ytMusic", playlist: answer.success },
        await listLibrary(),
      );
      // Before it leaves the batch: Wave stopped in between stars again, which changes nothing.
      await setFavorites(ytLibraryFavorites(read, plan), true);
      // Checked again with no wait before the link import starts: a refresh from here on
      // empties the playlist and ends that import.
      if (!isYtLibraryReadQueued(batch.get(), read)) return null;
      // Read: the link import, kept on its own, gives it its songs from here.
      batch.set(ytLibraryReadDone(batch.get(), read));
      await startLinkImport(plan, { playlistId: read.playlistId, name: read.name });
      return null;
    }
    reason = answer.failure.reason;
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  const failure = ytLibraryReadFailed(batch.get(), read, reason);
  if (failure.pause) return reason;
  if (isYtLibraryReadQueued(batch.get(), read)) {
    appLog("warn", LOG_TAG, ytLibraryReadLogLine(read, reason));
  }
  batch.set(failure.batch);
  return null;
};

/**
 * Drops the playlists deleted meanwhile, here or on another phone. A batch
 * that changed while the playlists were read (an Import queued one made
 * since) is left for the next turn.
 */
const prune = async (): Promise<void> => {
  const before = batch.get();
  const playlists = await currentPlaylists();
  const pruned = pruneYtLibraryBatch(
    before,
    playlists.map((playlist) => playlist.id),
  );
  if (batch.get() === before) batch.set(pruned);
};

/**
 * Reads the waiting playlists one at a time, in order, until none is left,
 * or until a read finds Wave offline or YT Music off: the batch then waits
 * for its next turn (Wave starting again, coming back to the foreground, or
 * another Import). The playlists deleted are dropped once, as it starts; one
 * deleted while it runs is read, and its link import ends at once.
 */
const readBatch = async (): Promise<void> => {
  if (reading || nextYtLibraryRead(batch.get()) === undefined) return;
  reading = true;
  try {
    await prune();
    for (;;) {
      const next = nextYtLibraryRead(batch.get());
      if (next === undefined) return;
      const pausedBy = await fill(next);
      if (pausedBy !== null) {
        appLog("info", LOG_TAG, ytLibraryPauseLogLine(next, pausedBy));
        return;
      }
    }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    appLog("warn", LOG_TAG, `The YouTube Music import's batch stopped: ${why}`);
  } finally {
    reading = false;
  }
};

/**
 * The playlist an earlier import made, emptied for a fresh copy as Replace
 * empties it. A link import still filling it would add its songs to the new
 * ones, so it ends.
 */
const emptyPlaylist = async (
  playlistId: number,
  name: string,
): Promise<{ readonly playlistId: number; readonly name: string }> => {
  cancelPlaylistImport(playlistId);
  await replacePlaylistSongs(playlistId, []);
  return { playlistId, name };
};

/**
 * Import in the From YT Music picker: makes a playlist of each ticked row
 * now, in its order, or empties the one an earlier import made, each kept in
 * the batch as it's made, then reads them in the background. Resolves once
 * the playlists exist.
 */
export const importYtLibrary = async (picker: YtLibraryPicker): Promise<void> => {
  try {
    await makeYtLibraryPlaylists(picker);
  } finally {
    // The playlists queued before one that couldn't be made are read all the same.
    void readBatch();
  }
};

/** Makes or empties each ticked row's playlist, in order, queuing each as it's made. */
const makeYtLibraryPlaylists = async (picker: YtLibraryPicker): Promise<void> => {
  const items = planYtLibraryImport(picker, await currentPlaylists());
  for (const item of items) {
    const made =
      item.replaces === null
        ? await createPlaylist(item.name)
        : await emptyPlaylist(item.replaces, item.name);
    batch.set(
      queueYtLibraryReads(batch.get(), [
        {
          source: item.playlistId,
          playlistId: made.playlistId,
          name: made.name,
          capped: !item.uncapped,
          favorites: item.favorites,
        },
      ]),
    );
    origins.set(new Map(origins.get()).set(item.playlistId, made.playlistId));
  }
};

/** Whether the batch goes on each time Wave comes back to the foreground. */
let followingForeground = false;

/**
 * Once Wave starts with all-files access: the playlists a batch hadn't read
 * when Android stopped Wave, or when it paused offline or with YT Music off,
 * are read, in the same order, and again each time Wave comes back to the
 * foreground. Safe to call repeatedly.
 */
export const resumeYtLibraryImport = (): void => {
  if (!followingForeground) {
    followingForeground = true;
    AppState.addEventListener("change", (state) => {
      if (state === "active") void readBatch();
    });
  }
  void readBatch();
};

/**
 * Try Again on [playlistId]'s page: reads it again now and fills it as the
 * batch would have; a failure leaves the line as it was.
 */
export const readYtLibraryPlaylistAgain = async (playlistId: number): Promise<void> => {
  const view = ytLibraryReadView(batch.get(), playlistId);
  if (view === null || readingAgain.get().has(playlistId)) return;
  readingAgain.set(new Set([...readingAgain.get(), playlistId]));
  try {
    // Offline or with YT Music off the line stays, and the log says why.
    const pausedBy = await fill(view.read);
    if (pausedBy !== null) appLog("warn", LOG_TAG, ytLibraryReadLogLine(view.read, pausedBy));
  } finally {
    readingAgain.set(new Set([...readingAgain.get()].filter((id) => id !== playlistId)));
  }
};
