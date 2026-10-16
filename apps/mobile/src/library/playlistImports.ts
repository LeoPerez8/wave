/**
 * Link imports in the background (docs/spec.md, "Importing playlists from a
 * link"): Import makes the playlist at once, and this fills it, one import
 * at a time, while Wave is open or in the background (a foreground service,
 * `WavePlaylistImport`, with progress and Cancel in a notification). Core
 * decides each step (`nextImportStep`, which also paces a Spotify import's
 * YouTube Music searches), what a search's answer settles
 * (`importSearchAnswered`) and what the playlist is given next
 * (`importAdditions`); the imports are kept, so they go on when Wave starts
 * again.
 */
import {
  importAdded,
  importAdditions,
  importSearchAnswered,
  importTurn,
  nextImportStep,
  playlistImportProgress,
  queuePlaylistImport,
  readPlaylistImports,
  readSpotifySearchPacing,
  retryPlaylistImport,
  startPlaylistImport,
  updatePlaylistImport,
  withoutPlaylistImport,
  writePlaylistImports,
  writeSpotifySearchPacing,
  type ImportAdditions,
  type LinkImportPlan,
  type PlaylistImport,
  type PlaylistImports,
  type SpotifySearchPacing,
  type YtAlbumSong,
  type YtSongSearch,
} from "@wave/core";
import * as Result from "effect/Result";

import { askForNotifications } from "@/lib/askForNotifications";
import { persistedSetting } from "@/lib/persistedSetting";
import { WavePlaylistImport } from "@/native/wavePlaylistImport";
import { showError } from "@/overlay/alert";
import { askYtMusic } from "@/ytmusic/askYtMusic";

import { addToPlaylist, currentPlaylists } from "./playlists";

type Job = PlaylistImport<YtAlbumSong>;

/**
 * The imports going on, waiting, stopped, or done with songs not found, kept
 * until Wave starts again. Written at most once a second: a song given the
 * playlist but not yet counted here isn't given twice, as a playlist doesn't
 * take a song it holds.
 */
const imports = persistedSetting<PlaylistImports<YtAlbumSong>>({
  key: "playlistImports",
  read: readPlaylistImports,
  write: (value) => (value.length === 0 ? null : writePlaylistImports(value)),
  persistDelayMs: 1000,
});

/** The imports, for the playlist page; re-renders as they go on. */
export const usePlaylistImports = (): PlaylistImports<YtAlbumSong> => imports.useValue();

/**
 * The YouTube Music searches Spotify imports asked lately, which Core paces
 * (`nextImportStep`), kept so a restart doesn't start a fresh allowance.
 */
const spotifySearches = persistedSetting<SpotifySearchPacing>({
  key: "spotifySearches",
  read: readSpotifySearchPacing,
  write: (value) => (value.searchesAt.length === 0 ? null : writeSpotifySearchPacing(value)),
  persistDelayMs: 1000,
});

/** The searches Spotify imports asked lately, for the playlist page's time left. */
export const useSpotifySearches = (): SpotifySearchPacing => spotifySearches.useValue();

/** While the playlist is given found songs: at most once a second, so its page doesn't redraw for each. */
const GIVE_EVERY_MS = 1000;

/** Whether the imports are running, their service and notification up. */
let running = false;

// ---------------------------------------------------------------------------
// Waking the import going on

const sleepers = new Set<() => void>();

/** Wakes the import going on: an answer came, or the imports changed. */
const wake = (): void => {
  // Each sleeper only removes itself, which a Set's iteration allows.
  for (const sleeper of sleepers) sleeper();
};

/** Resolves after [ms] (never, when null), or once `wake` is called. */
const sleep = (ms: number | null): Promise<void> =>
  new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      sleepers.delete(done);
      resolve();
    };
    const timer = ms === null ? undefined : setTimeout(done, ms);
    sleepers.add(done);
  });

const find = (playlistId: number): Job | undefined =>
  imports.get().find((job) => job.playlistId === playlistId);

/** Shows the import going on in the notification, while the service runs. */
const showProgress = (): void => {
  if (!running) return;
  const progress = playlistImportProgress(imports.get());
  if (progress !== null)
    WavePlaylistImport.progress(progress.title, progress.detail, progress.done, progress.total);
};

const setImports = (next: PlaylistImports<YtAlbumSong>): void => {
  imports.set(next);
  showProgress();
  wake();
};

/** [playlistId]'s import, changed by [change]; nothing when it's gone (cancelled meanwhile). */
const updateImport = (playlistId: number, change: (job: Job) => Job): void => {
  const job = find(playlistId);
  if (job !== undefined) setImports(updatePlaylistImport(imports.get(), change(job)));
};

// ---------------------------------------------------------------------------
// Running the imports

