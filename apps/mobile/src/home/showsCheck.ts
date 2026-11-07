import {
  ticketmasterAttraction,
  ticketmasterAttractionsPath,
  ticketmasterEventsPath,
  ticketmasterShows,
  type FollowShow,
} from "@wave/core";
import * as Effect from "effect/Effect";

/**
 * One shows-level artist's check: the attraction search only while no id is
 * kept, then its events in [country] (a page of 200), each a request to the
 * sync service's Ticketmaster routes (Core's `ticketmasterProxy.ts`). So a
 * check costs at most two calls, and one once [keepAttraction] has saved the
 * id. Null when there is no matching attraction or the answer can't be read;
 * a refused request fails.
 */
export const checkArtistShows = <E, K>(
  artist: { readonly key: string; readonly name: string; readonly attractionId: string | null },
  country: string,
  ticketmaster: {
    /** GETs the sync service's [path] and gives Ticketmaster's JSON. */
    readonly request: (path: string) => Effect.Effect<unknown, E>;
    readonly keepAttraction: (attractionId: string) => Effect.Effect<void, K>;
  },
): Effect.Effect<{ attractionId: string; shows: FollowShow[] } | null, E | K> =>
  Effect.gen(function* () {
    let attractionId = artist.attractionId;
    if (attractionId === null) {
      attractionId = ticketmasterAttraction(
        yield* ticketmaster.request(ticketmasterAttractionsPath(artist.name)),
        artist.name,
      );
      if (attractionId === null) return null;
      // Keep identity even if the events request fails.
      yield* ticketmaster.keepAttraction(attractionId);
    }
    const shows = ticketmasterShows(
      yield* ticketmaster.request(ticketmasterEventsPath(attractionId, country)),
      artist.key,
    );
    return shows === null ? null : { attractionId, shows };
  });
