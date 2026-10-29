import { ticketmasterAttraction, ticketmasterShows, type FollowShow } from "@wave/core";
import * as Effect from "effect/Effect";

export type TicketmasterPath = "attractions" | "events";

/**
 * One shows-level artist's check: the attraction search only while no id is
 * kept, then one events page of 200 in [country]. So a check costs at most two
 * calls, and one once [keepAttraction] has saved the id. Null when there is no
 * matching attraction or the answer can't be read; a refused request fails.
 */
export const checkArtistShows = <E, K>(
  artist: { readonly key: string; readonly name: string; readonly attractionId: string | null },
  country: string,
  ticketmaster: {
    readonly request: (
      path: TicketmasterPath,
      params: Record<string, string>,
    ) => Effect.Effect<unknown, E>;
    readonly keepAttraction: (attractionId: string) => Effect.Effect<void, K>;
  },
): Effect.Effect<{ attractionId: string; shows: FollowShow[] } | null, E | K> =>
  Effect.gen(function* () {
    let attractionId = artist.attractionId;
    if (attractionId === null) {
      attractionId = ticketmasterAttraction(
        yield* ticketmaster.request("attractions", {
          keyword: artist.name,
          classificationName: "music",
          size: "200",
        }),
        artist.name,
      );
      if (attractionId === null) return null;
      // Keep identity even if the events request fails.
      yield* ticketmaster.keepAttraction(attractionId);
    }
    const shows = ticketmasterShows(
      yield* ticketmaster.request("events", {
        attractionId,
        countryCode: country,
        sort: "date,asc",
        size: "200",
      }),
      artist.key,
    );
    return shows === null ? null : { attractionId, shows };
  });
