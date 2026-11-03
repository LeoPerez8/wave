import {
  lookUpReleaseDates,
  releaseBackgroundAllowed,
  releaseAnswerKey,
  releaseNextDue,
  releaseTagDate,
  type ReleaseAnswer,
  type ReleaseLookupSong,
  type ReleaseProgress,
} from "@wave/core";

import { onMobileData, subscribeConnectivity } from "@/native/waveNative";
import { searchOnline } from "@/settings/searchOnline";
import { subscribeYtMusicEnabled, ytMusicEnabled } from "@/settings/ytMusic";

import { persistedSetting } from "@/lib/persistedSetting";
import { currentLocalisation } from "@/localisation/localisation";
import { showMessage } from "@/overlay/alert";

import { onLibraryChange } from "./libraryChanges";
import { LibraryStore, type SongRow } from "./LibraryStore";
import { onPlaylistSongSortChanged, playlistSongSetting } from "./playlistSongSetting";
import { onPlaylistsEdited } from "./playlists";
import { releaseAnswers } from "./releaseAnswers";
import { writeReleaseDateTag } from "./releaseDateTag";
import { followReleaseEligibility } from "./releaseEligibility";
import { releaseLookupClient } from "./releaseLookupClient";
import { entryReleaseSong, libraryReleaseSong, heldReleaseDate } from "./releaseSong";
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
const keepReleaseDate = async (track: SongRow, answer: ReleaseAnswer): Promise<void> => {
  if (answer.source !== "first-release" || !answer.date) return;
  const { date } = answer;
  const held = heldReleaseDate(libraryReleaseSong(track));
  const saved = await appRuntime.runPromise(
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
    LibraryStore.use((store) => store.saveReleaseDate(track.id, date)),
  );
  const path = saved?.path ?? null;
  const tagged = releaseTagDate({ answer, held, hasFile: path !== null });
  if (path !== null && tagged !== null) await writeReleaseDateTag(path, tagged, false);
};

/** Eligibility of the current lookup, checked by the client before each service request. */
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
// A playlist edit invalidates the general run immediately, before its next service request.
let playlistRequested = false;
const backgroundAllowed = (): boolean =>
  releaseBackgroundAllowed(searchOnline.get(), {
    onMobileData: onMobileData(),
    ytMusic: ytMusicEnabled(),
  });

/** General lookup progress, kept separately so Settings can follow it without playlist ids. */
export const backgroundReleaseStatus = persistedSetting<ReleaseProgress | null>({
  key: "releaseDates.backgroundProgress",
  read: () => null,
  write: () => null,
});

/**
 * Looks up sorted playlists first, then Library and playlist YT Music songs when permitted.
 * A playlist request interrupts the general lookup; failures wait for their retry. With no
 * changes it sleeps until the next retry, without reading songs or polling.
 */
const run = async (): Promise<void> => {
  if (running) {
    again = true;
    return;
  }
  running = true;
  clearTimeout(soon);
  playlistRequested = false;
  clearTimeout(wake);
  let next: number | null = null;
  try {
    const playlists = await appRuntime.runPromise(
      // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
      LibraryStore.use((store) => store.listPlaylists),
    );
    const statuses: Record<number, ReleaseProgress> = {};
    // The null group is the general lookup; sorted playlists always precede it.
    for (const playlist of [...playlists, null]) {
      const general = playlist === null;
      const setting =
        playlist === null ? null : playlistSongSetting(playlist.syncId ?? String(playlist.id));
      const selected = () =>
        general ? backgroundAllowed() && !playlistRequested : setting?.get().key === "releaseDate";
      if (!selected()) continue;
      const entries = new Map<string, SongRow[]>();
      const input: ReturnType<typeof libraryReleaseSong>[] = [];
      const addTrack = (track: SongRow) => {
        const song = libraryReleaseSong(track);
        const key = releaseAnswerKey(song);
        const held = entries.get(key) ?? [];
        if (!held.some((entry) => entry.id === track.id)) held.push(track);
        entries.set(key, held);
        return song;
      };
      if (general) {
        const tracks = await appRuntime.runPromise(
          // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
          LibraryStore.use((store) => store.listSongs),
        );
        for (const track of tracks) input.push(addTrack(track));
      }
      for (const candidate of general ? playlists : [playlist!]) {
        const detail = await appRuntime.runPromise(
          // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
          LibraryStore.use((store) => store.getPlaylist(candidate.id)),
        );
        for (const entry of detail?.items ?? []) {
          if (entry.source === "library") {
            if (!general) input.push(addTrack(entry.track));
          } else if (!general || entry.source === "stream") input.push(entryReleaseSong(entry));
        }
      }
      const songs: ReleaseLookupSong[] = [];
      for (const song of input) {
        const key = releaseAnswerKey(song);
        const answer = releaseAnswers.get()[key] ?? null;
        const held = heldReleaseDate(song);
        // A song answered before it was in the Library (or before its file came) takes its date now.
        if (answer !== null && held === null)
          for (const track of entries.get(key) ?? []) await keepReleaseDate(track, answer);
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
          releaseAnswers.put(song.key, answer);
          for (const track of entries.get(song.key) ?? []) await keepReleaseDate(track, answer);
        },
        progress: (progress) => {
          if (playlist === null) backgroundReleaseStatus.set(progress);
          else {
            if (progress === null) delete statuses[playlist.id];
            else statuses[playlist.id] = progress;
            releaseStatus.set({ ...statuses });
          }
        },
      });
      looking = null;
      if (end === "failed") {
        // Every failed song retries in a minute: so does the run.
        next = Date.now() + 60_000;
        break;
      }
      if (end === "stopped") continue;
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
 * Starts process-lifetime release lookups, following playlist edits, scans, typed dates and
 * automatic Search online choices. Retry timers are the only wake-ups without a change.
 */
export const startReleaseDates = (): void => {
  if (started) return;
  started = true;
  const playlistChanged = () => {
    playlistRequested = true;
    again = running;
    runSoon();
  };
  onPlaylistSongSortChanged(playlistChanged);
  onPlaylistsEdited(playlistChanged);
  followReleaseEligibility(backgroundAllowed, () => void run().catch(() => {}), [
    searchOnline.subscribe,
    subscribeConnectivity,
    subscribeYtMusicEnabled,
  ]);
  onTypedReleaseDatesChanged(runSoon);
  onLibraryChange((change) => {
    if (change.kind === "playlists") playlistChanged();
    else if (change.kind === "tracks") runSoon();
  });
  void run().catch(() => {});
};
