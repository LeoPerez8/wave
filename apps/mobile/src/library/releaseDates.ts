import {
  lookUpReleaseDates,
  releaseBackgroundAllowed,
  releaseAnswerKey,
  releaseNextDue,
  releaseSortChosen,
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
// Only a sorted playlist request interrupts the general run.
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

type LookupInput = {
  song: ReturnType<typeof libraryReleaseSong>;
  track: SongRow | null;
  stream?: boolean;
};
type LookupJob = {
  /** The sorted playlist's id; null for the general lookup. */
  playlistId: number | null;
  selected: () => boolean;
  input: () => Promise<LookupInput[]>;
  progress: (progress: ReleaseProgress | null) => void;
};
const earlier = (next: number | null, at: number): number =>
  next === null ? at : Math.min(next, at);
let cachedPlaylists: Awaited<ReturnType<typeof readPlaylistRows>> | null = null;
const readPlaylistRows = () =>
  appRuntime.runPromise(
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
    LibraryStore.use((store) => store.listPlaylists),
  );
const readPlaylists = async () => cachedPlaylists ?? (cachedPlaylists = await readPlaylistRows());
let generalInput: LookupInput[] | null = null;
let inputVersion = 0;
let sortedIds = new Set<number>();
/** The playlists on Release date as sort changes last saw them; null until the first look. */
let chosenSorts: Set<number> | null = null;
/** Playlists put on Release date since, whose undated songs are asked about again once. */
const sortChosen = new Set<number>();
const playlistInputs = new Map<number, LookupInput[]>();
const playlistInput = async (id: number): Promise<LookupInput[]> => {
  const cached = playlistInputs.get(id);
  if (cached) return cached;
  const version = inputVersion;
  const detail = await appRuntime.runPromise(
    // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
    LibraryStore.use((store) => store.getPlaylist(id)),
  );
  const input = (detail?.items ?? []).map((entry) => ({
    song: entryReleaseSong(entry),
    track: entry.source === "library" ? entry.track : null,
    stream: entry.source === "stream",
  }));
  if (version === inputVersion) playlistInputs.set(id, input);
  return input;
};

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
    const playlists = await readPlaylists();
    const jobs: LookupJob[] = [];
    sortedIds = new Set();
    for (const playlist of playlists) {
      const selected = () =>
        playlistSongSetting(playlist.syncId ?? String(playlist.id)).get().key === "releaseDate";
      if (!selected()) continue;
      sortedIds.add(playlist.id);
      jobs.push({
        playlistId: playlist.id,
        selected,
        input: () => playlistInput(playlist.id),
        progress: (progress) => {
          const statuses = { ...releaseStatus.get() };
          if (progress === null) delete statuses[playlist.id];
          else statuses[playlist.id] = progress;
          releaseStatus.set(statuses);
        },
      });
    }
    // A playlist already on Release date at launch waits for its retries.
    chosenSorts ??= new Set(sortedIds);
    if (backgroundAllowed())
      jobs.push({
        playlistId: null,
        selected: () => backgroundAllowed() && !playlistRequested,
        input: async () => {
          if (generalInput !== null) return generalInput;
          const version = inputVersion;
          const tracks = await appRuntime.runPromise(
            // oxlint-disable-next-line react-hooks/rules-of-hooks -- Effect Service.use resolves a service.
            LibraryStore.use((store) => store.listSongs),
          );
          const input: LookupInput[] = tracks.map((track) => ({
            song: libraryReleaseSong(track),
            track,
          }));
          for (const playlist of playlists) {
            const detail = await playlistInput(playlist.id);
            for (const item of detail) if (item.track === null && item.stream) input.push(item);
          }
          if (version === inputVersion) generalInput = input;
          return input;
        },
        progress: backgroundReleaseStatus.set,
      });
    for (const job of jobs) {
      if (!job.selected()) continue;
      const tracksByReleaseKey = new Map<string, SongRow[]>();
      const input = await job.input();
      for (const { song, track } of input) {
        if (track === null) continue;
        const key = releaseAnswerKey(song);
        const matchingTracks = tracksByReleaseKey.get(key) ?? [];
        if (!matchingTracks.some((entry) => entry.id === track.id)) matchingTracks.push(track);
        tracksByReleaseKey.set(key, matchingTracks);
      }
      const songs: ReleaseLookupSong[] = [];
      const chosen = job.playlistId !== null && sortChosen.delete(job.playlistId);
      for (const { song } of input) {
        const key = releaseAnswerKey(song);
        let answer = releaseAnswers.get()[key] ?? null;
        const held = heldReleaseDate(song);
        // A song answered before it was in the Library (or before its file came) takes its date now.
        if (answer !== null && held === null)
          for (const track of tracksByReleaseKey.get(key) ?? [])
            await keepReleaseDate(track, answer);
        // Kept, so a failed run's retry or a restart still asks about it.
        const asked = chosen && held === null ? releaseSortChosen(answer, Date.now()) : null;
        if (asked !== null) {
          releaseAnswers.put(key, asked);
          answer = asked;
        }
        songs.push({ ...song, key, held, answer });
      }
      const at = releaseNextDue(songs, Date.now());
      if (at === null) continue;
      if (at > Date.now()) {
        next = next === null ? at : Math.min(next, at);
        continue;
      }
      await ensureReleaseNotice();
      looking = job.selected;
      const end = await lookUpReleaseDates({
        songs,
        services: client,
        now: Date.now,
        going: job.selected,
        answered: async (song, answer) => {
          releaseAnswers.put(song.key, answer);
          for (const track of tracksByReleaseKey.get(song.key) ?? [])
            await keepReleaseDate(track, answer);
        },
        progress: job.progress,
      });
      looking = null;
      if (end === "failed") {
        // Every failed song retries in a minute: so does the run.
        next = earlier(next, Date.now() + 60_000);
        break;
      }
      if (end === "stopped") continue;
      const after = releaseNextDue(
        songs.map((song) => ({ ...song, answer: releaseAnswers.get()[song.key] ?? null })),
        Date.now(),
      );
      if (after !== null) next = next === null ? after : Math.min(next, after);
    }
  } catch {
    next = earlier(next, Date.now() + 60_000);
  } finally {
    backgroundReleaseStatus.set(null);
    releaseStatus.set({});
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
  const playlistChanged = async (ids?: readonly number[]) => {
    const previous = new Map(playlistInputs);
    cachedPlaylists = null;
    generalInput = null;
    inputVersion++;
    if (ids === undefined) playlistInputs.clear();
    else for (const id of ids) playlistInputs.delete(id);
    const playlists = await readPlaylists();
    for (const playlist of playlists) {
      if (ids !== undefined && !ids.includes(playlist.id)) continue;
      if (playlistSongSetting(playlist.syncId ?? String(playlist.id)).get().key !== "releaseDate")
        continue;
      const input = await playlistInput(playlist.id);
      if (JSON.stringify(previous.get(playlist.id)) !== JSON.stringify(input))
        playlistRequested = true;
    }
    again = running;
    runSoon();
  };
  const changed = (ids?: readonly number[]) => {
    if (ids?.some((id) => sortedIds.has(id))) playlistRequested = true;
    void playlistChanged(ids).catch(() => runSoon());
  };
  const rememberSorts = () => {
    const selected = new Set(
      (cachedPlaylists ?? [])
        .filter(
          (playlist) =>
            playlistSongSetting(playlist.syncId ?? String(playlist.id)).get().key === "releaseDate",
        )
        .map((playlist) => playlist.id),
    );
    if ([...selected].some((id) => !sortedIds.has(id))) playlistRequested = true;
    sortedIds = selected;
    // Without the playlists read, a choice can't be told from a sort kept since launch.
    if (cachedPlaylists === null) return;
    if (chosenSorts !== null)
      for (const id of selected) if (!chosenSorts.has(id)) sortChosen.add(id);
    chosenSorts = selected;
  };
  onPlaylistSongSortChanged(() => {
    rememberSorts();
    runSoon();
  });
  onPlaylistsEdited(() => changed());
  followReleaseEligibility(backgroundAllowed, () => void run().catch(() => {}), [
    searchOnline.subscribe,
    subscribeConnectivity,
    subscribeYtMusicEnabled,
  ]);
  onTypedReleaseDatesChanged(runSoon);
  onLibraryChange((change) => {
    if (change.kind === "playlists") changed(change.ids);
    else if (change.kind === "tracks") {
      generalInput = null;
      playlistInputs.clear();
      inputVersion++;
      runSoon();
    }
  });
  void run()
    .then(rememberSorts)
    .catch(() => {});
};
