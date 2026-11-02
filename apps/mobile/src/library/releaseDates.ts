import {
  releaseCandidates,
  releaseAnswer,
  releaseDue,
  releaseTagDate,
  releaseTagNotWrittenLine,
  tagWriteFailureLine,
  type ReleaseAnswer,
  type TagWriteFile,
  type TagWriteStep,
} from "@wave/core";
import { persistedSetting } from "@/lib/persistedSetting";
import { currentLocalisation } from "@/localisation/localisation";
import { WaveNative } from "@/native/waveNative";
import { showMessage } from "@/overlay/alert";
import { LibraryStore, type PlaylistEntryRow } from "./LibraryStore";
import { appRuntime } from "./runtime";
import { onPlaylistSongSortChanged, playlistSongSetting } from "./playlistSongSetting";
import { onPlaylistsEdited } from "./playlists";
import { releaseDates, releaseSongKey } from "./releaseAnswers";
import { releaseLookupClient } from "./releaseLookupClient";

export { releaseDates };
const notice = persistedSetting<boolean>({
  key: "releaseDates.notice",
  read: (s) => s === "true",
  write: JSON.stringify,
});
let showing: Promise<void> | null = null;
export const ensureReleaseNotice = (): Promise<void> => {
  if (notice.get()) return Promise.resolve();
  return (showing ??= (async () => {
    const strings = currentLocalisation().strings.playlists;
    await showMessage(strings.releaseNoticeTitle, strings.releaseNotice);
    notice.set(true);
  })().finally(() => {
    showing = null;
  }));
};
export const releaseEntrySong = (entry: PlaylistEntryRow) =>
  entry.source === "library"
    ? { title: entry.track.title, artist: entry.track.artist }
    : { title: entry.song.title, artist: entry.song.artists[0] ?? "" };
export const releaseEntryKey = (entry: PlaylistEntryRow): string =>
  releaseSongKey(releaseEntrySong(entry));
export const releaseEntryDate = (entry: PlaylistEntryRow): string | null => {
  const answer = releaseDates.get()[releaseEntryKey(entry)];
  if (entry.source === "library") {
    if (entry.track.releaseDate) return entry.track.releaseDate;
    if (answer?.source === "first-release") return answer.date;
    if (entry.track.year) return String(entry.track.year);
  }
  return answer?.date ?? null;
};

/** Logs why [date] isn't in [path]'s tags; the index keeps it whatever happened. */
const writeReleaseTag = async (path: string, date: string): Promise<void> => {
  const failed = (
    cause: unknown,
    step: TagWriteStep | null = null,
    file: TagWriteFile | null = null,
  ) =>
    console.warn(
      `[wave] ${tagWriteFailureLine({ path, origin: "releaseDate", step, file, cause })}`,
    );
  try {
    const written = await WaveNative.writeOriginalDate(path, date);
    if ("failed" in written) {
      const { step, exception, message, fileExists, fileBytes } = written.failed;
      failed(Object.assign(new Error(message), { name: exception }), step, {
        exists: fileExists,
        bytes: fileBytes,
      });
    } else if (written.originalDate === "notWritten")
      console.warn(`[wave] ${releaseTagNotWrittenLine(path, date)}`);
  } catch (cause) {
    failed(cause);
  }
};

/**
 * Keeps a found first-release date in the index for a Library song without one and, that once,
 * in its file (Core's `releaseTagDate`). A file that can't take it keeps it in the index only.
 */
const keepReleaseDate = async (entry: PlaylistEntryRow, answer: ReleaseAnswer): Promise<void> => {
  if (entry.source !== "library" || answer.source !== "first-release" || !answer.date) return;
  const { date } = answer;
  const saved = await appRuntime.runPromise(
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
    LibraryStore.use((store) => store.saveReleaseDate(entry.track.id, date)),
  );
  const path = saved?.path ?? null;
  const tagged = releaseTagDate({ answer, held: entry.track.releaseDate, hasFile: path !== null });
  if (path !== null && tagged !== null) await writeReleaseTag(path, tagged);
};

export const releaseStatus = persistedSetting<
  Record<number, { done: number; total: number; offline: boolean }>
