/**
 * Discover (docs/spec.md, "YT Music"): the signed-in account's YouTube Music
 * recommendations. What shows and when YouTube is asked are Core's
 * (`stepDiscover`, `discoverShouldAsk`, `discoverView`); the native module
 * reads the home's shelves.
 */
import {
  DISCOVER_START,
  discoverShouldAsk,
  discoverView,
  stepDiscover,
  type DiscoverState,
  type DiscoverView,
  type YtSession,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import type { SongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { WaveYtMusic, type NativeYtSong } from "@/native/waveYtMusic";
import { useYtMusicEnabled } from "@/settings/ytMusic";

import { useLibraryFinder } from "./libraryFinder";
import { YtMusic, type YtMusicError } from "./YtMusic";

/** Runs a YT Music request, resolving its answer or why there wasn't one. */
export const askYtMusic = <A>(
  use: (ytMusic: YtMusic["Service"]) => Effect.Effect<A, YtMusicError>,
) =>
  appRuntime.runPromise(
    Effect.result(
      Effect.gen(function* () {
        const ytMusic = yield* YtMusic;
        return yield* use(ytMusic);
      }),
    ),
  );

/**
 * Whether a YouTube account is signed in (an expired session isn't), or null
 * until the native client says; follows sign-in, sign-out and expiry.
 */
const useYtSignedIn = (): boolean | null => {
  const [session, setSession] = useState<YtSession | null>(null);
  useEffect(() => {
    let current = true;
    const subscription = WaveYtMusic.addListener("onSessionChanged", setSession);
    void appRuntime
      .runPromise(
        Effect.gen(function* () {
          const ytMusic = yield* YtMusic;
          return yield* ytMusic.session;
        }),
      )
      .then((saved) => {
        if (current) setSession(saved);
      });
    return () => {
      current = false;
      subscription.remove();
    };
  }, []);
  return session === null ? null : session.status === "signedIn";
};

export interface Discover {
  readonly view: DiscoverView<NativeYtSong, SongRow>;
  /** Asking again while the shelves stay up (pull to refresh). */
  readonly refreshing: boolean;
  readonly refresh: () => void;
}

/**
 * The Discover screen: YouTube Music's home for the signed-in account, asked
 * for when the screen opens and again when pulled; signed out, YT Music off
 * or offline, Core's view says what shows instead. Songs the Library has
 * play its files.
 */
export const useDiscover = (): Discover => {
  const enabled = useYtMusicEnabled();
  const signedIn = useYtSignedIn();
  const find = useLibraryFinder();
  const [state, dispatch] = useReducer(
    stepDiscover<NativeYtSong>,
    DISCOVER_START as DiscoverState<NativeYtSong>,
  );
  const context = useMemo(() => ({ enabled, signedIn, find }), [enabled, signedIn, find]);

  const ask = useCallback(() => {
    dispatch({ type: "requested" });
  }, []);

  // Each question goes out once its request number is known.
  const { request, loading } = state;
  useEffect(() => {
    if (!loading) return;
    void askYtMusic((ytMusic) => ytMusic.home).then((result) => {
      if (Result.isSuccess(result)) dispatch({ type: "loaded", request, home: result.success });
      // Turned off meanwhile: Discover is off already.
      else if (result.failure.reason !== "disabled")
        dispatch({ type: "failed", request, reason: result.failure.reason });
    });
  }, [request, loading]);

  useEffect(() => {
    if (signedIn === false) dispatch({ type: "signedOut" });
  }, [signedIn]);

  const shouldAsk = discoverShouldAsk(state, context);
  useEffect(() => {
    if (shouldAsk) ask();
  }, [shouldAsk, ask]);

  const view = useMemo(() => discoverView(state, context), [state, context]);
  const refresh = useCallback(() => {
    if (enabled && signedIn === true) ask();
  }, [ask, enabled, signedIn]);
  return { view, refreshing: state.loading && state.home !== null, refresh };
};
