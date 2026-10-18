/**
 * Settings › Downloads › Downloading, grouped: the songs downloading now on
 * top, then the waiting ones in one group per source, the playlist, album or
 * Discover mix whose Download asked for them (a job's `origin`). Songs asked
 * for on their own, and jobs queued before downloads remembered where they
 * came from, wait under Songs.
 */

import { queuedDownloads, type QueuedDownload } from "./queuedDownloads.ts";
import type { YtSong } from "./ytMusic.ts";
import type { YtDownloadJournalJob } from "./ytDownloads.ts";

/**
 * Where a download was asked from: the playlist, album or Discover mix whose
 * Download queued it, with the name its group shows. The journal keeps it on
 * the job, so it survives a restart; a song a second source asks for keeps
 * the first one's.
 */
export interface DownloadOrigin {
  readonly kind: "playlist" | "album" | "mix";
  /** The source's own id: a Library playlist's or album's id, a YT Music browse id, a mix's id. */
  readonly id: string;
  readonly name: string;
}

/** One source's songs on their way, under a header with its name and how many are left. */
export interface DownloadGroup<S extends YtSong = YtSong> {
  /** Stable across renames: what the source is, not what it's called. */
  readonly key: string;
  /** Null for Songs. */
  readonly origin: DownloadOrigin | null;
  readonly name: string;
  /** Its songs on their way, the ones downloading now included. */
  readonly left: number;
  /** The header's count: "12 songs left". */
  readonly line: string;
  /** Its waiting songs, in queue order. */
  readonly queued: readonly QueuedDownload<S>[];
}

/** The Downloading list: the songs downloading now, then the waiting ones by source. */
export interface DownloadingList<S extends YtSong = YtSong> {
  readonly downloading: readonly QueuedDownload<S>[];
  readonly groups: readonly DownloadGroup<S>[];
}

/** The group songs asked for on their own wait in. */
export const SONGS_GROUP_NAME = "Songs";

const keyOf = (origin: DownloadOrigin | null): string =>
  origin === null ? "songs" : `${origin.kind}:${origin.id}`;

const songsLeft = (count: number): string =>
  `${count.toLocaleString("en")} ${count === 1 ? "song" : "songs"} left`;

interface Building<S extends YtSong> {
  readonly origin: DownloadOrigin | null;
  /** Where its first song on its way is in the journal, and its first waiting song. */
  readonly first: number;
  next: number | null;
  left: number;
  readonly queued: QueuedDownload<S>[];
}

/**
 * The Downloading list from the journal's [jobs] (in the order its queue
 * starts them). Groups come in queue order: the one whose next waiting song
 * starts soonest first; a group whose songs are all downloading already comes
 * before them. A group lasts while any of its songs is on its way.
 */
export const downloadingList = <S extends YtSong>(
  jobs: readonly YtDownloadJournalJob<S>[],
): DownloadingList<S> => {
  const rows = queuedDownloads(jobs);
  const place = new Map(jobs.map((job, index) => [job.id, index]));
  const originOf = new Map(jobs.map((job) => [job.id, job.origin ?? null]));
  const groups = new Map<string, Building<S>>();
  for (const row of rows) {
    const origin = originOf.get(row.id) ?? null;
    const index = place.get(row.id) ?? 0;
    const key = keyOf(origin);
    let group = groups.get(key);
    if (group === undefined) {
      group = { origin, first: index, next: null, left: 0, queued: [] };
      groups.set(key, group);
    }
    group.left += 1;
    if (row.waiting) {
      group.queued.push(row);
      if (group.next === null || index < group.next) group.next = index;
    }
  }
  const order = (group: Building<S>): number => group.next ?? -1;
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  const sorted = [...groups.entries()].sort(
    ([, a], [, b]) => order(a) - order(b) || a.first - b.first,
  );
  return {
    downloading: rows.filter((row) => !row.waiting),
    groups: sorted.map(([key, group]) => ({
      key,
      origin: group.origin,
      name: group.origin?.name ?? SONGS_GROUP_NAME,
      left: group.left,
      line: songsLeft(group.left),
      queued: group.queued,
    })),
  };
};
