/**
 * The line at the top of Library › Playlists while a batch of playlists
 * imports, From YT Music or From Spotify (docs/spec.md, "Importing playlists
 * from a link", Progress): "Importing playlists · 12 of 80", or "Import
 * paused · offline" while the batch waits for its reason to go.
 *
 * It counts the batch's run (`YtLibraryBatch.run`): a playlist is left while
 * it waits to be read, or once read while its songs are matched and added
 * (its entry on the progress board). One whose read failed counts as done,
 * as does one deleted meanwhile: its own page carries Try Again. A From a
 * Link import never joins the batch, so it shows no line.
 */

import type { ImportProgressBoard } from "./importProgress.ts";
import {
  nextYtLibraryRead,
  type YtLibraryBatch,
  type YtLibraryPauseReason,
} from "./ytLibraryBatch.ts";

/** What the line says, and the counts it says it from. */
export interface ImportBatchLine {
  readonly text: string;
  /** Playlists of the run done, of [total]. */
  readonly done: number;
  readonly total: number;
  /** Whether the batch is paused: the line has no spinner. */
  readonly paused: boolean;
}

/** A pause's reason as the line words it. */
const PAUSE_WORDS: Readonly<Record<YtLibraryPauseReason, string>> = {
  offline: "offline",
  disabled: "YT Music off",
  signedOut: "signed out of Spotify",
};

/** A count as the line shows it ("1,200"). */
const number = (count: number): string => count.toLocaleString("en");

/**
 * The line for [batch] with the playlists importing past waiting on
 * [board], or null while none of its run is left. [pausedBy] is the reason
 * the batch last paused for (`ytLibraryReadFailed`), or null once it goes
 * on; it shows only while a playlist still waits.
 */
export const importBatchLine = (
  batch: YtLibraryBatch,
  board: ImportProgressBoard,
  pausedBy: YtLibraryPauseReason | null,
): ImportBatchLine | null => {
  if (batch.run.length === 0) return null;
  const states = new Map(batch.reads.map((read) => [read.playlistId, read.state]));
  const left = batch.run.filter((id) => {
    const state = states.get(id);
    if (state === "waiting") return true;
    return state !== "failed" && board.has(id);
  }).length;
  if (left === 0) return null;
  const total = batch.run.length;
  const done = total - left;
  if (pausedBy !== null && nextYtLibraryRead(batch) !== undefined) {
    return {
      text: `Import paused · ${PAUSE_WORDS[pausedBy]}`,
      done,
      total,
      paused: true,
    };
  }
  return {
    text: `Importing playlists · ${number(done)} of ${number(total)}`,
    done,
    total,
    paused: false,
  };
};
