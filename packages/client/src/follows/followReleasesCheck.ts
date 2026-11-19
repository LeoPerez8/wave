/**
 * The Follows check: each followed artist's releases from Deezer, matched on YT Music so a card
 * can open and play, with the show check beside it. The phone and the desktop run this one
 * check; each gives its own settings and its own way to read YT Music.
 */
import {
  checkDue,
  deezerArtistAlbumsUrl,
  deezerArtistSearchUrl,
  deezerReleases,
  deezerReleasesNext,
  followCheckDue,
  followFeed,
  keepFollowReleases,
  matchFollowRelease,
  pickYtArtist,
  resolveDeezerFollowArtist,
  type FollowCheckContext,
  type FollowRelease,
  type ReleaseType,
  type YtArtistCandidate,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { FollowStore } from "./followStore.ts";

interface YtRelease {
  readonly title: string;
  readonly browseId: string;
  readonly releaseType?: ReleaseType | null;
}
/** The YT Music reads the check makes. */
export interface FollowYt<E = unknown> {
  readonly searchArtists: (name: string) => Effect.Effect<readonly YtArtistCandidate[], E>;
  readonly artist: (
    browseId: string,
  ) => Effect.Effect<
    { readonly albums: readonly YtRelease[]; readonly singles: readonly YtRelease[] },
    E
  >;
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
 * off, nothing followed or nothing due, it sends no request. Succeeds with whether it saved
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
          let releases = keepFollowReleases(fresh, previous?.releases);
          const eligible = followFeed({
            follows: [follow],
            releases,
            hidden: cache.hidden,
            countedPlays: [],
            now: Date.now(),
          }).releaseCards;
          if (youtubeEnabled && ytAllowed() && eligible.some((r) => r.browseId === null)) {
            const unmatched = releases;
            const deezerId = id;
            releases = yield* Effect.gen(function* () {
              let browseId = follow.ytBrowseId;
              if (browseId === null) {
                const candidates = yield* ytRead(follow.name, yt.searchArtists(follow.name));
                browseId = candidates === undefined ? null : pickYtArtist(follow.name, candidates);
              }
              if (browseId === null) return unmatched;
              const current = yield* store.getFollow(follow.name);
              if (current === null || current.followedAt !== follow.followedAt) return unmatched;
              yield* store.setFollow({ ...current, deezerId, ytBrowseId: browseId }, current.level);
              const page = yield* ytRead(browseId, yt.artist(browseId));
              if (page === undefined) return unmatched;
              const albums = [
                ...page.albums.map((a) => ({
                  ...a,
                  releaseType: a.releaseType ?? ("album" as const),
                })),
                ...page.singles.map((a) => ({
                  ...a,
                  releaseType: a.releaseType ?? ("single" as const),
                })),
              ];
              return yield* Effect.forEach(
                unmatched,
                (r) =>
                  Effect.gen(function* () {
                    if (r.browseId !== null || !eligible.some((e) => e.key === r.key)) return r;
                    const match = matchFollowRelease(r, albums);
                    if (!match) return r;
                    const album = yield* ytRead(match.browseId, yt.album(match.browseId));
                    return album === undefined
                      ? r
                      : {
                          ...r,
                          browseId: match.browseId,
                          videoIds: album.tracks.map((t) => t.videoId),
                        };
                  }),
                { concurrency: 1 },
              );
            }).pipe(Effect.orElseSucceed(() => unmatched));
          }
          if (!allowed()) return;
          // Do not resurrect a follow removed while its requests were in flight.
          const current = yield* store.getFollow(follow.name);
          if (current === null || current.followedAt !== follow.followedAt) return;
          yield* store.saveFollowReleases(follow.key, releases, Date.now());
          changed = true;
        }).pipe(Effect.ignore);
      }
      return changed;
    });
};
