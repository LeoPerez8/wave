import {
  pendingFavorite,
  readSyncedStars,
  starredHere,
  syncedStarDownloads,
  writeSyncedStars,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import type { NativeYtSong } from "@/native/waveYtMusic";
import type { FindInLibrary } from "@/ytmusic/libraryFinder";
import { cancelUnstarredDownloads, downloadStarredSongs } from "@/ytmusic/YtDownloads";

import { currentFavoriteIds, setFavorites, setPendingFavorites } from "./favorites";
import { LibraryStore, songHasFile, type SongRow } from "./LibraryStore";
import { appRuntime } from "./runtime";

/**
 * A star means downloaded (docs/spec.md, "Favorites of songs this phone has
 * no file for"): starring any song, the Library's or a YT Music song this
 * phone has no file for (a non-D song), flips its star at once everywhere,
 * and a non-D song's download is asked for with it.
 *
 * - A Library song with a file is starred as ever.
 * - A missing song (a Track with no file here) is starred as the Library's
 *   song, which syncs, and its download joins the queue under Favorites.
 * - A YT Music song the Library doesn't have becomes a pending favorite
 *   (this phone only) and joins the queue under Favorites; the save that
 *   brings its file in stars the Library track (`settlePendingFavorites`).
 *
 * Unstarring one before its file arrives takes the star back and cancels the
 * download when only the star asked for it (Core's `unstarredDownload`).
 */
export interface SongsToStar {
  /** Library songs, with a file or missing. */
  readonly tracks: readonly SongRow[];
  /** YT Music songs, streamed: each the Library's song when [find] says the Library has it. */
  readonly ytSongs: readonly NativeYtSong[];
}

/**
 * The starred missing songs this phone has seen, by Track id (Core's `syncedStarDownloads`):
 * their stars have asked for their downloads already. Kept on this phone, never synced.
 */
const seenStars = persistedSetting<ReadonlySet<number>>({
  key: "downloads.syncedStars",
  read: readSyncedStars,
  write: writeSyncedStars,
});

let syncing = Promise.resolve();

/** The stars' downloads, asked for one star after another. */
let downloads = Promise.resolve();

/** Stars ([on]) or unstars [songs], the Library's and YT Music's, with their downloads. */
export const starSongs = (
  { tracks, ytSongs }: SongsToStar,
  on: boolean,
  find: FindInLibrary,
): Promise<void> => {
  const library = new Map(tracks.map((song) => [song.id, song]));
  const streamed: NativeYtSong[] = [];
  for (const song of ytSongs) {
    const track = find(song);
    if (track === null) streamed.push(song);
    else library.set(track.id, track);
  }
  const missing = [...library.values()].flatMap((song) => (songHasFile(song) ? [] : [song.id]));
  const stars = setFavorites([...library.keys()], on);
  // Unstarring takes back the songs' pending favorites too, the ones the Library has by now
  // included, so none stars them later.
  const pending = setPendingFavorites((on ? streamed : ytSongs).map(pendingFavorite), on);
  // Downloads follow once the pending favorites are kept, so each download's landing finds its
  // own; in the order the stars were set, so a star taken straight back cancels what it asked.
  downloads = downloads
    .then(() => pending)
    .then(() => {
      if (on) downloadStarredSongs(streamed, missing);
      else
        cancelUnstarredDownloads(
          streamed.map((song) => song.videoId),
          missing,
        );
    });
  // The missing songs' stars, set here, have asked for their downloads: should another phone
  // take one off before the file arrives, the next sync takes the download back. In turn with
  // the syncs, once the stars are kept, so a sync reads the stars and what it has seen alike.
  if (missing.length > 0)
    syncing = syncing
      .then(() => stars)
      .then(() => seenStars.set(starredHere(seenStars.get(), missing, on)))
      .catch(() => undefined);
  return Promise.all([stars, pending]).then(() => undefined);
};

/**
 * Stars that came from the Wave account mean downloaded too (docs/spec.md, "A star means
 * downloaded"): each missing song with a star this phone hasn't seen yet joins the download
 * queue under Favorites (a sign-in on a new phone queues them all), and a star taken off since,
 * here or on another phone, takes back the download only it asked for. A song already on its
 * way, or in the Library, isn't queued again (`downloadStarredSongs`). Run after a pull that
 * changed the stars or the missing songs, and once as Wave starts; one run at a time.
 */
export const downloadSyncedStars = (): Promise<void> => {
  syncing = syncing
    .then(async () => {
      const [starred, missing] = await Promise.all([
        currentFavoriteIds(),
        appRuntime
          // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
          .runPromise(LibraryStore.use((store) => store.missingSongs()))
          .then((tracks) => tracks.map((track) => track.id)),
      ]);
      const { download, cancel, seen } = syncedStarDownloads({ starred, missing }, seenStars.get());
      seenStars.set(seen);
      downloadStarredSongs([], download);
      cancelUnstarredDownloads([], cancel);
    })
    .catch(() => undefined);
  return syncing;
};
