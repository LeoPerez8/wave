import { catalogueOf, type AppLanguage } from "./localisation.ts";
import {
  ytDownloadsFromJournal,
  ytDownloadStatuses,
  type YtDownloadJournalJob,
  type YtDownloadStatus,
} from "./ytDownloads.ts";

/** Only the identity a list needs to count a song, including one already saved in its place. */
export type DownloadListMember =
  | { readonly kind: "song"; readonly videoId: string }
  | { readonly kind: "file"; readonly path: string };

/**
 * A journal song as album lists place it: the Library album whose own Download
 * asked for it, the YT Music albums it belongs to (the album whose Download
 * asked for it, the album it is on), and its file once saved.
 */
export interface ListDownloadAlbumSong {
  readonly videoId: string;
  readonly libraryAlbumId: number | null;
  readonly ytAlbumIds: readonly string[];
  readonly savedPath: string | null;
}

/** What a membership read needs of the index. */
export type ListDownloadsScope = Pick<ListDownloadsIndex, "videoIds" | "savedPaths"> &
  Partial<Pick<ListDownloadsIndex, "albumSongs">>;

/** Shared by page heads and listed playlists or albums. Failed songs stay in the denominator. */
export const listDownloadLine = (
  statuses: readonly (YtDownloadStatus | null)[],
  landed: number,
  language: AppLanguage,
): string | null => {
  let total = landed;
  let saved = landed;
  let active = false;
  for (const status of statuses) {
    if (status === null) continue;
    total++;
    if (status.kind === "done") saved++;
    if (status.kind === "queued" || status.kind === "downloading" || status.kind === "saving")
      active = true;
  }
  return active ? catalogueOf(language).downloads.progress(saved, total) : null;
};

/** One journal index, shared by all listed playlists and albums; no Library matching or action planning. */
export interface ListDownloadsIndex {
  readonly active: boolean;
  readonly videoIds: readonly string[];
  readonly savedPaths: readonly string[];
  readonly albumSongs: readonly ListDownloadAlbumSong[];
  readonly statusOf: (videoId: string) => YtDownloadStatus | null;
  readonly line: (members: readonly DownloadListMember[], language?: AppLanguage) => string | null;
}

/** Reuse [before] while the journal changes nothing a list's line can show. */
export const indexListDownloads = (
  jobs: readonly YtDownloadJournalJob[],
  before?: ListDownloadsIndex,
): ListDownloadsIndex => {
  const downloads = ytDownloadsFromJournal(jobs);
  const statusOf = ytDownloadStatuses(downloads);
  const videoIds = [
    ...new Set(
      downloads.jobs.flatMap(({ song, relatedSongs }) =>
        [song, ...(relatedSongs ?? [])].map(({ videoId }) => videoId),
      ),
    ),
  ];
  const savedPaths = [
    ...new Set(
      downloads.jobs.flatMap(({ status }) => (status.kind === "done" ? [status.path] : [])),
    ),
  ];
  if (
    before !== undefined &&
    videoIds.length === before.videoIds.length &&
    savedPaths.length === before.savedPaths.length &&
    videoIds.every(
      (id, i) => id === before.videoIds[i] && sameCountedStatus(statusOf(id), before.statusOf(id)),
    ) &&
    savedPaths.every((path, i) => path === before.savedPaths[i])
  )
    return before;
  const paths = new Set(savedPaths);
  return {
    statusOf,
    active: downloads.jobs.some(
      ({ status }) =>
        status.kind === "queued" || status.kind === "downloading" || status.kind === "saving",
    ),
    videoIds,
    savedPaths,
    albumSongs: jobs.flatMap((job) =>
      job.phase === "cancelled" ? [] : [albumSong(job, statusOf(job.song.videoId))],
    ),
    line: (members: readonly DownloadListMember[], language: AppLanguage = "en"): string | null => {
      let landed = 0;
      const statuses: (YtDownloadStatus | null)[] = [];
      for (const member of members) {
        if (member.kind === "song") statuses.push(statusOf(member.videoId));
        else if (paths.has(member.path)) landed++;
      }
      return listDownloadLine(statuses, landed, language);
    },
  };
};

/** A Library album's id is a number; a YT Music album's browse id never is. */
const LIBRARY_ALBUM_ID = /^\d+$/u;

const albumSong = (
  job: YtDownloadJournalJob,
  status: YtDownloadStatus | null,
): ListDownloadAlbumSong => {
  const asked = job.origin?.kind === "album" ? job.origin.id : null;
  const libraryAlbumId = asked !== null && LIBRARY_ALBUM_ID.test(asked) ? Number(asked) : null;
  // The app's songs carry their album's browse id; Core's `YtSong` doesn't name it.
  const on = (job.song as { readonly albumId?: unknown }).albumId;
  const ytAlbumIds = [libraryAlbumId === null ? asked : null, on].filter(
    (id): id is string => typeof id === "string" && id !== "",
  );
  return {
    videoId: job.song.videoId,
    libraryAlbumId,
    ytAlbumIds: [...new Set(ytAlbumIds)],
    savedPath: status?.kind === "done" ? status.path : null,
  };
};

/**
 * The journal's songs by Library album id, for `ListDownloadsIndex.line`. A
 * song is its album's when that album's Download asked for it or its file was
 * saved there; a YT Music album's other songs follow the first one saved, since
 * only then does the Library have an album to list. [albumOfPath] is the
 * Library album holding a saved file.
 */
export const albumDownloadMembers = (
  songs: readonly ListDownloadAlbumSong[],
  albumOfPath: (path: string) => number | null,
): Map<number, DownloadListMember[]> => {
  const own = songs.map((song) => {
    const saved = song.savedPath === null ? null : albumOfPath(song.savedPath);
    return [song.libraryAlbumId, saved].filter((id): id is number => id !== null);
  });
  const linked = new Map<string, Set<number>>();
  songs.forEach((song, i) => {
    for (const ytAlbumId of song.ytAlbumIds) {
      const albums = linked.get(ytAlbumId) ?? new Set<number>();
      for (const id of own[i] ?? []) albums.add(id);
      linked.set(ytAlbumId, albums);
    }
  });
  const result = new Map<number, DownloadListMember[]>();
  songs.forEach((song, i) => {
    const albums = new Set(own[i]);
    for (const ytAlbumId of song.ytAlbumIds)
      for (const id of linked.get(ytAlbumId) ?? []) albums.add(id);
    for (const id of albums) {
      const members = result.get(id) ?? [];
      members.push({ kind: "song", videoId: song.videoId });
      result.set(id, members);
    }
  });
  return result;
};

/** Byte counts, queue positions and the steps before publication cannot change a list's count. */
const sameCountedStatus = (a: YtDownloadStatus | null, b: YtDownloadStatus | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.kind === "done" || b.kind === "done")
    return a.kind === "done" && b.kind === "done" && a.path === b.path;
  return (a.kind === "failed") === (b.kind === "failed");
};
