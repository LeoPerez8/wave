import { readHomeFollow } from "./knownHomeFollow";
import { checkFollowShows } from "./followShows";
import { type FollowCheckContext } from "@wave/core";
import { followReleasesCheck } from "@wave/client/follows/followReleasesCheck";
import * as Effect from "effect/Effect";
import { waveSignedIn } from "@/sync/waveSignedIn";
import { LibraryStore } from "@/library/LibraryStore";

import { appRuntime } from "@/library/runtime";
import { freeTurnEffect, settledTurnEffect } from "@/lib/backgroundWork";
import { namedWork } from "@/lib/stepped";
import { dontPlayExplicit } from "@/settings/dontPlayExplicit";
import { followedArtistsEnabled } from "@/settings/followedArtists";
import { currentFollowCountry } from "@/settings/followCountry";
import { showsConfigured } from "@/library/showNotifications";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import { YtMusic, type YtMusicError } from "@/ytmusic/YtMusic";

/** The shared Follows check (`@wave/client`) over the phone's settings. */
const check = followReleasesCheck<YtMusicError, LibraryStore>({
  enabled: followedArtistsEnabled,
  ytEnabled: ytMusicEnabled,
  blockExplicit: dontPlayExplicit,
  offline: (error) => error.reason === "offline",
  country: currentFollowCountry,
  showsCheckable: async () => showsConfigured && (await waveSignedIn()),
  checkShows: (context) => checkFollowShows(context, false),
  settle: settledTurnEffect,
  answered: freeTurnEffect,
  // Its Albums searches and album pages share the search allowance, last in line.
  ytTurn: (query, read) => withSearchTurn("newReleases", query, read),
});

/**
 * The Follows check, on Home opening and in the daily background task (`followCheckTask.ts`);
 * the context picks the due window.
 */
export const checkFollowReleases = (
  youtubeEnabled = ytMusicEnabled(),
  context: FollowCheckContext = "home",
  refreshCache = true,
) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const yt = yield* YtMusic;
    return yield* check(store, yt, context, youtubeEnabled);
  }).pipe(
    Effect.tap((changed) =>
      changed && refreshCache && followedArtistsEnabled()
        ? Effect.tryPromise(readHomeFollow).pipe(Effect.ignore)
        : Effect.void,
    ),
    namedWork("new-release check"),
  );

export const hideRelease = (key: string) =>
  appRuntime.runPromise(Effect.flatMap(LibraryStore, (s) => s.hideFollowRelease(key)));
