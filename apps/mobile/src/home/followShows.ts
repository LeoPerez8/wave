import {
  checkDue,
  followFeed,
  formatDate,
  type FollowCheckContext,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { LibraryStore } from "@/library/LibraryStore";
import { followedArtistsEnabled } from "@/settings/followedArtists";
import { currentFollowCountry } from "@/settings/followCountry";
import { ticketmasterKey, showsNotificationsEnabled } from "@/library/showNotifications";
import { WaveNative, online } from "@/native/waveNative";
import { currentLocalisation } from "@/localisation/localisation";
import { settledTurnEffect } from "@/lib/backgroundWork";
import { checkArtistShows, type TicketmasterPath } from "./showsCheck";
const allowed = (country: string) =>
  ticketmasterKey !== "" && followedArtistsEnabled() && country === currentFollowCountry();
/** One Ticketmaster call; offline it fails without asking. */
const request = (path: TicketmasterPath, params: Record<string, string>) =>
  Effect.tryPromise(async (signal) => {
    if (!online()) throw new Error("Offline");
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
/** Shared by Home, artist pages and the daily background task (`followCheckTask.ts`). */
export const checkFollowShows = (context: FollowCheckContext = "home") =>
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
              if (!allowed(country)) return;
              const previous = cache.artists.find((a) => a.key === follow.key);
              if (
                previous?.country === country &&
                !checkDue(previous.checkedAt, Date.now(), context)
              )
                continue;
              yield* Effect.gen(function* () {
                const found = yield* checkArtistShows(
                  {
                    key: follow.key,
                    name: follow.name,
                    attractionId: previous?.attractionId ?? null,
                  },
                  country,
                  {
                    request: (path, params) =>
                      Effect.gen(function* () {
                        yield* settledTurnEffect;
                        if (!allowed(country)) return yield* Effect.fail(new Error("Not allowed"));
                        return yield* request(path, params);
                      }),
                    keepAttraction: (attractionId) =>
                      store.saveFollowShows({
                        key: follow.key,
                        attractionId,
                        country,
                        shows: previous?.country === country ? previous.shows : [],
                        checkedAt: 0,
                      }),
                  },
                );
                if (found === null) return;
                const { attractionId, shows } = found;
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
