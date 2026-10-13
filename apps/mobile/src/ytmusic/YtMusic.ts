import type { YtQuietReason } from "@wave/core";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { IndexedArtwork } from "@/library/LibraryStore";
import { toIndexedArtwork } from "@/library/LibraryScan";
import { WaveYtMusic, ytErrorCode, type NativeYtSearchPage } from "@/native/waveYtMusic";

/**
 * A YT Music request that didn't get an answer: no network, YouTube failed
 * or answered with something unreadable, or YT Music is off in Settings.
 */
export class YtMusicError extends Data.TaggedError("YtMusicError")<{
  readonly reason: YtQuietReason | "disabled";
}> {}

const fromNative = (error: unknown): YtMusicError => {
  const code = ytErrorCode(error);
  return new YtMusicError({
    reason:
      code === "ERR_YT_OFFLINE" ? "offline" : code === "ERR_YT_DISABLED" ? "disabled" : "failed",
  });
};

/**
 * YouTube Music as a typed service, over the native `WaveYtMusic` module.
 * Search, playback (#109), downloads (#110) and Discover (#111) go through it.
 * Playing itself is the native player's: it streams the queue's `yt:` items.
 */
export class YtMusic extends Context.Service<
  YtMusic,
  {
    /** Songs on YT Music for [query]. */
    readonly searchSongs: (query: string) => Effect.Effect<NativeYtSearchPage, YtMusicError>;
    /** Caches a song's cover from [url] beside the Library's artwork, with its palette. */
    readonly cacheArtwork: (url: string) => Effect.Effect<IndexedArtwork, YtMusicError>;
  }
>()("@wave/mobile/ytmusic/YtMusic") {}

export const layer = Layer.succeed(YtMusic, {
  searchSongs: (query) =>
    Effect.tryPromise({ try: () => WaveYtMusic.searchSongs(query), catch: fromNative }),
  cacheArtwork: (url) =>
    Effect.tryPromise({ try: () => WaveYtMusic.cacheArtwork(url), catch: fromNative }).pipe(
      Effect.map(toIndexedArtwork),
    ),
});
