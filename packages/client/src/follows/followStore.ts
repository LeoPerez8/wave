/**
 * What the Follows checks and Home's follow cards read and save, as the phone's Library store
 * and the desktop both give it. The checks and the cards are written once over it.
 */
import type { FollowedArtist, FollowLevel, FollowRelease } from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryDatabase } from "../db/database.ts";
import {
  followReleaseListening,
  readFollowReleases,
  saveFollowReleases,
  type FollowReleaseCache,
} from "../db/followReleases.ts";
import { saveFollow, selectFollow, selectFollows, type FollowTarget } from "../db/follows.ts";
import {
  markShowNotified,
  readFollowShows,
  saveFollowShows,
  type FollowShowCacheRow,
} from "../db/followShows.ts";

export interface FollowStore<E = unknown> {
  readonly listFollows: Effect.Effect<readonly FollowedArtist[], E>;
  readonly getFollow: (name: string) => Effect.Effect<FollowedArtist | null, E>;
  readonly setFollow: (target: FollowTarget, level: FollowLevel) => Effect.Effect<void, E>;
  readonly followReleaseCache: Effect.Effect<FollowReleaseCache, E>;
  readonly saveFollowReleases: (
    key: string,
    releases: readonly FollowRelease[],
    checkedAt: number,
  ) => Effect.Effect<void, E>;
  readonly followReleaseListening: (
    releases: readonly FollowRelease[],
  ) => Effect.Effect<ReturnType<typeof followReleaseListening>, E>;
  readonly followShowCache: Effect.Effect<ReturnType<typeof readFollowShows>, E>;
  readonly saveFollowShows: (row: FollowShowCacheRow) => Effect.Effect<void, E>;
  /** Claims a show for its one notification: false when it was already claimed. */
  readonly markShowNotified: (id: string) => Effect.Effect<boolean, E>;
}

/** The store straight over [db]; [saved] hears each follow a check changed (it waits to sync). */
export const databaseFollowStore = (
  db: LibraryDatabase,
  { saved }: { readonly saved?: () => void } = {},
): FollowStore<never> => ({
  listFollows: Effect.sync(() => selectFollows(db)),
  getFollow: (name) => Effect.sync(() => selectFollow(db, name)),
  setFollow: (target, level) =>
    Effect.sync(() => {
      if (saveFollow(db, target, level, Date.now())) saved?.();
    }),
  followReleaseCache: Effect.sync(() => readFollowReleases(db)),
  saveFollowReleases: (key, releases, checkedAt) =>
    Effect.sync(() => saveFollowReleases(db, key, releases, checkedAt)),
  followReleaseListening: (releases) => Effect.sync(() => followReleaseListening(db, releases)),
  followShowCache: Effect.sync(() => readFollowShows(db)),
  saveFollowShows: (row) => Effect.sync(() => saveFollowShows(db, row)),
  markShowNotified: (id) => Effect.sync(() => markShowNotified(db, id, Date.now())),
});
