import {
  followFeed,
  homeFollowCards,
  parseHomeFollowSnapshot,
  storedHomeFollowSnapshot,
  type HomeFollowSnapshot,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore } from "../library/LibraryStore.ts";

/** Read both the next opening and this visit from the same saved feed. */
export const readHomeFollowSnapshot = (
  store: LibraryStore["Service"],
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
    const candidates = [
      ...new Map([...current.releaseCards, ...visit.releaseCards].map((r) => [r.key, r])).values(),
    ];
    const listening = yield* store.followReleaseListening(candidates);
    const source = { ...raw, releases: listening.releases };
    const eligibility = { ...options, countedPlays: listening.countedPlays };
    const feed = followFeed({ ...source, ...eligibility });
    const value = { follows, releases: feed.releaseCards, shows: feed.showCards, country };
    const bounded = parseHomeFollowSnapshot(storedHomeFollowSnapshot(value))!;
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
