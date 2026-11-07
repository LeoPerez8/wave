import { readHomeFollow } from "./knownHomeFollow";
import {
  dueShowChecks,
  followFeed,
  formatDate,
  showCheckDay,
  showChecksLeftToday,
  type FollowCheckContext,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { LibraryStore } from "@/library/LibraryStore";
import { followedArtistsEnabled } from "@/settings/followedArtists";
import { currentFollowCountry } from "@/settings/followCountry";
import { showsConfigured, showsNotificationsEnabled } from "@/library/showNotifications";
import { showChecksToday } from "@/library/showChecksToday";
import { WaveNative, online } from "@/native/waveNative";
import { waveAccountErrorCode } from "@/native/waveAccount";
import { askWaveService, WaveServiceRefusal } from "@/sync/askWaveService";
import { waveSignedIn } from "@/sync/waveSignedIn";
import { currentLocalisation } from "@/localisation/localisation";
import { settledTurnEffect } from "@/lib/backgroundWork";
import { checkArtistShows } from "./showsCheck";
const allowed = (country: string) =>
  showsConfigured && followedArtistsEnabled() && country === currentFollowCountry();
/**
 * A refusal that stops the whole check, so no other artist is asked: the
 * session is gone, or the service answered with a limit.
 */
class CheckStops extends Error {}
/**
 * One call to the sync service's Ticketmaster routes, which the native
 * module sends with the session JS never sees. The service's refusals (a
 * limit, Ticketmaster failing) fail too.
 */
const request = (path: string) =>
  Effect.tryPromise({
    try: () => askWaveService(path),
    catch: (cause) => {
      const code = waveAccountErrorCode(cause);
      if (code === "ERR_WAVE_SIGNED_OUT" || code === "ERR_WAVE_SESSION_ENDED")
        return new CheckStops();
      if (cause instanceof WaveServiceRefusal && cause.status === 429 && cause.limit !== null)
        return new CheckStops();
      return cause;
    },
  }).pipe(Effect.timeout("20 seconds"), Effect.delay("250 millis"));
/** Counts one more artist asked about today (UTC) toward the service's daily limit. */
const countShowCheck = Effect.sync(() => {
  const day = showCheckDay(Date.now());
  const asked = showChecksToday.get();
  showChecksToday.set({ day, count: asked?.day === day ? asked.count + 1 : 1 });
});
let checking = false;
const savedListeners = new Set<() => void>();
/** Runs [listener] each time a check saves an artist's shows; returns the unsubscribe. */
export const subscribeFollowShows = (listener: () => void): (() => void) => {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
};
/**
 * Shared by Home, artist pages and the daily background task
 * (`followCheckTask.ts`). Signed out it asks nothing; a session that ends
 * meanwhile or a limit the service answers stops it. Artists never checked
 * go first, then the oldest checks (Core's `dueShowChecks`), and it stops
 * without asking once today's artists reach the service's daily limit
 * (`showChecksLeftToday`).
 */
export const checkFollowShows = (context: FollowCheckContext = "home", refreshCache = true) =>
  Effect.suspend(() => {
    let changed = false;
    return Effect.acquireUseRelease(
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
              if (!(yield* Effect.promise(waveSignedIn))) return;
              let stops = false;
              const store = yield* LibraryStore;
              const follows = yield* store.listFollows;
              const cache = yield* store.followShowCache;
              const due = dueShowChecks({
                follows,
                showChecks: cache.artists,
                country,
                now: Date.now(),
                context,
              });
              for (const follow of due) {
                if (!allowed(country) || stops) return;
                if (showChecksLeftToday(showChecksToday.get(), Date.now()) === 0) return;
                const previous = cache.artists.find((a) => a.key === follow.key);
                let counted = false;
                yield* Effect.gen(function* () {
                  const found = yield* checkArtistShows(
                    {
                      key: follow.key,
                      name: follow.name,
                      attractionId: previous?.attractionId ?? null,
                    },
                    country,
                    {
                      request: (path) =>
                        Effect.gen(function* () {
                          yield* settledTurnEffect;
                          if (!allowed(country))
                            return yield* Effect.fail(new Error("Not allowed"));
                          // Offline it fails without asking, so it doesn't count.
                          if (!online()) return yield* Effect.fail(new Error("Offline"));
                          if (!counted) {
                            counted = true;
                            yield* countShowCheck;
                          }
                          return yield* request(path).pipe(
                            Effect.tapError((error) =>
                              Effect.sync(() => {
                                if (error instanceof CheckStops) stops = true;
                              }),
                            ),
                          );
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
                  if (current?.level !== "shows" || current.followedAt !== follow.followedAt)
                    return;
                  yield* store.saveFollowShows({
                    key: follow.key,
                    attractionId,
                    country,
                    shows,
                    checkedAt: Date.now(),
                  });
                  changed = true;
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
    ).pipe(
      Effect.tap(() =>
        changed && refreshCache && followedArtistsEnabled()
          ? Effect.tryPromise(readHomeFollow).pipe(Effect.ignore)
          : Effect.void,
      ),
      Effect.map(() => changed),
    );
  });
