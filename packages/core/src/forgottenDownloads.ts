import { missingSongTrackId } from "./missingSongDownload.ts";
import { ytDownloadsFromJournal, type YtDownloadJournalJob } from "./ytDownloads.ts";
import { libraryFinder, type LibrarySongKey } from "./ytMusic.ts";

interface DownloadedLibrarySong extends LibrarySongKey {
  readonly id: number;
  readonly path: string | null;
}

/**
 * Finished downloads whose files are no longer in the Library. A moved song
 * keeps its status through the Library's recording match; a missing song has
 * no file. Null means the Library hasn't been read yet.
 */
export const ytDownloadsToForget = (
  jobs: readonly YtDownloadJournalJob[],
  library: readonly DownloadedLibrarySong[] | null,
): string[] => {
  if (library === null) return [];
  const files = library.filter((song) => song.path !== null);
  const paths = new Set(files.map((song) => song.path));
  const trackIds = new Set(files.map((song) => song.id));
  const find = libraryFinder(files);
  return jobs
    .filter((job) => {
      const status = ytDownloadsFromJournal([job]).jobs[0]?.status;
      const trackId = missingSongTrackId(job.id);
      return (
        status?.kind === "done" &&
        !paths.has(status.path) &&
        (trackId === null || !trackIds.has(trackId)) &&
        ![job.song, ...(job.aliases ?? [])].some((song) => find(song) !== null)
      );
    })
    .map((job) => job.id);
};
