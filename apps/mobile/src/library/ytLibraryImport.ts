/**
 * From YT Music's Import (docs/spec.md, "Importing playlists from a link"):
 * each ticked playlist becomes a Wave playlist at once, empty and named by
 * Core (`planYtLibraryImport`: Keep Both's name on a clash, without asking).
 * Wave then reads them one at a time, in the picker's order, and fills each
 * as a YouTube Music link import does (`readYtPlaylist`, `planLinkImport`,
 * `finishPlaylistImport`). Nothing is downloaded or searched; there's no
 * notification and no service. The batch is kept on the phone (Core's
 * `writeYtLibraryBatch`), so the playlists not read when Android stopped
 * Wave are read once it starts again, in the same order. A read that fails
 * leaves its playlist empty, with a line and Try Again on its page.
 */
import {
  nextYtLibraryRead,
  planLinkImport,
  planYtLibraryImport,
  pruneYtLibraryBatch,
  queueYtLibraryReads,
  readYtLibraryBatch,
  writeYtLibraryBatch,
  ytLibraryReadDone,
  ytLibraryReadFailed,
  ytLibraryReadLogLine,
  ytLibraryReadView,
  type YtLibraryBatch,
  type YtLibraryPicker,
  type YtLibraryRead,
} from "@wave/core";
import * as Result from "effect/Result";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { persistedSetting } from "@/lib/persistedSetting";
import { appLog } from "@/log/appLog";
import { askYtMusic } from "@/ytmusic/askYtMusic";

import { listLibrary } from "./importPlaylistLink";
import { startLinkImport } from "./playlistImports";
import { createPlaylist, currentPlaylists } from "./playlists";

const LOG_TAG = "WaveImport";

/** The playlists still to be read, and those whose read failed; phone-local, never synced. */
const batch = persistedSetting<YtLibraryBatch>({
  key: "ytLibraryBatch",
  read: readYtLibraryBatch,
  write: (value) => (value.length === 0 ? null : writeYtLibraryBatch(value)),
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
 * import does (whose line goes to the app log). A failed read leaves the
 * playlist empty, marks it failed and says so in the log.
 */
const fill = async (read: YtLibraryRead): Promise<void> => {
  let reason: string;
  try {
    // Every read stops at the cap for now: Liked Songs' uncapped read (`capped`) is #370's.
    const answer = await askYtMusic((ytMusic) => ytMusic.playlist(read.source));
    if (Result.isSuccess(answer)) {
      const plan = planLinkImport(
        { service: "ytMusic", playlist: answer.success },
        await listLibrary(),
      );
      // Read: the link import, kept on its own, gives it its songs from here.
      batch.set(ytLibraryReadDone(batch.get(), read.playlistId));
      await startLinkImport(plan, { playlistId: read.playlistId, name: read.name });
      return;
    }
    reason = answer.failure.reason;
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error);
  }
  appLog("warn", LOG_TAG, ytLibraryReadLogLine(read, reason));
  batch.set(ytLibraryReadFailed(batch.get(), read.playlistId));
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
  if (batch.get() === before && pruned.length !== before.length) batch.set(pruned);
};

/** Reads the waiting playlists one at a time, in order, until none is left. */
const readBatch = async (): Promise<void> => {
  if (reading) return;
  reading = true;
  try {
    for (;;) {
      await prune();
      const next = nextYtLibraryRead(batch.get());
      if (next === undefined) return;
      await fill(next);
    }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    appLog("warn", LOG_TAG, `The YouTube Music import's batch stopped: ${why}`);
  } finally {
    reading = false;
  }
};

/**
 * Import in the From YT Music picker: makes a playlist of each ticked row
 * now, in its order, each kept in the batch as it's made, then reads them in
 * the background. Resolves once the playlists exist.
 */
export const importYtLibrary = async (picker: YtLibraryPicker): Promise<void> => {
  const items = planYtLibraryImport(picker, await currentPlaylists());
  for (const item of items) {
    const created = await createPlaylist(item.name);
    batch.set(
      queueYtLibraryReads(batch.get(), [
        {
          source: item.playlistId,
          playlistId: created.playlistId,
          name: created.name,
          capped: true,
        },
      ]),
    );
  }
  void readBatch();
};

/**
 * Once Wave starts with all-files access: the playlists a batch hadn't read
 * when Android stopped Wave are read, in the same order. Safe to call
 * repeatedly.
 */
export const resumeYtLibraryImport = (): void => {
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
    await fill(view.read);
  } finally {
    readingAgain.set(new Set([...readingAgain.get()].filter((id) => id !== playlistId)));
  }
};
