/** Listening History as the window sees it (`window.wave.history`). */
import type { ListeningHistoryFrom, ListeningHistoryPageOf } from "@wave/core";
import type { Invoke } from "./bridge.ts";
import type { BrowseRow } from "./browse.ts";

/** One counted play. Its `id` is the play's, not its song's. */
export interface HistoryRow {
  readonly id: number;
  readonly startedAt: number;
  /** The song as the row shows it: the title and artists it was played as. Dimmed when `unavailable`. */
  readonly song: BrowseRow;
  /** What a double click plays: its Library song, its stream, or nothing. */
  readonly replays: "library" | "stream" | null;
}

export type HistoryPage = ListeningHistoryPageOf<HistoryRow>;

export interface HistoryRoute {
  readonly kind: "history";
  /** The play Go to This Moment opened the history at. */
  readonly at?: number;
}

export interface HistoryContract {
  /** A page of [query]'s plays (every play with no text): the newest, older, newer or around a play. */
  readonly "history.page": {
    readonly args: readonly [from: ListeningHistoryFrom, query: string];
    readonly result: HistoryPage;
  };
  /** Plays the song of the play [playId] alone, as its row replays it now. */
  readonly "history.play": {
    readonly args: readonly [playId: number];
    readonly result: void;
  };
}

export const HISTORY_CALLS = ["history.page", "history.play"] as const;

export const historyBridge = (invoke: Invoke) => ({
  page: (from: ListeningHistoryFrom, query: string) => invoke("history.page", from, query),
  play: (playId: number) => invoke("history.play", playId),
});
