import type { SpotifyAccountFailure } from "@wave/core";
import * as Data from "effect/Data";

/**
 * A Spotify request that didn't get an answer: no network, Spotify failed or
 * answered something unreadable, no session Spotify accepts, or Spotify
 * changed its web player so Wave needs an update (Core's `SpotifyAccountFailure`).
 */
export class SpotifyError extends Data.TaggedError("SpotifyError")<{
  readonly reason: SpotifyAccountFailure;
}> {}
