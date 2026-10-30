import { followFeed, type FollowShow, type FollowedArtist } from "@wave/core";
import * as Effect from "effect/Effect";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { everyWhileInSight } from "@/lib/sight";
import { useScreenSight } from "@/lib/screenSight";

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
 * [follows]' upcoming shows in [country] while [watching]: what the saved
 * checks hold, then a check when one is due, read again whenever a check
 * saves. A passed show leaves within a minute while the screen is in sight;
 * out of sight nothing is read, and coming back reads once.
 */
export const useShowCards = (
  follows: readonly FollowedArtist[],
  country: string,
  watching: boolean,
): readonly FollowShow[] => {
  const sight = useScreenSight();
  const [cards, setCards] = useState<readonly FollowShow[]>([]);
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
      const saved = subscribeFollowShows(() => {
        if (sight.visible()) void read();
      });
      const timed = everyWhileInSight(sight, 60_000, () => void read());
      return () => {
        controller.abort();
        saved();
        timed();
      };
    }, [watching, follows, country, sight]),
  );
  return watching ? cards : [];
};
