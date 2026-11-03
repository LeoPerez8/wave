import {
  searchRecording,
  spotifySearchQuery,
  type SearchAsker,
  type SpotifySong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { YtMusic, YtMusicError } from "./YtMusic";
import { withSearchTurn } from "./searchAllowance";

/** Each request takes its own turn; Core owns the fallback and recording checks. */
export const recordingSearch = (asker: SearchAsker, song: SpotifySong, unknownLength = false) =>
  Effect.gen(function* () {
    const yt = yield* YtMusic;
    const query = spotifySearchQuery(song);
    const answer = yield* Effect.promise((signal) =>
      searchRecording(
        song,
        async (kind) => {
          const request = kind === "songs" ? yt.searchSongs(query) : yt.searchVideos(query);
          return Effect.runPromise(
            withSearchTurn(asker, query, request).pipe(
              Effect.map((page) => ({ ok: true, songs: page.songs }) as const),
              Effect.catch((error) => Effect.succeed({ ok: false, reason: error.reason } as const)),
            ),
            { signal },
          );
        },
        unknownLength,
      ),
    );
    if (answer === null) return yield* new YtMusicError({ reason: "failed" });
    if (!answer.ok) return yield* new YtMusicError({ reason: answer.reason });
    return { songs: answer.songs, continuation: null };
  });
