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

/** Byte counts, queue positions and the steps before publication cannot change a list's count. */
const sameCountedStatus = (a: YtDownloadStatus | null, b: YtDownloadStatus | null): boolean => {
  if (a === null || b === null) return a === b;
  if (a.kind === "done" || b.kind === "done")
    return a.kind === "done" && b.kind === "done" && a.path === b.path;
  return (a.kind === "failed") === (b.kind === "failed");
};
