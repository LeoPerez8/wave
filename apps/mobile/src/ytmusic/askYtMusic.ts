import type { SearchAsker, YtAlbumSong, YtSongSearch } from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { online } from "@/native/waveNative";
import { artistOpeningRequest } from "./artistOpeningRequest";
import { appRuntime } from "@/library/runtime";

import { logSearchFailure, searchTurn } from "./searchAllowance";
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

/**
 * One YouTube Music Songs search for [query] once [asker]'s turn in the shared
 * search allowance comes (`searchTurn`); a failure is an answer too, and is
 * logged. Null when [signal] gave the turn up first. Never rejects.
 */
export const searchSongsInTurn = async (
  asker: SearchAsker,
  query: string,
  signal?: AbortSignal,
): Promise<YtSongSearch<YtAlbumSong> | null> => {
  if (signal?.aborted) return null;
  if (!online()) return { ok: false, reason: "offline" };
  if (!(await searchTurn(asker, signal))) return null;
  let answer: YtSongSearch<YtAlbumSong>;
  try {
    const result = await askYtMusic(
      (ytMusic) => artistOpeningRequest(online, ytMusic.searchSongs(query)),
      signal,
    );
    answer = Result.isFailure(result)
      ? { ok: false, reason: result.failure.reason }
      : { ok: true, songs: result.success.songs };
  } catch {
    if (signal?.aborted) return null;
    answer = { ok: false, reason: "failed" };
  }
  if (!answer.ok) logSearchFailure(asker, query, answer.reason);
  return answer;
};
