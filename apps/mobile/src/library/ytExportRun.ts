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
 * An Export pressed while another runs goes after it; a playlist queued in
 * any export keeps a line until the last one sends it.
 */
import {
  addExportedPlaylist,
  addYtLikes,
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
import {
  likeFavoritesOnYtMusic,
  matchOnYtMusic,
  ytMusicFailureMessage,
  ytMusicPlaylists,
} from "@/share/ytSharedPlaylists";

import { FAVORITES_EXPORT_ID, endExportProgress, showExportProgress } from "./importProgress";

const LOG_TAG = "WaveExport";

/** Where [item]'s line is kept on the export board. */
const progressId = (item: YtExportItem): number =>
  item.kind === "favorites" ? FAVORITES_EXPORT_ID : item.playlistId;

/** How many exports, pending or running, still have to send each item, by its progress id. */
const queued = new Map<number, number>();

/** The item being sent now, by its progress id; its line counts its songs. */
let sending: number | null = null;

/**
 * One export no longer has to send [id]: its line goes once no export
 * still has it queued, else it says Waiting to export again.
 */
const dequeue = (id: number): void => {
  const left = (queued.get(id) ?? 1) - 1;
  if (left > 0) {
    queued.set(id, left);
    showExportProgress(id, EXPORT_WAITING_PROGRESS);
  } else {
    queued.delete(id);
    endExportProgress(id);
  }
};

/**
 * Sends [item], its line counting its songs, then takes it off this
 * export's queue. Favorites are liked; a playlist's songs are matched, then
 * its playlist there made private or updated, unless no song was found, as
 * Share makes nothing then. Its songs; null for a playlist deleted
 * meanwhile. Rejects when a request or a search does.
 */
const send = async (item: YtExportItem): Promise<SharedSongs | null> => {
  const id = progressId(item);
  const progress = (done: number, total: number) =>
    showExportProgress(id, exportingProgress(done, total));
  sending = id;
  try {
    if (item.kind === "favorites") return await likeFavoritesOnYtMusic(progress);
    const matched = await matchOnYtMusic(item.playlistId, progress);
    if (matched === null) return null;
    if (matched.songs.ids.length > 0)
      await syncSharedPlaylist(
        ytMusicPlaylists(item.playlistId, "export"),
        matched.name,
        matched.songs.ids,
      );
    return matched.songs;
  } finally {
    sending = null;
    dequeue(id);
  }
};

/** The app log's line for an export that sent [summary], without names. */
const logLine = ({ playlists, found, total, liked }: YtExportSummary, stopped: boolean): string =>
  `${stopped ? "Export to YT Music stopped after" : "Exported"} ${playlists} playlists, ${found} of ${total} songs found${liked === null ? "" : `, ${liked} liked`}`;

/** Sends [items] one after another, then says how it went. */
const sendAll = async (items: readonly YtExportItem[]): Promise<void> => {
  let summary = NO_YT_EXPORT;
  let started = 0;
  try {
    for (const item of items) {
      started += 1;
      const songs = await send(item);
      if (songs === null) continue;
      summary =
        item.kind === "favorites"
          ? addYtLikes(summary, songs)
          : addExportedPlaylist(summary, songs);
    }
  } catch (error) {
    for (const item of items.slice(started)) dequeue(progressId(item));
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
 * account in the background: each says Waiting to export at once (one being
 * sent keeps counting its songs, and waits again once sent), and they go
 * after any export still running.
 */
export const exportToYtMusic = (items: readonly YtExportItem[]): Promise<void> => {
  for (const item of items) {
    const id = progressId(item);
    queued.set(id, (queued.get(id) ?? 0) + 1);
    if (sending !== id) showExportProgress(id, EXPORT_WAITING_PROGRESS);
  }
  const run = running.then(() => sendAll(items));
  running = run.catch(() => {});
  return run;
};
