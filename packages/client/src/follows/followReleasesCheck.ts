/**
 * The Follows check: each followed artist's releases from Deezer, then an Albums search on YT
 * Music for each release in the feed that isn't matched yet, so its card can show, open and play,
 * with the show check beside it. The phone and the desktop run this one
 * check; each gives its own settings and its own way to read YT Music.
 */
import {
  checkDue,
  deezerArtistAlbumsUrl,
  deezerArtistSearchUrl,
  deezerReleases,
  deezerReleasesNext,
  followCheckDue,
  followReleaseOpening,
  followReleaseQuery,
  followReleasesToSearch,
  keepFollowReleases,
  resolveDeezerFollowArtist,
  type FollowCheckContext,
  type FollowRelease,
  type ReleaseType,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { FollowStore } from "./followStore.ts";

/** An Albums search's result. */
export interface YtAlbumResult {
  readonly title: string;
  readonly browseId: string;
  readonly releaseType?: ReleaseType | null;
  readonly artists: readonly string[];
}
/** The YT Music reads the check makes. */
export interface FollowYt<E = unknown> {
  /** One Albums search. */
  readonly searchAlbums: (query: string) => Effect.Effect<readonly YtAlbumResult[], E>;
  readonly album: (
    browseId: string,
  ) => Effect.Effect<{ readonly tracks: readonly { readonly videoId: string }[] }, E>;
}

/** [Y] is what a YT Music read fails with; [R] is what the show check needs to run. */
export interface FollowReleasesPorts<Y = unknown, R = never> {
  /** Followed artists' switch, read again before each step. */
  readonly enabled: () => boolean;
  /** YT Music's switch, read again before each read. */
  readonly ytEnabled: () => boolean;
  /** The country shows are looked up in; "" for none. */
  readonly country: () => string;
  /** Whether shows can be checked now: the service is configured and the account signed in. */
  readonly showsCheckable: () => Promise<boolean>;
  /** The show check, run first; its failure never holds back the releases. */
  readonly checkShows: (context: FollowCheckContext) => Effect.Effect<boolean, unknown, R>;
  /** Waits for a quiet moment before each request. */
  readonly settle?: Effect.Effect<void>;
  /**
   * Runs one YT Music read ([query] is what it asks for) under the device's allowance;
   * undefined when it may not run.
   */
  readonly ytTurn?: <A>(
    query: string,
    read: Effect.Effect<A | undefined, Y>,
  ) => Effect.Effect<A | undefined, Y>;
  readonly fetch?: typeof fetch;
}

/**
 * The check on Home opening and in the phone's daily background task; the context picks the due
 * window. Failed artists retain their last successful answers and due time. With the switch
 * off, nothing followed or nothing due, it sends no request. After Deezer, with YT Music on, it
 * searches every release Core's `followReleasesToSearch` names, newest first and one at a time,
 * with no cap: the match is the tap's (`followReleaseOpening`), saved with the album's songs; a
 * miss or a failed read is searched again at the next check. Succeeds with whether it saved
 * anything.
 */
export const followReleasesCheck = <Y = unknown, R = never>(ports: FollowReleasesPorts<Y, R>) => {
  const settle = ports.settle ?? Effect.void;
  const json = (url: string) =>
    Effect.tryPromise(async (signal) => {
      const answer = await (ports.fetch ?? fetch)(url, { signal });
      if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
      return (await answer.json()) as unknown;
    }).pipe(Effect.timeout("20 seconds"));
  const allowed = () => ports.enabled();
  const ytAllowed = () => allowed() && ports.ytEnabled();
  const ytRead = <A>(query: string, read: Effect.Effect<A, Y>) =>
    Effect.gen(function* () {
      yield* settle;
      if (!ytAllowed()) return undefined;
      const guarded: Effect.Effect<A | undefined, Y> = Effect.gen(function* () {
        if (!ytAllowed()) return undefined;
        return yield* read;
      });
      return yield* ports.ytTurn ? ports.ytTurn(query, guarded) : guarded;
    });
  /** Searches the releases Core names, saving each match found; true when one was saved. */
  const matchReleases = <E>(store: FollowStore<E>, yt: FollowYt<Y>) =>
    Effect.gen(function* () {
      const follows = yield* store.listFollows;
      const cache = yield* store.followReleaseCache;
      const toSearch = followReleasesToSearch({
        follows,
        releases: cache.artists.flatMap((a) => a.releases),
        hidden: cache.hidden,
        countedPlays: [],
        now: Date.now(),
      });
      let matched = false;
      for (const release of toSearch) {
        if (!ytAllowed()) break;
        const follow = follows.find((f) => f.key === release.artistKey);
        if (follow === undefined) continue;
        const saved = yield* Effect.gen(function* () {
          const query = followReleaseQuery(release, follow.name);
          const found = yield* ytRead(query, yt.searchAlbums(query));
          if (found === undefined) return false;
          const opening = followReleaseOpening(release, { ytMusic: true, found });
          if (opening.kind !== "open") return false;
          const album = yield* ytRead(opening.browseId, yt.album(opening.browseId));
          if (album === undefined || !allowed()) return false;
          // Do not resurrect a follow removed while the search ran.
          const current = yield* store.getFollow(follow.name);
          if (current === null || current.followedAt !== follow.followedAt) return false;
          const kept = (yield* store.followReleaseCache).artists.find(
            (a) => a.key === release.artistKey,
          );
          if (kept === undefined) return false;
          yield* store.saveFollowReleases(
            release.artistKey,
            kept.releases.map((r) =>
              r.key === release.key
                ? {
                    ...r,
                    browseId: opening.browseId,
                    videoIds: album.tracks.map((t) => t.videoId),
                  }
                : r,
            ),
            kept.checkedAt,
          );
          return true;
        }).pipe(Effect.orElseSucceed(() => false));
        if (saved) matched = true;
      }
      return matched;
    }).pipe(Effect.orElseSucceed(() => false));
  return <E>(
    store: FollowStore<E>,
    yt: FollowYt<Y>,
    context: FollowCheckContext = "home",
    youtubeEnabled = ports.ytEnabled(),
  ) =>
    Effect.gen(function* () {
      if (!allowed()) return false;
      const follows = yield* store.listFollows;
      const cache = yield* store.followReleaseCache;
      const shows = yield* store.followShowCache;
      // Signed out, shows aren't due: they can't be checked.
      const showsCheckable = yield* Effect.promise(ports.showsCheckable);
      if (
        !followCheckDue({
          enabled: allowed(),
          follows,
          releaseChecks: cache.artists,
          showChecks: shows.artists,
          country: showsCheckable ? ports.country() : "",
          now: Date.now(),
          context,
        })
      )
        return false;
      // A shows failure never holds back the releases.
      let changed = yield* ports.checkShows(context).pipe(Effect.orElseSucceed(() => false));
      for (const follow of follows) {
        yield* settle;
        if (!allowed()) break;
        const previous = cache.artists.find((a) => a.key === follow.key);
        if (!checkDue(previous?.checkedAt ?? null, Date.now(), context)) continue;
        yield* Effect.gen(function* () {
          let id = follow.deezerId;
          if (id === null) {
            const response = yield* json(deezerArtistSearchUrl(follow.name));
            id = resolveDeezerFollowArtist(response, follow.name);
            if (id === null) return;
            const current = yield* store.getFollow(follow.name);
            if (current === null || current.followedAt !== follow.followedAt) return;
            yield* store.setFollow({ ...current, deezerId: id }, current.level);
          }
          const fresh: FollowRelease[] = [];
          let url: string | null = deezerArtistAlbumsUrl(id);
          const pages = new Set<string>();
          while (url !== null && !pages.has(url)) {
            pages.add(url);
            yield* settle;
            if (!allowed()) return;
            const response: unknown = yield* json(url);
            const parsed = deezerReleases(response, follow.key);
            if (parsed === null) return;
            fresh.push(...parsed);
            url = deezerReleasesNext(response, id);
          }
          const releases = keepFollowReleases(fresh, previous?.releases);
          if (!allowed()) return;
          // Do not resurrect a follow removed while its requests were in flight.
          const current = yield* store.getFollow(follow.name);
          if (current === null || current.followedAt !== follow.followedAt) return;
          yield* store.saveFollowReleases(follow.key, releases, Date.now());
          changed = true;
        }).pipe(Effect.ignore);
      }
      if (youtubeEnabled && ytAllowed() && (yield* matchReleases(store, yt))) changed = true;
      return changed;
    });
};
