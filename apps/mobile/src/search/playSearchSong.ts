/**
 * A song tapped in Search plays what Core's `searchSongTap` decides: with
 * YouTube Music on, the song with related songs after it (a faithful Magic
 * Queue session Up Next heads "Related · from <song>"), the song alone with
 * it off, or its download when the Library song has no file here. Never the
 * other results.
 */
import { searchSongTap, type QueueContext } from "@wave/core";

import { playSongs } from "@/playback/actions";
import { startMagicQueue, startStreamedMagicQueue } from "@/playback/MagicQueue";
import { runSongPlay } from "@/playback/magicQueueStart";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { currentLibraryFinder } from "@/ytmusic/libraryFinder";
import { downloadMissingSongs } from "@/ytmusic/YtDownloads";

import type { ResultSong } from "./rows";

/** A song played alone from Search still says it came from Search. */
const SEARCH_CONTEXT: QueueContext = { kind: "search", id: null };

/** A tap's session keeps to the song's genres and is named Related, not Magic Queue. */
const SEARCH_TAP = { faithful: true, plainPlay: true };

/** Plays what tapping [song] in Search plays (Core's `searchSongTap`). */
export const playSearchSong = async (song: ResultSong): Promise<void> => {
  // A streamed song the Library has as a file starts from the file; unread, from the stream.
  const find = song.source === "stream" ? await currentLibraryFinder().catch(() => null) : null;
  const found = song.source === "stream" && find !== null ? find(song.song) : null;
  const tap = searchSongTap(song, { ytMusic: ytMusicEnabled(), found });
  switch (tap.play) {
    case "download":
      downloadMissingSongs([tap.track.id]);
      return;
    case "alone":
      await playSongs([tap.track], 0, SEARCH_CONTEXT);
      return;
    case "magicQueue":
      runSongPlay(
        tap.from === "library"
          ? tap.song === undefined
            ? startMagicQueue(tap.seed, [tap.track], [], undefined, SEARCH_TAP)
            : startStreamedMagicQueue(tap.song, SEARCH_TAP, tap.track)
          : startStreamedMagicQueue(tap.song, SEARCH_TAP),
      );
      return;
    case "nothing":
      return;
  }
};
