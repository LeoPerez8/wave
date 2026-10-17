/**
 * From YT Music's Import (docs/spec.md, "Importing playlists from a link"):
 * each ticked playlist becomes a Wave playlist at once, empty and named by
 * Core (`planYtLibraryImport`: Keep Both's name on a clash, without asking).
 * Wave then reads them one at a time, in the picker's order, and fills each
 * as a YouTube Music link import does (`readYtPlaylist`, `planLinkImport`,
 * `finishPlaylistImport`). Nothing is downloaded or searched; there's no
 * notification and no service. The batch lives while Wave runs.
 *
 * Each playlist's origin (the YouTube Music playlist it came from) is kept
 * on this phone, unsynced: the picker marks those rows Imported, and ticking
 * one refreshes that playlist as Replace does. Deleting it forgets it.
 */
import {
  liveYtLibraryOrigins,
  planLinkImport,
  planYtLibraryImport,
  readYtLibraryOrigins,
  writeYtLibraryOrigins,
  type YtLibraryOrigins,
  type YtLibraryPicker,
} from "@wave/core";
import * as Result from "effect/Result";

import { persistedSetting } from "@/lib/persistedSetting";
import { appLog } from "@/log/appLog";
import { askYtMusic } from "@/ytmusic/askYtMusic";

import { listLibrary } from "./importPlaylistLink";
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

/** A playlist Import made, waiting to be read from YouTube Music. */
interface Queued {
  /** The YouTube Music playlist, without `VL`. */
  readonly source: string;
  readonly playlistId: number;
  readonly name: string;
}

/** The reads still to come, one after another across batches. */
let reading: Promise<void> = Promise.resolve();

/**
 * Reads [queued]'s playlist and gives its Wave playlist the songs, as a link
 * import does; the import's line goes to the app log. A failed read leaves
 * the playlist empty and says so in the log.
 */
const fill = async (queued: Queued): Promise<void> => {
  try {
    const answer = await askYtMusic((ytMusic) => ytMusic.playlist(queued.source));
    if (Result.isFailure(answer)) {
      appLog(
        "warn",
        LOG_TAG,
        `Import of "${queued.name}" from YouTube Music couldn't read the playlist (${answer.failure.reason}); it stays empty`,
      );
      return;
    }
    const plan = planLinkImport(
      { service: "ytMusic", playlist: answer.success },
      await listLibrary(),
    );
    await startLinkImport(plan, { playlistId: queued.playlistId, name: queued.name });
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error);
    appLog("warn", LOG_TAG, `Import of "${queued.name}" from YouTube Music failed: ${why}`);
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
 * now, in its order, or empties the one an earlier import made, then reads
 * them in the background. Resolves once the playlists exist.
 */
export const importYtLibrary = async (picker: YtLibraryPicker): Promise<void> => {
  const items = planYtLibraryImport(picker, await currentPlaylists());
  const queued: Queued[] = [];
  for (const item of items) {
    const made =
      item.replaces === null
        ? await createPlaylist(item.name)
        : await emptyPlaylist(item.replaces, item.name);
    queued.push({ source: item.playlistId, playlistId: made.playlistId, name: made.name });
    origins.set(new Map(origins.get()).set(item.playlistId, made.playlistId));
  }
  reading = reading.then(async () => {
    for (const next of queued) await fill(next);
  });
};
