import {
  carouselPageSongs,
  MAGIC_QUEUE_PICKS,
  mostListenedRecently,
  recentPlaysWindow,
  type MagicQueueSeed,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore } from "../library/LibraryStore.ts";
import type { PlayableSongRow } from "@wave/client";

/** How many ranked songs are read at a time: the page, and room for a few that can't show. */
const BATCH = MAGIC_QUEUE_PICKS * 2;

/**
 * In your orbit's most listened recent songs at [now] (Core's
 * `mostListenedRecently` and `carouselPageSongs`): up to nine songs with the
 * most counted plays in the recent window, as the tiles the Magic Queue page
 * draws, or none when fewer than three can show. Read from the phone's play
 * history alone, with no network. A ranked song that can't start a Magic
 * Queue (a Library song without a file, a streamed one whose song wasn't
 * kept) is passed over for the next, as is an explicit streamed song while
 * [dontPlayExplicit] is on.
 */
export const readMostListenedRecently = (
  store: LibraryStore["Service"],
  now: number,
  dontPlayExplicit = false,
) =>
  Effect.gen(function* () {
    const ranked = mostListenedRecently(yield* store.songPlayTotals(recentPlaysWindow(now)));
    const seeds: MagicQueueSeed<PlayableSongRow>[] = [];
    for (let from = 0; from < ranked.length && seeds.length < MAGIC_QUEUE_PICKS; from += BATCH) {
      const batch = ranked.slice(from, from + BATCH);
      const files = yield* store.songsByIds(
        batch.flatMap((song) => (song.kind === "library" ? [song.id] : [])),
      );
      const videoIds = batch.flatMap((song) => (song.kind === "yt" ? [song.videoId] : []));
      const streams = videoIds.length === 0 ? null : yield* store.streamedSongsByIds(videoIds);
      const byId = new Map(files.map((song) => [song.id, song]));
      for (const song of batch) {
        if (song.kind === "library") {
          const file = byId.get(song.id);
          if (file !== undefined) seeds.push({ source: "library", song: file });
        } else {
          const stream = streams?.get(song.videoId);
          if (stream !== undefined && !(dontPlayExplicit && stream.explicit))
            seeds.push({ source: "stream", song: stream });
        }
      }
    }
    return carouselPageSongs(seeds);
  });
