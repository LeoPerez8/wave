import { currentLocalisation } from "@/localisation/localisation";
import { registerTimingBackground, timingBackgroundChanged } from "@/lib/timing";
/**
 * Link imports (docs/spec.md, "Importing playlists from a link"): Import
 * makes the playlist, and this gives it every song at once (Core's
 * `finishPlaylistImport`): the Library's as its tracks, a YouTube Music
 * playlist's as YT Music entries, a Spotify playlist's others as unsearched
 * entries, searched when they're needed. Nothing is searched, so there is no
 * wait, notification or service. An import with songs left out (listed
 * twice) is kept until dismissed, for its line on the playlist's page. An
 * import a Wave from before kept going on (one that searched YouTube Music)
 * ends once Wave starts, its songs not yet found going in unsearched. The
 * app log notes each import in one line (`importLogLine`).
 */
import {
  addingProgress,
  playlistImportCompletionSteps,
  queuePlaylistImport,
  startPlaylistImport,
  updatePlaylistImport,
  withoutPlaylistImport,
  type LinkImportPlan,
  type PlaylistImport,
  type PlaylistImports,
  type YtAlbumSong,
} from "@wave/core";

import { runSteps } from "@/lib/stepped";
import { startupTurnEffect, startupTurn } from "@/lib/backgroundWork";
import { finishLinkImport } from "./startupJobs";

import { appLog } from "@/log/appLog";
import { showError } from "@/overlay/alert";
import { perfMark, registerPerfMeta } from "@/perf/perf";

import { playlistWorkReport } from "./db/playlistWork";
import { endImportProgress, showImportProgress } from "./importProgress";
import { LibraryStore } from "./LibraryStore";
import { playlistImports as imports } from "./playlistImportsStore";
import { currentPlaylists, playlistsChanged } from "./playlists";
import { appRuntime } from "./runtime";

type Job = PlaylistImport<YtAlbumSong>;

/** The Library's songs, as an import matches them (`planLinkImport`). */
export const listLibrary = () =>
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  appRuntime.runPromise(LibraryStore.use((store) => store.listSongs));

/** The playlists whose import is giving them their songs now, so none is given twice. */
const finishing = new Map<number, { job: Job; promise: Promise<void> }>();
registerTimingBackground("linkImport", () => (finishing.size > 0 ? "import" : null));

/** The imports, for the playlist page's line. */
export const usePlaylistImports = (): PlaylistImports<YtAlbumSong> => imports.useValue();

const LOG_TAG = "WaveImport";

/**
 * Gives [job]'s playlist every song it hasn't yet, then keeps the import
 * only while it has songs left out to show. A playlist deleted meanwhile
 * (here or on another phone) ends it.
 */
const finish = (job: Job, resumed: boolean): Promise<void> => {
  const going = finishing.get(job.playlistId);
  if (going !== undefined)
    return going.job === job ? going.promise : going.promise.then(() => finish(job, resumed));
  const giving = give(job, resumed).finally(() => finishing.delete(job.playlistId));
  finishing.set(job.playlistId, { job, promise: giving });
  timingBackgroundChanged();
  return giving;
};

/** [finish]'s work, while no other import gives [job]'s playlist its songs. */
const give = async (job: Job, resumed: boolean): Promise<void> => {
  let done: Job | null;
  try {
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    const giving = LibraryStore.use((store) =>
      finishLinkImport(
        store,
        job,
        startupTurnEffect,
        () => imports.get().includes(job),
        () => playlistsChanged([job.playlistId], true),
        // "Adding 340 of 10,000" while the songs land.
        (added, total) => {
          if (imports.get().includes(job))
            showImportProgress(job.playlistId, addingProgress(added, total));
        },
      ),
    );
    done = await appRuntime.runPromise(giving);
    // Replaced or deleted meanwhile, its progress already went (`cancelPlaylistImport`).
    if (done !== null) endImportProgress(job.playlistId);
    await startupTurn();
    playlistsChanged([job.playlistId]);
    if (done === null) return;
  } catch (error) {
    const kept = (await currentPlaylists().catch(() => [])).some(({ id }) => id === job.playlistId);
    if (imports.get().includes(job)) {
      endImportProgress(job.playlistId);
      imports.set(withoutPlaylistImport(imports.get(), job.playlistId));
    }
    if (kept) void showError(currentLocalisation().strings.imports.couldntImportPlaylist, error);
    return;
  }
  perfMark("import.done", String(job.songs.length - job.added));
  const completion = await appRuntime.runPromise(
    runSteps(playlistImportCompletionSteps(done, resumed), startupTurnEffect),
  );
  appLog("info", LOG_TAG, completion.line);
  // Replaced or dismissed meanwhile: nothing left to keep.
  if (!imports.get().includes(job)) return;
  imports.set(updatePlaylistImport(imports.get(), completion.kept));
};

// A perf build's runs record what the imported playlists cost (#308).
registerPerfMeta("playlistWork", () =>
  playlistWorkReport(imports.get().map((job) => job.playlistId)),
);

/**
 * Imports [plan] into the playlist Import just made, [playlistId] named
 * [name]: every song goes in at once. Replaces an import into that playlist.
 * Resolves once the playlist has its songs (a failure is shown, not thrown).
 */
export const startLinkImport = (
  plan: LinkImportPlan<YtAlbumSong>,
  { playlistId, name }: { readonly playlistId: number; readonly name: string },
): Promise<void> => {
  const job = startPlaylistImport(plan, { playlistId, name });
  imports.set(queuePlaylistImport(imports.get(), job));
  // At once, while its rows are built: a new import starts its adding from none.
  endImportProgress(playlistId);
  showImportProgress(playlistId, addingProgress(0, plan.songs.length));
  return finish(job, false);
};

/**
 * Dismiss on the playlist page, or the playlist deleted or replaced: its
 * import's line goes for good.
 */
export const cancelPlaylistImport = (playlistId: number): void => {
  if (!imports.get().some((job) => job.playlistId === playlistId)) return;
  // An import still giving it songs ends here, its line with it.
  if (finishing.has(playlistId)) endImportProgress(playlistId);
  imports.set(withoutPlaylistImport(imports.get(), playlistId));
};

/**
 * Ends the imports a Wave from before kept going on (they searched YouTube
 * Music as they went): what each found stays, the rest goes in unsearched.
 * Safe to call repeatedly.
 */
export const resumePlaylistImports = (): void => {
  void resume();
};
const resume = async (): Promise<void> => {
  // Keep registration/source order; a failed job reports its failure and the next still resumes.
  for (const job of imports.get()) {
    await startupTurn();
    if (job.state.kind === "importing" && imports.get().includes(job)) await finish(job, true);
  }
};

/**
 * Resolves once [playlistId]'s import has given it its songs: at once with
 * none going on, else when the one a Wave from before kept going on (or the
 * one giving them now) is done. What queues its downloads waits on this.
 */
export const settlePlaylistImport = (playlistId: number): Promise<void> => {
  const job = imports
    .get()
    .find((queued) => queued.playlistId === playlistId && queued.state.kind === "importing");
  return job === undefined
    ? (finishing.get(playlistId)?.promise ?? Promise.resolve())
    : finish(job, true);
};
