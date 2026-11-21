import {
  followFeed,
  followReleasesToSearch,
  homeFollowCards,
  boundHomeFollowSnapshot,
  type HomeFollowSnapshot,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { FollowStore } from "./followStore.ts";

/** Read both the next opening and this visit from the same saved feed. */
export const readHomeFollowSnapshot = <E>(
  store: Pick<
    FollowStore<E>,
    "listFollows" | "followReleaseCache" | "followShowCache" | "followReleaseListening"
  >,
  country: string,
  now: number,
  admitted?: HomeFollowSnapshot,
) =>
  Effect.gen(function* () {
    const follows = yield* store.listFollows;
    const releases = yield* store.followReleaseCache;
    const shows = yield* store.followShowCache;
    const raw = {
      follows,
      releases: releases.artists.flatMap((a) => a.releases),
      shows: shows.artists.flatMap((a) => a.shows),
      country,
    };
    const options = { now, hidden: releases.hidden };
    const current = homeFollowCards(raw, options);
    const visit = homeFollowCards(raw, { ...options, admitted });
    // Unmatched releases too: only the listening read knows which are in the Library.
    const unmatched = followReleasesToSearch({ ...raw, ...options, countedPlays: [] });
    const candidates = [
      ...new Map(
        [...current.releaseCards, ...visit.releaseCards, ...unmatched].map((r) => [r.key, r]),
      ).values(),
    ];
    const listening = yield* store.followReleaseListening(candidates);
    const source = { ...raw, releases: listening.releases };
    const eligibility = { ...options, countedPlays: listening.countedPlays };
    const feed = followFeed({ ...source, ...eligibility });
    const value = { follows, releases: feed.releaseCards, shows: feed.showCards, country };
    const bounded = boundHomeFollowSnapshot(value);
    if (admitted === undefined) return { known: bounded, visit: bounded };
    const cards = homeFollowCards(source, { ...eligibility, admitted });
    return {
      known: bounded,
      visit: {
        follows: admitted.follows,
        releases: cards.releaseCards,
        shows: cards.showCards,
        country,
      },
    };
  });
