import {
  followFeed,
  parseHomeFollowSnapshot,
  storedHomeFollowSnapshot,
  type HomeFollowSnapshot,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { persistedSetting } from "@/lib/persistedSetting";
import { currentFollowCountry } from "@/settings/followCountry";

export const knownHomeFollow = persistedSetting<HomeFollowSnapshot | undefined>({
  key: "home.followCards",
  read: parseHomeFollowSnapshot,
  write: (value) => (value === undefined ? null : storedHomeFollowSnapshot(value)),
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
});
let reading: Promise<HomeFollowSnapshot> | undefined;
/** One shared database read; failures leave the previous phone-local answer intact. */
export const readHomeFollow = (): Promise<HomeFollowSnapshot> => {
  reading ??= appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        const follows = yield* store.listFollows;
        const releases = yield* store.followReleaseCache;
        const shows = yield* store.followShowCache;
        const now = Date.now();
        const eligible = followFeed({
          follows,
          releases: releases.artists.flatMap((a) => a.releases),
          hidden: releases.hidden,
          countedPlays: [],
          now,
        }).releaseCards;
        const listening = yield* store.followReleaseListening(eligible);
        const country = currentFollowCountry();
        const feed = followFeed({
          follows,
          ...listening,
          hidden: releases.hidden,
          shows: shows.artists.flatMap((a) => a.shows),
          country,
          now,
        });
        const value = { follows, releases: feed.releaseCards, shows: feed.showCards, country };
        const bounded = parseHomeFollowSnapshot(storedHomeFollowSnapshot(value))!;
        knownHomeFollow.set(bounded);
        return bounded;
      }),
    )
    .finally(() => {
      reading = undefined;
    });
  return reading;
};
