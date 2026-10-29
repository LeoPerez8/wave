import {
  checkDue,
  followFeed,
  ticketmasterAttraction,
  ticketmasterShows,
  formatDate,
  type FollowShow,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { LibraryStore } from "@/library/LibraryStore";
import { followedArtistsEnabled } from "@/settings/followedArtists";
import { currentFollowCountry } from "@/settings/followCountry";
import { ticketmasterKey, showsNotificationsEnabled } from "@/library/showNotifications";
import { WaveNative } from "@/native/waveNative";
import { currentLocalisation } from "@/localisation/localisation";
import { settledTurnEffect } from "@/lib/backgroundWork";
const allowed = (country: string) =>
  ticketmasterKey !== "" && followedArtistsEnabled() && country === currentFollowCountry();
const request = (path: string, params: Record<string, string>) =>
  Effect.tryPromise(async (signal) => {
    const query = Object.entries({ ...params, apikey: ticketmasterKey })
      .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
      .join("&");
    const response = await fetch(
      `https://app.ticketmaster.com/discovery/v2/${path}.json?${query}`,
      { signal },
    );
    if (!response.ok) throw new Error("Ticketmaster did not answer");
    return (await response.json()) as unknown;
  }).pipe(Effect.timeout("20 seconds"), Effect.delay("250 millis"));
let checking = false;
const savedListeners = new Set<() => void>();
/** Runs [listener] each time a check saves an artist's shows; returns the unsubscribe. */
export const subscribeFollowShows = (listener: () => void): (() => void) => {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
};
/** Shared by Home and artist pages; #810 can select the daily interval. */
export const checkFollowShows = (context: "home" | "background" = "home") =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      if (checking) return false;
      checking = true;
      return true;
    }),
    (acquired) =>
      !acquired
        ? Effect.void
        : Effect.gen(function* () {
            const country = currentFollowCountry();
            if (!country || !allowed(country)) return;
            const store = yield* LibraryStore;
            const follows = yield* store.listFollows;
            const cache = yield* store.followShowCache;
            for (const follow of follows) {
              if (follow.level !== "shows") continue;
              yield* settledTurnEffect;
              if (!allowed(country)) return;
              const previous = cache.artists.find((a) => a.key === follow.key);
              if (
                previous?.country === country &&
                !checkDue(previous.checkedAt, Date.now(), context)
              )
                continue;
              yield* Effect.gen(function* () {
                let attractionId = previous?.attractionId ?? null;
                if (attractionId === null) {
                  attractionId = ticketmasterAttraction(
                    yield* request("attractions", {
                      keyword: follow.name,
                      classificationName: "music",
                      size: "200",
                    }),
                    follow.name,
                  );
                  if (attractionId === null) return;
                  // Keep identity even if the events request fails.
                  yield* store.saveFollowShows({
                    key: follow.key,
                    attractionId,
                    country,
                    shows: previous?.country === country ? previous.shows : [],
                    checkedAt: 0,
                  });
                }
                const shows: FollowShow[] = [];
                for (let page = 0; page < 5; page++) {
                  yield* settledTurnEffect;
                  if (!allowed(country)) return;
                  const response = yield* request("events", {
                    attractionId,
                    countryCode: country,
                    sort: "date,asc",
                    size: "200",
                    page: String(page),
                  });
                  const parsed = ticketmasterShows(response, follow.key);
                  if (parsed === null) return;
                  shows.push(...parsed);
                  const pageInfo = response as { page?: { totalPages?: number } };
                  if (
                    pageInfo.page?.totalPages !== undefined &&
                    page + 1 >= pageInfo.page.totalPages
                  )
                    break;
                  if (parsed.length === 0 && pageInfo.page?.totalPages === undefined) break;
                }
                if (!allowed(country)) return;
                const current = yield* store.getFollow(follow.name);
                if (current?.level !== "shows" || current.followedAt !== follow.followedAt) return;
                yield* store.saveFollowShows({
                  key: follow.key,
                  attractionId,
                  country,
                  shows,
                  checkedAt: Date.now(),
                });
                yield* Effect.sync(() => {
                  for (const listener of savedListeners) listener();
                });
                const latest = yield* store.followShowCache;
                const feed = followFeed({
                  follows: [current],
                  releases: [],
                  hidden: [],
                  countedPlays: [],
                  shows,
                  notified: latest.notified,
                  country,
                  now: Date.now(),
                });
                for (const show of feed.toNotify) {
                  if (!allowed(country) || !showsNotificationsEnabled()) return;
                  const { language, strings } = currentLocalisation();
                  if (yield* store.markShowNotified(show.id))
                    yield* Effect.sync(() =>
                      WaveNative.postShowNotification?.(
                        show.id,
                        current.name,
                        `${formatDate(language, new Date(show.startsAt))}, ${show.city}, ${show.venue}`,
                        show.ticketUrl,
                        strings.shows.channel,
                      ),
                    );
                }
              }).pipe(Effect.ignore);
            }
          }),
    (acquired) =>
      Effect.sync(() => {
        if (acquired) checking = false;
      }),
  );
