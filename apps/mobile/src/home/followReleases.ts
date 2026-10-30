import { readHomeFollow } from "./knownHomeFollow";
import { checkFollowShows } from "./followShows";
import {
  checkDue,
  followCheckDue,
  resolveDeezerFollowArtist,
  deezerArtistSearchUrl,
  deezerArtistAlbumsUrl,
  deezerReleases,
  deezerReleasesNext,
  followFeed,
  keepFollowReleases,
  matchFollowRelease,
  pickYtArtist,
  type FollowCheckContext,
  type FollowRelease,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { settledTurnEffect } from "@/lib/backgroundWork";
import { followedArtistsEnabled } from "@/settings/followedArtists";
import { currentFollowCountry } from "@/settings/followCountry";
import { ticketmasterKey } from "@/library/showNotifications";
import { ytMusicEnabled } from "@/settings/ytMusic";
import { withSearchTurn } from "@/ytmusic/searchAllowance";
import { YtMusic } from "@/ytmusic/YtMusic";
import type { YtMusicError } from "@/ytmusic/YtMusic";

const json = (url: string) =>
  Effect.tryPromise(async (signal) => {
    const answer = await fetch(url, { signal });
    if (!answer.ok) throw new Error(`HTTP ${answer.status}`);
    return (await answer.json()) as unknown;
  }).pipe(Effect.timeout("20 seconds"));
const allowed = () => followedArtistsEnabled();
const ytAllowed = () => allowed() && ytMusicEnabled();
/** All automatic YT reads, including pages, share the search allowance; [query] is what [read] asks for. */
const ytRead = <A>(query: string, read: Effect.Effect<A, YtMusicError>) =>
  Effect.gen(function* () {
    yield* settledTurnEffect;
    if (!ytAllowed()) return undefined;
    return yield* withSearchTurn(
      "discover",
      query,
      Effect.gen(function* () {
        if (!ytAllowed()) return undefined;
        return yield* read;
      }),
    );
  });

/**
 * The Follows check, on Home opening and in the daily background task (`followCheckTask.ts`);
 * the context picks the due window. Failed artists retain their last successful answers and
 * due time. With the switch off, nothing followed or nothing due, it sends no request.
 */
export const checkFollowReleases = (
  youtubeEnabled = ytMusicEnabled(),
  context: FollowCheckContext = "home",
  refreshCache = true,
) =>
  Effect.gen(function* () {
    if (!allowed()) return false;
    const store = yield* LibraryStore;
    const follows = yield* store.listFollows;
    const cache = yield* store.followReleaseCache;
    const shows = yield* store.followShowCache;
    if (
      !followCheckDue({
        enabled: allowed(),
        follows,
        releaseChecks: cache.artists,
        showChecks: shows.artists,
        country: ticketmasterKey === "" ? "" : currentFollowCountry(),
        now: Date.now(),
        context,
      })
    )
      return false;
    const yt = yield* YtMusic;
    // A shows failure never holds back the releases.
    let changed = yield* checkFollowShows(context, false).pipe(Effect.orElseSucceed(() => false));
    for (const follow of follows) {
      yield* settledTurnEffect;
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
          yield* settledTurnEffect;
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
          const matching = yield* Effect.gen(function* () {
            let browseId = follow.ytBrowseId;
            if (browseId === null) {
              const candidates = yield* ytRead(follow.name, yt.searchArtists(follow.name));
              browseId = candidates === undefined ? null : pickYtArtist(follow.name, candidates);
            }
            if (browseId === null) return releases;
            const current = yield* store.getFollow(follow.name);
            if (current === null || current.followedAt !== follow.followedAt) return releases;
            yield* store.setFollow(
              { ...current, deezerId: id, ytBrowseId: browseId },
              current.level,
            );
            const page = yield* ytRead(browseId, yt.artist(browseId));
            if (page === undefined) return releases;
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
              releases,
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
          }).pipe(Effect.orElseSucceed(() => releases));
          releases = matching;
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
  }).pipe(
    Effect.tap((changed) =>
      changed && refreshCache && allowed()
        ? Effect.tryPromise(readHomeFollow).pipe(Effect.ignore)
        : Effect.void,
    ),
  );

export const hideRelease = (key: string) =>
  appRuntime.runPromise(Effect.flatMap(LibraryStore, (s) => s.hideFollowRelease(key)));
