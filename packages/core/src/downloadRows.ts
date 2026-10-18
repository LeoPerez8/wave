import type { DownloadGroup, DownloadingList } from "./downloadGroups.ts";
import { moveDownloadGroup, moveDownloadInGroup } from "./downloadGroups.ts";
import type { QueuedDownload } from "./queuedDownloads.ts";
import type { YtSong } from "./ytMusic.ts";

/**
 * Settings › Downloads' Downloading section as the rows of one virtualized
 * list (only the rows around the screen are mounted, whatever the queue's
 * size): the songs downloading now, then each group's header followed by its
 * waiting songs. And what dragging them drops.
 */

/** A song downloading (or saving) now. */
export interface DownloadingSongRow<S extends YtSong = YtSong> {
  readonly kind: "downloading";
  /** Stable across journal changes, unique among the list's rows. */
  readonly key: string;
  readonly queued: QueuedDownload<S>;
}

/** The header of a group whose songs have all started: nothing to drag, no Move up / Move down. */
export interface StartedHeaderRow<S extends YtSong = YtSong> {
  readonly kind: "startedHeader";
  readonly key: string;
  readonly group: DownloadGroup<S>;
}

/** The header of a group with waiting songs, which drags among the others ([movableGroups]). */
export interface DownloadHeaderRow<S extends YtSong = YtSong> {
  readonly kind: "header";
  readonly key: string;
  readonly group: DownloadGroup<S>;
  /** Its place among the groups that move, and how many there are. */
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
  /** Its group's place among the groups that move: it steps aside with its group. */
  readonly groupIndex: number;
  /** Its place among its group's waiting songs, and how many there are. */
  readonly index: number;
  readonly count: number;
}

export type DownloadListRow<S extends YtSong = YtSong> =
  DownloadingSongRow<S> | StartedHeaderRow<S> | DownloadHeaderRow<S> | WaitingSongRow<S>;

/** The groups that drag among themselves: those with waiting songs, in order. */
export const movableGroups = <S extends YtSong>(
  list: DownloadingList<S>,
): readonly DownloadGroup<S>[] => list.groups.filter((group) => group.queued.length > 0);

/** [list] (Core's `downloadingList`) as the virtualized list's rows, in order. */
export const downloadListRows = <S extends YtSong>(
  list: DownloadingList<S>,
): readonly DownloadListRow<S>[] => {
  const rows: DownloadListRow<S>[] = list.downloading.map((queued) => ({
    kind: "downloading",
    key: `downloading:${queued.id}`,
    queued,
  }));
  const count = movableGroups(list).length;
  let place = 0;
  for (const group of list.groups) {
    const key = `group:${group.key}`;
    if (group.queued.length === 0) {
      rows.push({ kind: "startedHeader", key, group });
      continue;
    }
    const groupIndex = place++;
    rows.push({ kind: "header", key, group, index: groupIndex, count });
    group.queued.forEach((queued, index) => {
      rows.push({
        kind: "waiting",
        key: `waiting:${queued.id}`,
        queued,
        groupKey: group.key,
        groupIndex,
        index,
        count: group.queued.length,
      });
    });
  }
  return rows;
};

/**
 * What a drag dropped (or a Move up / Move down asked for): a waiting song
 * onto the place of another of its group's ([from], [to]: job ids), or a group
 * onto another's ([from], [to]: group keys).
 */
export type DownloadDrop =
  | {
      readonly kind: "song";
      readonly groupKey: string;
      readonly from: string;
      readonly to: string;
    }
  | { readonly kind: "group"; readonly from: string; readonly to: string };

/**
 * The waiting order [drop] asks for, on [list] as it is now (the journal may
 * have changed under the drag): the jobs in their new order (Core's
 * `moveDownloadInGroup`, `moveDownloadGroup`), or null when nothing moves (it
 * landed where it was, or what it names isn't waiting or moving any more).
 */
export const dropDownload = (
  list: DownloadingList,
  drop: DownloadDrop,
): readonly string[] | null => {
  if (drop.from === drop.to) return null;
  if (drop.kind === "song") {
    const group = list.groups.find((each) => each.key === drop.groupKey);
    const ids = group?.queued.map((queued) => queued.id) ?? [];
    const [from, to] = [ids.indexOf(drop.from), ids.indexOf(drop.to)];
    return group === undefined || from < 0 || to < 0 ? null : moveDownloadInGroup(group, from, to);
  }
  const groups = movableGroups(list);
  const keys = groups.map((group) => group.key);
  const [from, to] = [keys.indexOf(drop.from), keys.indexOf(drop.to)];
  return from < 0 || to < 0
    ? null
    : moveDownloadGroup({ downloading: list.downloading, groups }, from, to);
};
