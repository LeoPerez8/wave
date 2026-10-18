import type { SpotifyAccountAnswer } from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { appRuntime } from "@/library/runtime";

import { Spotify, type SpotifyError } from "./Spotify";

/**
 * Runs a Spotify request ([use] on the `Spotify` service) on the app runtime,
 * resolving its answer or why there wasn't one; it never rejects. The one way
 * screens and flows ask Spotify. (Kept apart from `Spotify.ts`, which the
 * runtime itself imports.)
 */
export const askSpotify = <A>(
  use: (spotify: Spotify["Service"]) => Effect.Effect<A, SpotifyError>,
): Promise<Result.Result<A, SpotifyError>> =>
  appRuntime.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const spotify = yield* Spotify;
        return yield* use(spotify);
      }),
    ),
  );

/** [use]'s query `data`, or why it didn't answer, as Core's account reads take it. */
export const askSpotifyAccount = async (
  use: (spotify: Spotify["Service"]) => Effect.Effect<unknown, SpotifyError>,
): Promise<SpotifyAccountAnswer> => {
  const result = await askSpotify(use);
  return Result.isSuccess(result)
    ? { ok: true, data: result.success }
    : { ok: false, reason: result.failure.reason };
};

/** [use]'s answer; rejects with its `SpotifyError` when there wasn't one. */
export const askSpotifyOrFail = async <A>(
  use: (spotify: Spotify["Service"]) => Effect.Effect<A, SpotifyError>,
): Promise<A> => {
  const result = await askSpotify(use);
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
};