/** One YT Music Songs search: the song's title and artists only. Never rejects. */
const searchYtSongs = async (query: string): Promise<YtSongSearch<YtAlbumSong>> => {
  try {
    const answer = await askYtMusic((ytMusic) => ytMusic.searchSongs(query));
    return Result.isFailure(answer)
      ? { ok: false, reason: answer.failure.reason }
      : { ok: true, songs: answer.success.songs };
  } catch {
    return { ok: false, reason: "failed" };
  }
};

/** Asks [query] for [playlistId]'s import; its answer settles what it finds, whenever it comes. */
const ask = (playlistId: number, query: string): void => {
  void searchYtSongs(query).then((answer) => {
    updateImport(playlistId, (job) => importSearchAnswered(job, query, answer, Date.now()));
  });
};

/**
 * Gives [playlistId]'s playlist [additions], then counts them as given. A
 * playlist deleted meanwhile (here or on another phone) ends its import.
 */
const give = async (
  playlistId: number,
  { songs, through }: ImportAdditions<YtAlbumSong>,
): Promise<void> => {
  try {
    if (songs.length > 0) await addToPlaylist(playlistId, songs);
  } catch (error) {
    const kept = (await currentPlaylists().catch(() => [])).some(({ id }) => id === playlistId);
    setImports(withoutPlaylistImport(imports.get(), playlistId));
    if (kept) void showError("Couldn't import the playlist", error);
    return;
  }
  updateImport(playlistId, (job) => importAdded(job, through));
};

/** Runs [playlistId]'s import while it's the one going on: cancelled, stopped or done, it returns. */
const runImport = async (playlistId: number): Promise<void> => {
  let givenAt = 0;
  for (;;) {
    const job = importTurn(imports.get());
    if (job === null || job.playlistId !== playlistId) {
      // Stopped: the songs found before it stopped still go in.
      const stopped = find(playlistId);
      if (stopped?.state.kind === "stopped") {
        const additions = importAdditions(stopped);
        if (additions.through > stopped.added) await give(playlistId, additions);
      }
      return;
    }
    const now = Date.now();
    const { job: next, step, searches } = nextImportStep(job, now, spotifySearches.get());
    if (step.kind === "search") {
      spotifySearches.set(searches);
      setImports(updatePlaylistImport(imports.get(), next));
      ask(playlistId, step.query);
      continue;
    }
    const additions = importAdditions(job);
    const toGive = additions.through > job.added;
    if (toGive && (step.kind === "none" || now - givenAt >= GIVE_EVERY_MS)) {
      givenAt = now;
      await give(playlistId, additions);
      continue;
    }
    if (step.kind === "none") return;
    const until = Math.min(
      step.kind === "wait" ? step.untilMs : Infinity,
      toGive ? givenAt + GIVE_EVERY_MS : Infinity,
    );
    await sleep(until === Infinity ? null : Math.max(0, until - now));
  }
};

/**
 * Runs the imports in turn until none is left going on, in a foreground
 * service with a progress notification. Does nothing while they run.
 */
const runImports = async (): Promise<void> => {
  if (running || importTurn(imports.get()) === null) return;
  running = true;
  const first = playlistImportProgress(imports.get());
  WavePlaylistImport.start(first?.title ?? "Importing playlists", first?.detail ?? null);
  showProgress();
  try {
    for (let job = importTurn(imports.get()); job !== null; job = importTurn(imports.get())) {
      await runImport(job.playlistId);
    }
  } catch (error) {
    void showError("Couldn't import the playlist", error);
  } finally {
    running = false;
    WavePlaylistImport.end();
  }
};

// ---------------------------------------------------------------------------
// What the app asks

/**
 * Imports [plan] into the playlist Import just made, [playlistId] named
 * [name]: the songs go in as they're found, after any import already going
 * on. Replaces an import into that playlist.
 */
export const startLinkImport = (
  plan: LinkImportPlan<YtAlbumSong>,
  { playlistId, name }: { readonly playlistId: number; readonly name: string },
): void => {
  askForNotifications();
  setImports(queuePlaylistImport(imports.get(), startPlaylistImport(plan, { playlistId, name })));
  void runImports();
};

/**
 * Cancel (on the playlist page or in the notification), or the playlist
 * deleted or replaced: [playlistId]'s import stops, keeping the songs it gave
 * the playlist, and the next goes on. Also dismisses the songs not found.
 */
export const cancelPlaylistImport = (playlistId: number): void => {
  if (find(playlistId) !== undefined) setImports(withoutPlaylistImport(imports.get(), playlistId));
};

/** Try Again on a stopped import: it goes on from where it got to, after the others. */
export const tryPlaylistImportAgain = (playlistId: number): void => {
  setImports(retryPlaylistImport(imports.get(), playlistId));
  void runImports();
};

/** Goes on with the imports kept when Wave last closed. Safe to call repeatedly. */
export const resumePlaylistImports = (): void => {
  void runImports();
};

// Cancel in the notification: the import going on now.
WavePlaylistImport.addListener("onCancel", () => {
  const job = importTurn(imports.get());
  if (job !== null) cancelPlaylistImport(job.playlistId);
});
