/**
 * The show check: asks the sync service's Ticketmaster routes about each shows-level artist
 * whose shows are due and saves the answers. The phone and the desktop run this one check;
 * each gives its own settings, session and way to reach the service.
 */
import {
  dueShowChecks,
  followFeed,
  showCheckDay,
  showChecksLeftToday,
  type FollowCheckContext,
  type FollowedArtist,
  type FollowShow,
} from "@wave/core";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import type { FollowStore } from "./followStore.ts";
import { checkArtistShows } from "./showsCheck.ts";

export interface FollowShowsPorts {
  /** Whether this build can reach the service at all. */
  readonly configured: boolean;
  /** Followed artists' switch, read again before each step. */
  readonly enabled: () => boolean;
  /** The country shows are looked up in, read again before each step; "" for none. */
  readonly country: () => string;
  readonly signedIn: () => Promise<boolean>;
  readonly online: () => boolean;
  /** Artists asked about today (UTC), toward the service's daily limit. */
  readonly checksToday: {
    readonly get: () => { readonly day: number; readonly count: number } | null;
    readonly set: (value: { readonly day: number; readonly count: number }) => void;
  };
  /** One GET to the service with the account's session; rejects on any refusal. */
  readonly ask: (path: string) => Promise<unknown>;
  /** Whether [cause] ends the whole check: the session is gone, or the service answered a limit. */
  readonly stops: (cause: unknown) => boolean;
  /** Waits for a quiet moment before each request. */
  readonly settle?: Effect.Effect<void>;
  /** The gap before each request; 250 ms unless a test shortens it. */
  readonly pause?: Duration.Input;
  /** Hears each save of an artist's shows. */
  readonly saved?: () => void;
  /** Show notifications, where the device posts them. */
  readonly notifications?: {
    readonly enabled: () => boolean;
    readonly post: (artist: FollowedArtist, show: FollowShow) => void;
  };
}

/** A refusal that stops the whole check, so no other artist is asked. */
class CheckStops extends Error {}

/**
 * Signed out it asks nothing; a session that ends meanwhile or a limit the service answers
 * stops it. Artists never checked go first, then the oldest checks (Core's `dueShowChecks`),
 * and it stops without asking once today's artists reach the service's daily limit
 * (`showChecksLeftToday`). One check runs at a time; a second one meanwhile does nothing.
 * Succeeds with whether it saved anything.
 */
export const followShowsCheck = (ports: FollowShowsPorts) => {
  const allowed = (country: string) =>
    ports.configured && ports.enabled() && country === ports.country();
  const request = (path: string) =>
    Effect.tryPromise({
      try: () => ports.ask(path),
      catch: (cause) => (ports.stops(cause) ? new CheckStops() : cause),
    }).pipe(Effect.timeout("20 seconds"), Effect.delay(ports.pause ?? "250 millis"));
  const count = Effect.sync(() => {
    const day = showCheckDay(Date.now());
    const asked = ports.checksToday.get();
    ports.checksToday.set({ day, count: asked?.day === day ? asked.count + 1 : 1 });
  });
  let checking = false;
  return <E>(store: FollowStore<E>, context: FollowCheckContext = "home") =>
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
                const country = ports.country();
                if (!country || !allowed(country)) return;
                if (!(yield* Effect.promise(ports.signedIn))) return;
                let stops = false;
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
                  if (showChecksLeftToday(ports.checksToday.get(), Date.now()) === 0) return;
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
                            if (ports.settle) yield* ports.settle;
                            if (!allowed(country))
                              return yield* Effect.fail(new Error("Not allowed"));
                            // Offline it fails without asking, so it doesn't count.
                            if (!ports.online()) return yield* Effect.fail(new Error("Offline"));
                            if (!counted) {
                              counted = true;
                              yield* count;
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
                    yield* Effect.sync(() => ports.saved?.());
                    const notifications = ports.notifications;
                    if (!notifications) return;
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
                      if (!allowed(country) || !notifications.enabled()) return;
                      if (yield* store.markShowNotified(show.id))
                        yield* Effect.sync(() => notifications.post(current, show));
                    }
                  }).pipe(Effect.ignore);
                }
              }),
        (acquired) =>
          Effect.sync(() => {
            if (acquired) checking = false;
          }),
      ).pipe(Effect.map(() => changed));
    });
};
