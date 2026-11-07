import { readHomeFollow } from "./knownHomeFollow";
import { checkDue, followFeed, formatDate, type FollowCheckContext } from "@wave/core";
import * as Effect from "effect/Effect";
import { LibraryStore } from "@/library/LibraryStore";
import { followedArtistsEnabled } from "@/settings/followedArtists";
import { currentFollowCountry } from "@/settings/followCountry";
import { showsConfigured, showsNotificationsEnabled } from "@/library/showNotifications";
import { WaveNative, online } from "@/native/waveNative";
import { WaveAccount, waveAccountErrorCode } from "@/native/waveAccount";
import { currentLocalisation } from "@/localisation/localisation";
import { settledTurnEffect } from "@/lib/backgroundWork";
import { checkArtistShows } from "./showsCheck";
const allowed = (country: string) =>
  showsConfigured && followedArtistsEnabled() && country === currentFollowCountry();
/**
 * Whether a Wave account is signed in, which shows need: Ticketmaster is
 * asked through the sync service with its session. False when the native
 * module can't say.
 */
export const showsSignedIn = Effect.promise(() =>
  WaveAccount.session().then(
    (session) => session.status === "signedIn",
    () => false,
  ),
);
/** A request the native module refused because there's no session any more: the check stops. */
class SessionGone extends Error {}
/**
 * One call to the sync service's Ticketmaster routes, which the native
 * module sends with the session JS never sees; offline it fails without
 * asking. The service's refusals (a limit, Ticketmaster failing) fail too.
 */
const request = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      if (!online()) throw new Error("Offline");
      const response = await WaveAccount.request("GET", path, null);
      if (response.status !== 200)
        throw new Error(`HTTP ${response.status} from Wave's Ticketmaster route`);
      return JSON.parse(response.body) as unknown;
    },
    catch: (cause) => {
      const code = waveAccountErrorCode(cause);
      return code === "ERR_WAVE_SIGNED_OUT" || code === "ERR_WAVE_SESSION_ENDED"
        ? new SessionGone()
        : cause;
    },
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
/**
 * Shared by Home, artist pages and the daily background task
 * (`followCheckTask.ts`). Signed out it asks nothing, and a session that
 * ends meanwhile stops it.
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
              if (!(yield* showsSignedIn)) return;
              let sessionGone = false;
              const store = yield* LibraryStore;
              const follows = yield* store.listFollows;
              const cache = yield* store.followShowCache;
              for (const follow of follows) {
                if (follow.level !== "shows") continue;
                if (!allowed(country) || sessionGone) return;
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
                      request: (path) =>
                        Effect.gen(function* () {
                          yield* settledTurnEffect;
                          if (!allowed(country))
                            return yield* Effect.fail(new Error("Not allowed"));
                          return yield* request(path).pipe(
                            Effect.tapError((error) =>
                              Effect.sync(() => {
                                if (error instanceof SessionGone) sessionGone = true;
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
