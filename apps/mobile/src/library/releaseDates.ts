import {
  lookUpReleaseDates,
  releaseAnswerKey,
  releaseNextDue,
  releaseTagDate,
  type ReleaseAnswer,
  type ReleaseLookupSong,
  type ReleaseProgress,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import { currentLocalisation } from "@/localisation/localisation";
import { showMessage } from "@/overlay/alert";

import { onLibraryChange } from "./libraryChanges";
import { LibraryStore, type PlaylistEntryRow } from "./LibraryStore";
import { onPlaylistSongSortChanged, playlistSongSetting } from "./playlistSongSetting";
import { onPlaylistsEdited } from "./playlists";
import { releaseAnswers } from "./releaseAnswers";
import { writeReleaseDateTag } from "./releaseDateTag";
import { releaseLookupClient } from "./releaseLookupClient";
import { entryReleaseSong, heldReleaseDate } from "./releaseSong";
import { appRuntime } from "./runtime";
import { onTypedReleaseDatesChanged } from "./typedReleaseDates";

const notice = persistedSetting<boolean>({
  key: "releaseDates.notice",
  read: (stored) => stored === "true",
  write: JSON.stringify,
});
let showing: Promise<void> | null = null;

/** Shows the notice naming Deezer and MusicBrainz, the first time a lookup is about to start. */
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

/** Each Release date playlist's lookup progress while it runs, by playlist id; never stored. */
export const releaseStatus = persistedSetting<Readonly<Record<number, ReleaseProgress>>>({
  key: "releaseDates.progress",
  read: () => ({}),
  write: () => null,
});

/**
 * Keeps a found first-release date in the index for a Library song without one and, that once,
 * in its file (Core's `releaseTagDate`). A file that can't take it keeps it in the index only.
 */
const keepReleaseDate = async (entry: PlaylistEntryRow, answer: ReleaseAnswer): Promise<void> => {
  if (entry.source !== "library" || answer.source !== "first-release" || !answer.date) return;
  const { date } = answer;
  const held = heldReleaseDate(entryReleaseSong(entry));
  const saved = await appRuntime.runPromise(
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
    LibraryStore.use((store) => store.saveReleaseDate(entry.track.id, date)),
  );
  const path = saved?.path ?? null;
  const tagged = releaseTagDate({ answer, held, hasFile: path !== null });
  if (path !== null && tagged !== null) await writeReleaseDateTag(path, tagged, false);
};

/** The playlist whose songs are being looked up now, which the client checks before each request. */
let looking: (() => boolean) | null = null;
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
  (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  Date.now,
  () => looking?.() ?? false,
);

/** The longest a timer may wait (setTimeout's limit is about 24.8 days). */
const MAX_WAIT_MS = 2 ** 31 - 1;
let running = false;
let again = false;
let wake: ReturnType<typeof setTimeout> | undefined;

/**
 * Looks up the songs due in every playlist on Release date (Core's `lookUpReleaseDates`), one
 * playlist at a time, then sleeps until the next retry is due. A failure stops the run until
 * its retry; a change while it runs runs it again once it ends.
 */
const run = async (): Promise<void> => {
  if (running) {
    again = true;
    return;
  }
  running = true;
  clearTimeout(wake);
  let next: number | null = null;
  try {
    const playlists = await appRuntime.runPromise(
      // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
      LibraryStore.use((store) => store.listPlaylists),
    );
    const statuses: Record<number, ReleaseProgress> = {};
    for (const playlist of playlists) {
      const setting = playlistSongSetting(playlist.syncId ?? String(playlist.id));
      const selected = () => setting.get().key === "releaseDate";
      if (!selected()) continue;
      const detail = await appRuntime.runPromise(
        // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
        LibraryStore.use((store) => store.getPlaylist(playlist.id)),
      );
      if (!detail) continue;
      const entries = new Map<string, PlaylistEntryRow>();
      const songs: ReleaseLookupSong[] = [];
      for (const entry of detail.items) {
        const song = entryReleaseSong(entry);
        const key = releaseAnswerKey(song);
        const answer = releaseAnswers.get()[key] ?? null;
        const held = heldReleaseDate(song);
        // A song answered before it was in the Library (or before its file came) takes its date now.
        if (answer !== null && held === null) await keepReleaseDate(entry, answer);
        if (!entries.has(key)) entries.set(key, entry);
        songs.push({ ...song, key, held, answer });
      }
      const at = releaseNextDue(songs, Date.now());
      if (at === null) continue;
      if (at > Date.now()) {
        next = next === null ? at : Math.min(next, at);
        continue;
      }
      await ensureReleaseNotice();
      looking = selected;
      const end = await lookUpReleaseDates({
        songs,
        services: client,
        now: Date.now,
        going: selected,
        answered: async (song, answer) => {
          releaseAnswers.set({ ...releaseAnswers.get(), [song.key]: answer });
          const entry = entries.get(song.key);
          if (entry !== undefined) await keepReleaseDate(entry, answer);
        },
        progress: (progress) => {
          if (progress === null) delete statuses[playlist.id];
          else statuses[playlist.id] = progress;
          releaseStatus.set({ ...statuses });
        },
      });
      looking = null;
      if (end === "failed") {
        // Every failed song retries in a minute: so does the run.
        next = Date.now() + 60_000;
        break;
      }
      const after = releaseNextDue(
        songs.map((song) => ({ ...song, answer: releaseAnswers.get()[song.key] ?? null })),
        Date.now(),
      );
      if (after !== null) next = next === null ? after : Math.min(next, after);
    }
  } finally {
    looking = null;
    running = false;
  }
  if (again) {
    again = false;
    void run().catch(() => {});
  } else if (next !== null)
    wake = setTimeout(
      () => void run().catch(() => {}),
      Math.min(MAX_WAIT_MS, Math.max(0, next - Date.now())),
    );
};

let started = false;
let soon: ReturnType<typeof setTimeout> | undefined;

/** Runs the lookup a moment after a burst of changes settles. */
const runSoon = (): void => {
  clearTimeout(soon);
  soon = setTimeout(() => void run().catch(() => {}), 2_000);
};

/**
 * Starts the playlists' release-date lookups: now, whenever a playlist's sort, songs or typed
 * dates change (here or from another phone), and when the next retry is due. With nothing
 * due, it waits without a timer of its own reading the playlists.
 */
export const startReleaseDates = (): void => {
  if (started) return;
  started = true;
  onPlaylistSongSortChanged(runSoon);
  onPlaylistsEdited(runSoon);
  onTypedReleaseDatesChanged(runSoon);
  onLibraryChange((change) => {
    if (change.kind === "playlists" || (change.kind === "tracks" && change.scanned !== true))
      runSoon();
  });
  void run().catch(() => {});
};
