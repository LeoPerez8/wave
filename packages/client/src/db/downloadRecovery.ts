/** Download recovery reads file identities and recording candidates, never all song rows. */
import {
  missingSongTrackId,
  recordingMatchTitle,
  ytDownloadsFromJournal,
  ytDownloadsToForget,
  type YtDownloadJournalJob,
} from "@wave/core";
import { and, inArray, isNotNull } from "drizzle-orm";
import { chunks } from "./chunks.ts";
import type { LibraryDatabase } from "./database.ts";
import { tracks } from "./schema.ts";

export const selectDownloadsToForget = (
  db: LibraryDatabase,
  jobs: readonly YtDownloadJournalJob[],
): string[] => {
  const completed = jobs.filter((job) => job.phase === "completed" && job.acknowledged === true);
  const paths = ytDownloadsFromJournal(completed).jobs.flatMap(({ status }) =>
    status.kind === "done" ? [status.path] : [],
  );
  const ids = completed.flatMap((job) => {
    const id = missingSongTrackId(job.id);
    return id === null ? [] : [id];
  });
  const titles = [
    ...new Set(
      completed.flatMap((job) =>
        [job.song, ...(job.aliases ?? [])].map((song) => recordingMatchTitle(song.title)),
      ),
    ),
  ];
  const found = new Map<
    number,
    { id: number; path: string | null; title: string; artist: string; durationMs: number }
  >();
  for (const [column, values] of [
    [tracks.path, paths],
    [tracks.id, ids],
    [tracks.matchTitle, titles],
  ] as const) {
    for (const some of chunks<string | number>(values)) {
      const rows = db
        .select({
          id: tracks.id,
          path: tracks.path,
          title: tracks.title,
          artist: tracks.artistCredit,
          durationMs: tracks.durationMs,
        })
        .from(tracks)
        .where(and(isNotNull(tracks.path), inArray(column, some)))
        .all();
      for (const row of rows) found.set(row.id, row);
    }
  }
  return ytDownloadsToForget(completed, [...found.values()]);
};
