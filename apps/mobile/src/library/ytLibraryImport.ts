/**
 * From YT Music's Import (docs/spec.md, "Importing playlists from a link"):
 * each ticked playlist becomes a Wave playlist at once, empty and named by
 * Core (`planYtLibraryImport`: Keep Both's name on a clash, without asking).
 * Wave then reads them one at a time, in the picker's order, and fills each
 * as a YouTube Music link import does (`readYtPlaylist`, `planLinkImport`,
 * `finishPlaylistImport`), Liked Songs whole and the others up to the cap. Nothing is downloaded or searched; there's no
 * notification and no service. The batch lives while Wave runs.
 */
import { planLinkImport, planYtLibraryImport, type YtLibraryPicker } from "@wave/core";
import * as Result from "effect/Result";

import { appLog } from "@/log/appLog";
import { askYtMusic } from "@/ytmusic/askYtMusic";

import { listLibrary } from "./importPlaylistLink";
import { startLinkImport } from "./playlistImports";
import { createPlaylist, currentPlaylists } from "./playlists";

const LOG_TAG = "WaveImport";

/** A playlist Import made, waiting to be read from YouTube Music. */
interface Queued {
  /** The YouTube Music playlist, without `VL`. */
  readonly source: string;
  readonly playlistId: number;
  readonly name: string;
  /** Read past the song cap (Liked Songs). */
  readonly uncapped: boolean;
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
    const answer = await askYtMusic((ytMusic) =>
      ytMusic.playlist(queued.source, { uncapped: queued.uncapped }),
    );
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
 * Import in the From YT Music picker: makes a playlist of each ticked row
 * now, in its order, then reads them in the background. Resolves once the
 * playlists exist.
 */
export const importYtLibrary = async (picker: YtLibraryPicker): Promise<void> => {
  const items = planYtLibraryImport(picker, await currentPlaylists());
  const queued: Queued[] = [];
  for (const item of items) {
    const created = await createPlaylist(item.name);
    queued.push({
      source: item.playlistId,
      playlistId: created.playlistId,
      name: created.name,
      uncapped: item.uncapped,
    });
  }
  reading = reading.then(async () => {
    for (const next of queued) await fill(next);
  });
};
