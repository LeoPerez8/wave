import { recordingSearch } from "./recordingSearch";
import type { ServiceTrack } from "@wave/core";
import type { SearchAsker, YtAlbumSong, YtSongSearch } from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { online } from "@/native/waveNative";
import { appRuntime } from "@/library/runtime";

import { YtMusic } from "./YtMusic";

/**
 * Runs a YT Music request ([use] on the `YtMusic` service) on the app runtime,
 * resolving its answer or why there wasn't one; interruption rejects so the
 * caller can discard a page that was left. The one way
 * screens and hooks ask YT Music. (Kept apart from `YtMusic.ts`, which the
 * runtime itself imports.)
 */
export const askYtMusic = <A, E>(
  use: (ytMusic: YtMusic["Service"]) => Effect.Effect<A, E>,
  signal?: AbortSignal,
): Promise<Result.Result<A, E>> =>
  appRuntime.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const ytMusic = yield* YtMusic;
        return yield* use(ytMusic);
      }),
    ),
    { signal },
  );

/** A recording lookup, including the official-video fallback, in the shared allowance. */
export const searchRecordingInTurn = async (
  asker: SearchAsker,
  song: ServiceTrack,
  signal?: AbortSignal,
  unknownLength = false,
): Promise<YtSongSearch<YtAlbumSong> | null> => {
  if (signal?.aborted) return null;
  if (!online()) return { ok: false, reason: "offline" };
  try {
    const result = await askYtMusic(
      (ytMusic) =>
        Effect.provideService(recordingSearch(asker, song, unknownLength), YtMusic, ytMusic),
      signal,
    );
    return Result.isFailure(result)
      ? { ok: false, reason: result.failure.reason }
      : { ok: true, songs: result.success.songs };
  } catch {
    return signal?.aborted ? null : { ok: false, reason: "failed" };
  }
};
