import type { YtQuietReason, YtSession } from "@wave/core";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

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
 */
export class YtMusic extends Context.Service<
  YtMusic,
  {
    /** Songs on YT Music for [query]. */
    readonly searchSongs: (query: string) => Effect.Effect<NativeYtSearchPage, YtMusicError>;
    /** The saved YouTube session (whose account, never its cookie), without asking YouTube. */
    readonly session: Effect.Effect<YtSession>;
    /** The session after asking YouTube whose it is; as it was when there's no answer. */
    readonly checkSession: Effect.Effect<YtSession>;
    /**
     * Opens Google's sign-in page: the signed-in session, or null when the
     * owner backs out. Every YT Music request goes out as the account after.
     */
    readonly signIn: Effect.Effect<YtSession | null, YtMusicError>;
    /** Forgets the session and the sign-in page's cookies; requests go out signed out. */
    readonly signOut: Effect.Effect<YtSession>;
  }
>()("@wave/mobile/ytmusic/YtMusic") {}

// Reading, checking or forgetting the session doesn't fail (no answer leaves it
// as it was), so a rejection there is a defect.
export const layer = Layer.succeed(YtMusic, {
  searchSongs: (query) =>
    Effect.tryPromise({ try: () => WaveYtMusic.searchSongs(query), catch: fromNative }),
  session: Effect.promise(() => WaveYtMusic.session()),
  checkSession: Effect.promise(() => WaveYtMusic.checkSession()),
  signIn: Effect.tryPromise({ try: () => WaveYtMusic.signIn(), catch: fromNative }),
  signOut: Effect.promise(() => WaveYtMusic.signOut()),
});
