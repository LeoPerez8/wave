import { pendingFavorite } from "@wave/core";

import type { NativeYtSong } from "@/native/waveYtMusic";
import type { FindInLibrary } from "@/ytmusic/libraryFinder";
import { cancelUnstarredDownloads, downloadStarredSongs } from "@/ytmusic/YtDownloads";

import { setFavorites, setPendingFavorites } from "./favorites";
import { songHasFile, type SongRow } from "./LibraryStore";

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
  return Promise.all([stars, pending]).then(() => undefined);
};
