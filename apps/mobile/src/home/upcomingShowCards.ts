import { followFeed, type FollowShow, type FollowedArtist } from "@wave/core";
import * as Effect from "effect/Effect";
import { useCallback, useState } from "react";
import { AppState } from "react-native";
import { useFocusEffect } from "expo-router";

import { useFollows } from "@/library/follows";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { currentFollowCountry, followCountry } from "@/settings/followCountry";
import { useFollowedArtistsEnabled } from "@/settings/followedArtists";

import { checkFollowShows, subscribeFollowShows } from "./followShows";

/** Every shows-level artist's upcoming shows in [country], soonest first, from the saved checks. */
const readShowFeed = (follows: readonly FollowedArtist[], country: string) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const cache = yield* store.followShowCache;
    return followFeed({
      follows,
      shows: cache.artists.flatMap((a) => a.shows),
      country,
      now: Date.now(),
      releases: [],
      hidden: [],
      countedPlays: [],
    }).showCards;
  });

/**
 * Home's Upcoming Shows: what the saved checks hold, then a check when one is
 * due (Home's 12-hour window), read again whenever a check saves. A passed
 * show leaves within a minute, even on a Home left open. Empty with the
 * Followed artists switch off or no shows-level follow.
 */
export const useUpcomingShows = () => {
  const follows = useFollows();
  const enabled = useFollowedArtistsEnabled();
  followCountry.useValue();
  const country = currentFollowCountry();
  const [cards, setCards] = useState<readonly FollowShow[]>([]);
  const watching = enabled && country !== "" && follows.some((f) => f.level === "shows");

  useFocusEffect(
    useCallback(() => {
      if (!watching) {
        setCards([]);
        return;
      }
      const controller = new AbortController();
      const read = () =>
        appRuntime
          .runPromise(readShowFeed(follows, country), { signal: controller.signal })
          .then((value) => {
            if (!controller.signal.aborted) setCards(value);
          })
          .catch(() => {});
      void read().then(() =>
        appRuntime.runPromise(checkFollowShows(), { signal: controller.signal }).catch(() => {}),
      );
      const saved = subscribeFollowShows(() => void read());
      const active = AppState.addEventListener("change", (state) => {
        if (state === "active") void read();
      });
      const timer = setInterval(() => void read(), 60_000);
      return () => {
        controller.abort();
        saved();
        active.remove();
        clearInterval(timer);
      };
    }, [watching, follows, country]),
  );
  return { cards: watching ? cards : [], follows };
};
