import type { DownloadGroup, DownloadingList } from "./downloadGroups.ts";
import type { QueuedDownload } from "./queuedDownloads.ts";
import type { YtSong } from "./ytMusic.ts";

/**
 * Settings › Downloads' Downloading section as the rows of one virtualized
 * list (only the rows around the screen are mounted, whatever the queue's
 * size): the songs downloading now, then each group's header followed by its
 * waiting songs.
 */

/** A song downloading (or saving) now. */
export interface DownloadingSongRow<S extends YtSong = YtSong> {
  readonly kind: "downloading";
  /** Stable across journal changes, unique among the list's rows. */
  readonly key: string;
  readonly queued: QueuedDownload<S>;
}

/** A group's header. */
export interface DownloadHeaderRow<S extends YtSong = YtSong> {
  readonly kind: "header";
  readonly key: string;
  readonly group: DownloadGroup<S>;
  /**
   * Its place among the groups that have waiting songs, which drag among
   * themselves, and how many there are; -1 of 0 for a group whose songs have
   * all started (nothing to drag, no Move up / Move down).
   */
  readonly index: number;
  readonly count: number;
}

/** A waiting song, under its group's header. */
export interface WaitingSongRow<S extends YtSong = YtSong> {
  readonly kind: "waiting";
  readonly key: string;
  readonly queued: QueuedDownload<S>;
  /** Its group's key: it drags among that group's songs only. */
  readonly groupKey: string;
  /** Its place among its group's waiting songs, and how many there are. */
  readonly index: number;
  readonly count: number;
}

export type DownloadListRow<S extends YtSong = YtSong> =
  DownloadingSongRow<S> | DownloadHeaderRow<S> | WaitingSongRow<S>;

/** [list] (Core's `downloadingList`) as the virtualized list's rows, in order. */
export const downloadListRows = <S extends YtSong>(
  list: DownloadingList<S>,
): readonly DownloadListRow<S>[] => {
  const rows: DownloadListRow<S>[] = list.downloading.map((queued) => ({
    kind: "downloading",
    key: `downloading:${queued.id}`,
    queued,
  }));
  const movable = list.groups.filter((group) => group.queued.length > 0).length;
  let place = 0;
  for (const group of list.groups) {
    const moves = group.queued.length > 0;
    rows.push({
      kind: "header",
      key: `group:${group.key}`,
      group,
      index: moves ? place : -1,
      count: moves ? movable : 0,
    });
    if (moves) place += 1;
    group.queued.forEach((queued, index) => {
      rows.push({
        kind: "waiting",
        key: `waiting:${queued.id}`,
        queued,
        groupKey: group.key,
        index,
        count: group.queued.length,
      });
    });
  }
  return rows;
};

export interface DownloadGroupDrag {
  /** The dragged group's place among the groups that move. */
  readonly from: number;
  /**
   * Where its lifted header's middle is now, in dp down from the first
   * group's top, as the groups lie while it's dragged (they don't step aside).
   */
  readonly at: number;
  /** Each group's height, header and waiting songs, in order. */
  readonly heights: readonly number[];
}

/**
 * Where a group dragged by its header would land if dropped now: at the edge
 * between two groups (or either end) nearest its lifted header's middle.
 * `to` is the place it takes among the groups; `edge` is where the line that
 * shows it sits, in dp down from the first group's top. A whole group can be
 * hundreds of rows tall, more than a virtualized list mounts, so the groups
 * don't step aside for it: the line shows where it goes instead.
 */
export const downloadGroupDrop = ({
  from,
  at,
  heights,
}: DownloadGroupDrag): { readonly to: number; readonly edge: number } => {
  let nearest = 0;
  let edge = 0;
  let top = 0;
  for (let index = 0; index <= heights.length; index++) {
    if (Math.abs(top - at) < Math.abs(edge - at)) {
      nearest = index;
      edge = top;
    }
    top += heights[index] ?? 0;
  }
  // The edges on either side of the dragged group both leave it where it is.
  return { to: nearest > from ? nearest - 1 : nearest, edge };
};
