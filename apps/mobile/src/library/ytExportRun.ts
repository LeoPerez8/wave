/**
 * Export to YT Music's run (docs/spec.md, "Exporting to YT Music"): the
 * playlists the picker ticked (Core's `planYtExport`) go to the signed-in
 * YouTube Music account one at a time, in the background, each as Share
 * sends a playlist (`ytSharedPlaylists.ts`): its songs matched there, then
 * a private playlist made, or the one made for it before (by Share or an
 * earlier export, `share.ytMusic.<playlist id>`) brought up to date without
 * changing who sees it. Each shows Waiting to export, then Exporting N of M,
 * on its row and its page (`showExportProgress`); a toast sums it up at the
 * end (Core's `ytExportSummaryLine`). An expired session or a search without
 * an answer stops it with Share's message; the playlists sent so far stay.
 * Nothing is kept for resuming: exporting again updates the same playlists.
 * An Export pressed while another runs goes after it.
 */
import {
  addYtExported,
  EXPORT_WAITING_PROGRESS,
  exportingProgress,
  NO_YT_EXPORT,
  syncSharedPlaylist,
  ytExportSummaryLine,
  type SharedSongs,
  type YtExportItem,
  type YtExportSummary,
} from "@wave/core";

import { currentLocalisation } from "@/localisation/localisation";
import { appLog } from "@/log/appLog";
import { showError } from "@/overlay/alert";
import { showToast } from "@/overlay/toast";
import { matchOnYtMusic, ytMusicFailureMessage, ytMusicPlaylists } from "@/share/ytSharedPlaylists";

import { endExportProgress, showExportProgress } from "./importProgress";

const LOG_TAG = "WaveExport";

/**
 * Sends the Wave playlist [item] to YT Music: its songs matched, then its
 * playlist there made private or updated. Its songs; null when it was
 * deleted meanwhile. Rejects when a request or a search does.
 */
const sendPlaylist = async ({ playlistId }: YtExportItem): Promise<SharedSongs | null> => {
  try {
    const matched = await matchOnYtMusic(playlistId, (done, total) =>
      showExportProgress(playlistId, exportingProgress(done, total)),
    );
    if (matched === null) return null;
    await syncSharedPlaylist(
      ytMusicPlaylists(playlistId, "export"),
      matched.name,
      matched.songs.ids,
    );
    return matched.songs;
  } finally {
    endExportProgress(playlistId);
  }
};

/** The app log's line for an export that sent [summary], without names. */
const logLine = ({ playlists, found, total }: YtExportSummary, stopped: boolean): string =>
  `${stopped ? "Export to YT Music stopped after" : "Exported"} ${playlists} playlists, ${found} of ${total} songs found`;

/** Sends [items] one after another, then says how it went. */
const sendAll = async (items: readonly YtExportItem[]): Promise<void> => {
  let summary = NO_YT_EXPORT;
  try {
    for (const item of items) {
      const songs = await sendPlaylist(item);
      if (songs !== null) summary = addYtExported(summary, songs);
    }
  } catch (error) {
    for (const item of items) endExportProgress(item.playlistId);
    appLog("warn", LOG_TAG, logLine(summary, true));
    const { strings } = currentLocalisation();
    await showError(strings.imports.couldntExport, new Error(ytMusicFailureMessage(error)));
    return;
  }
  appLog("info", LOG_TAG, logLine(summary, false));
  void showToast(ytExportSummaryLine(summary, currentLocalisation().language));
};

/** The export running now, which the next one waits for. */
let running: Promise<void> = Promise.resolve();

/**
 * Exports [items] (Core's `planYtExport`) to the signed-in YouTube Music
 * account in the background: each says Waiting to export at once, and they
 * go after any export still running.
 */
export const exportToYtMusic = (items: readonly YtExportItem[]): Promise<void> => {
  for (const item of items) showExportProgress(item.playlistId, EXPORT_WAITING_PROGRESS);
  const run = running.then(() => sendAll(items));
  running = run.catch(() => {});
  return run;
};