>({ key: "releaseDates.progress", read: () => ({}), write: () => null });
let busy = false;
let started = false;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let allowed = () => false;
const client = releaseLookupClient(
  async (url, headers) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      return await fetch(url, { headers, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  },
  sleep,
  Date.now,
  () => allowed(),
);

const run = async (): Promise<void> => {
  if (busy) return;
  busy = true;
  try {
    const playlists = await appRuntime.runPromise(
      // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
      LibraryStore.use((store) => store.listPlaylists),
    );
    const statuses: Record<number, { done: number; total: number; offline: boolean }> = {};
    for (const playlist of playlists) {
      const selected = () =>
        playlistSongSetting(playlist.syncId ?? String(playlist.id)).get().key === "releaseDate";
      if (!selected()) continue;
      const detail = await appRuntime.runPromise(
        // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
        LibraryStore.use((store) => store.getPlaylist(playlist.id)),
      );
      if (!detail) continue;
      const unique = [...new Map(detail.items.map((e) => [releaseEntryKey(e), e])).values()];
      for (const entry of unique) {
        const answer = releaseDates.get()[releaseEntryKey(entry)];
        if (entry.source === "library" && !entry.track.releaseDate && answer)
          await keepReleaseDate(entry, answer);
      }
      const due = unique.filter((e) =>
        releaseDue(
          releaseEntrySong(e),
          e.source === "library" ? e.track.releaseDate : null,
          releaseDates.get()[releaseEntryKey(e)],
          Date.now(),
        ),
      );
      if (!due.length) continue;
      statuses[playlist.id] = {
        done: unique.length - due.length,
        total: unique.length,
        offline: false,
      };
      releaseStatus.set({ ...statuses });
      await ensureReleaseNotice();
      allowed = selected;
      for (let i = 0; i < due.length && selected(); i += 25) {
        const group = due.slice(i, i + 25);
        const found: {
          entry: PlaylistEntryRow;
          candidates: ReturnType<typeof releaseCandidates>;
        }[] = [];
        let failed = false;
        try {
          for (const entry of group) {
            const song = releaseEntrySong(entry);
            found.push({
              entry,
              candidates: releaseCandidates(song, await client.search(song.title, song.artist)),
            });
          }
          const responses = await client.recordings(
            found.flatMap((r) => r.candidates.map((c) => c.isrc)),
          );
          for (const { entry, candidates } of found) {
            const year = entry.source === "library" ? entry.track.year : null;
            let answer = releaseAnswer(
              candidates.map((c) => c.isrc),
              responses,
              year,
              null,
              Date.now(),
            );
            if (!answer.date) {
              const albumDates: string[] = [];
              for (const id of new Set(candidates.map((c) => c.albumId))) {
                if (id === null) continue;
                const album = (await client.album(id)) as { release_date?: string };
                if (album.release_date) albumDates.push(album.release_date);
              }
              answer = releaseAnswer([], [], year, albumDates.toSorted()[0] ?? null, Date.now());
            }
            releaseDates.set({ ...releaseDates.get(), [releaseEntryKey(entry)]: answer });
            await keepReleaseDate(entry, answer);
          }
        } catch {
          failed = true;
          for (const entry of group) {
            const key = releaseEntryKey(entry);
            const before = releaseDates.get()[key];
            if (before?.source === "first-release") continue;
            const answer = releaseAnswer(
              [],
              [],
              entry.source === "library" ? entry.track.year : null,
              before?.date ?? null,
              Date.now(),
              true,
            );
            releaseDates.set({ ...releaseDates.get(), [key]: answer });
          }
        }
        statuses[playlist.id] = {
          done: Math.min(unique.length, unique.length - due.length + i + group.length),
          total: unique.length,
          offline: failed,
        };
        releaseStatus.set({ ...statuses });
        if (failed) return;
      }
      delete statuses[playlist.id];
      releaseStatus.set({ ...statuses });
    }
  } finally {
    busy = false;
  }
};
export const startReleaseDates = (): void => {
  if (started) return;
  started = true;
  onPlaylistSongSortChanged(() => {
    void run().catch(() => {});
  });
  onPlaylistsEdited(() => {
    void run().catch(() => {});
  });
  // Poll also discovers synced sort choices and retry deadlines without a screen mounted.
  setInterval(() => {
    void run().catch(() => {});
  }, 15_000);
  void run().catch(() => {});
};
