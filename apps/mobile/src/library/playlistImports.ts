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
  finishPlaylistImport,
  importLogLine,
  queuePlaylistImport,
  readPlaylistImports,
  startPlaylistImport,
  updatePlaylistImport,
  withoutPlaylistImport,
  writePlaylistImports,
  type LinkImportPlan,
  type PlaylistImport,
  type PlaylistImports,
  type YtAlbumSong,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import { appLog } from "@/log/appLog";
import { showError } from "@/overlay/alert";
import { perfMark, registerPerfMeta } from "@/perf/perf";

import { playlistWorkReport } from "./db/playlistWork";
import { addToPlaylist, currentPlaylists } from "./playlists";

type Job = PlaylistImport<YtAlbumSong>;

/** The imports giving their playlist its songs, or done with songs left out to show, kept until Wave starts again. */
const imports = persistedSetting<PlaylistImports<YtAlbumSong>>({
  key: "playlistImports",
  read: readPlaylistImports,
  write: (value) => (value.length === 0 ? null : writePlaylistImports(value)),
});

/** The playlists whose import is giving them their songs now, so none is given twice. */
const finishing = new Set<number>();

/** The imports, for the playlist page's line. */
export const usePlaylistImports = (): PlaylistImports<YtAlbumSong> => imports.useValue();

const LOG_TAG = "WaveImport";

/**
 * Gives [job]'s playlist every song it hasn't yet, then keeps the import
 * only while it has songs left out to show. A playlist deleted meanwhile
 * (here or on another phone) ends it.
 */
const finish = async (job: Job, resumed: boolean): Promise<void> => {
  if (finishing.has(job.playlistId)) return;
  finishing.add(job.playlistId);
  const { songs, job: done } = finishPlaylistImport(job);
  try {
    if (songs.length > 0) await addToPlaylist(job.playlistId, songs);
  } catch (error) {
    const kept = (await currentPlaylists().catch(() => [])).some(({ id }) => id === job.playlistId);
    imports.set(withoutPlaylistImport(imports.get(), job.playlistId));
    if (kept) void showError("Couldn't import the playlist", error);
    return;
  } finally {
    finishing.delete(job.playlistId);
  }
  perfMark("import.done", String(songs.length));
  appLog("info", LOG_TAG, importLogLine(done, { resumed }));
  // Replaced or dismissed meanwhile: nothing left to keep.
  if (!imports.get().some((queued) => queued.playlistId === job.playlistId)) return;
  imports.set(updatePlaylistImport(imports.get(), done));
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
  return finish(job, false);
};

/**
 * Dismiss on the playlist page, or the playlist deleted or replaced: its
 * import's line goes for good.
 */
export const cancelPlaylistImport = (playlistId: number): void => {
  if (!imports.get().some((job) => job.playlistId === playlistId)) return;
  imports.set(withoutPlaylistImport(imports.get(), playlistId));
};

/**
 * Ends the imports a Wave from before kept going on (they searched YouTube
 * Music as they went): what each found stays, the rest goes in unsearched.
 * Safe to call repeatedly.
 */
export const resumePlaylistImports = (): void => {
  for (const job of imports.get()) {
    if (job.state.kind === "importing") void finish(job, true);
  }
};
