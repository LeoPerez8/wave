/**
 * Settings › Downloads › Downloading, grouped: the songs downloading now on
 * top, then the waiting ones in one group per source, the playlist, album or
 * Discover mix whose Download asked for them (a job's `origin`). Songs asked
 * for on their own, and jobs queued before downloads remembered where they
 * came from, wait under Songs.
 */

import { moveItem } from "./playlists.ts";
import { queuedDownloads, type QueuedDownload } from "./queuedDownloads.ts";
import type { YtSong } from "./ytMusic.ts";
import type { YtDownloadJournalJob } from "./ytDownloads.ts";

/**
 * Where a download was asked from: the playlist, album or Discover mix whose
 * Download queued it, or Favorites for a song only its star asked for
 * (`FAVORITES_DOWNLOAD_ORIGIN`), with the name its group shows. The journal keeps it on
 * the job, so it survives a restart; a song a second source asks for keeps
 * the first one's.
 */
export interface DownloadOrigin {
  readonly kind: "playlist" | "album" | "mix" | "favorites";
  /** The source's own id: a Library playlist's or album's id, a YT Music browse id, a mix's id ("favorites" for Favorites). */
  readonly id: string;
  readonly name: string;
}

/**
 * A Library playlist as the source of its songs' downloads, the same from its
 * page, its menu and a YT Music import, so they group together.
 */
export const playlistDownloadOrigin = (playlist: {
  readonly id: number;
  readonly name: string;
}): DownloadOrigin => ({ kind: "playlist", id: String(playlist.id), name: playlist.name });

/** A Library album as the source of its songs' downloads (its page, its missing songs). */
export const albumDownloadOrigin = (album: {
  readonly id: number;
  readonly title: string;
}): DownloadOrigin => ({ kind: "album", id: String(album.id), name: album.title });

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

/**
 * The waiting jobs in their new order once the group at [from] in [list]'s
 * groups is dragged to [to] (both 0-based): every group's waiting songs, group
 * after group as the list then shows them, for the journal's move
 * (`moveQueuedJobs`). The moved group's songs keep their order inside it.
 */
export const moveDownloadGroup = (
  list: DownloadingList,
  from: number,
  to: number,
): readonly string[] =>
  moveItem(list.groups, from, to).flatMap((group) => group.queued.map((queued) => queued.id));

/**
 * What the journal's move does to its [jobs]: the waiting jobs named in
 * [order] take the places those same jobs held, in [order]'s order, so they
 * start in that order. Every other job keeps its place, and so does a job
 * [order] names that is no longer waiting (it started meanwhile). Native's
 * `DurableDownloads.moveQueued` does the same to the journal it keeps.
 */
export const moveQueuedJobs = <J extends Pick<YtDownloadJournalJob, "id" | "phase">>(
  jobs: readonly J[],
  order: readonly string[],
): J[] => {
  const named = new Set(order);
  const moving = new Map(
    jobs.filter((job) => job.phase === "queued" && named.has(job.id)).map((job) => [job.id, job]),
  );
  const next = [...order].flatMap((id) => {
    const job = moving.get(id);
    moving.delete(id);
    return job === undefined ? [] : [job];
  });
  let place = 0;
  return jobs.map((job) =>
    job.phase === "queued" && named.has(job.id) ? (next[place++] ?? job) : job,
  );
};

/**
 * [group]'s waiting songs in their new order once the one at [from] is
 * dragged to [to] (both 0-based, among its waiting songs), for the journal's
 * move (`moveQueuedJobs`). A song stays in its group: a drop past either end
 * lands it first or last there, and the other groups' songs keep their places.
 */
export const moveDownloadInGroup = (
  group: DownloadGroup,
  from: number,
  to: number,
): readonly string[] => moveItem(group.queued, from, to).map((queued) => queued.id);
