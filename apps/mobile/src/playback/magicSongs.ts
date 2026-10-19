import { libraryTrackIds, magicLibrarySongs, parseTrackId, type MagicSong } from "@wave/core";
import * as Effect from "effect/Effect";

import { LibraryStore } from "@/library/LibraryStore";

import { magicStreamedSong } from "./magicQueueRadio";
import { queueTracks } from "./queueTracks";

/**
 * The songs [trackIds] are, as the Magic Queue and the taste profile weigh
 * them (Core's `MagicSong`): the Library's that can play, by their artists
 * and genre family, and the YouTube Music songs the queue knows, by their
 * artists (`magicStreamedSong`). Those it can't tell are left out.
 */
export const magicSongsOf = (trackIds: readonly string[]) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const ids = libraryTrackIds(trackIds);
    const library = ids.length === 0 ? [] : yield* store.songsByIds(ids);
    const toMagicSong = magicLibrarySongs(library.length === 0 ? [] : yield* store.listArtists);
    const known = queueTracks.get();
    const streamed = trackIds.flatMap((id) => {
      const track = known.get(id);
      return track === undefined || parseTrackId(id)?.kind !== "yt"
        ? []
        : [magicStreamedSong({ id, artists: track.artists ?? [track.artist] })];
    });
    return [...library.map(toMagicSong), ...streamed] satisfies MagicSong[];
  });
