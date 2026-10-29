import {
  checkDue,
  resolveDeezerFollowArtist,
  deezerArtistSearchUrl,
  deezerReleases,
  followFeed,
  matchFollowRelease,
  pickYtArtist,
  type FollowRelease,
  type FollowedArtist,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { useFollows } from "@/library/follows";
import { settledTurnEffect } from "@/lib/backgroundWork";
import { useFollowedArtistsEnabled, followedArtistsEnabled } from "@/settings/followedArtists";
import { useYtMusicEnabled, ytMusicEnabled } from "@/settings/ytMusic";
import { useDontPlayExplicit } from "@/settings/dontPlayExplicit";
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
/** All automatic YT reads, including pages, share the search allowance. */
const ytRead = <A>(read: Effect.Effect<A, YtMusicError>) =>
  Effect.gen(function* () {
    if (!ytAllowed()) return undefined;
    return yield* withSearchTurn(
      "discover",
      "Followed artists",
      Effect.gen(function* () {
        if (!ytAllowed()) return undefined;
        return yield* read;
      }),
    );
  });

/** Foreground Follows check; failed artists retain their last successful answers and due time. */
export const checkFollowReleases = Effect.gen(function* () {
  if (!allowed()) return;
  const store = yield* LibraryStore;
  const yt = yield* YtMusic;
  const follows = yield* store.listFollows;
  const cache = yield* store.followReleaseCache;
  for (const follow of follows) {
    yield* settledTurnEffect;
    if (!allowed()) return;
    const previous = cache.artists.find((a) => a.key === follow.key);
    if (!checkDue(previous?.checkedAt ?? null, Date.now(), "home")) continue;
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
      let releases: FollowRelease[] = [];
      let url: string | null = `https://api.deezer.com/artist/${id}/albums?limit=100`;
      const pages = new Set<string>();
      while (url !== null && !pages.has(url)) {
        pages.add(url);
        yield* settledTurnEffect;
        if (!allowed()) return;
        const response: unknown = yield* json(url);
        const parsed = deezerReleases(response, follow.key);
        if (parsed === null) return;
        releases.push(...parsed);
        const next: unknown = (response as { next?: unknown }).next;
        url =
          typeof next === "string" &&
          /^https?:\/\/api\.deezer\.com\//.test(next) &&
          new URL(next).pathname === `/artist/${id}/albums`
            ? next.replace(/^http:/, "https:")
            : null;
      }
      const known = new Map(previous?.releases.map((r) => [r.key, r]));
      releases = releases.map((r) =>
        known.get(r.key)?.browseId
          ? { ...r, browseId: known.get(r.key)!.browseId, videoIds: known.get(r.key)!.videoIds }
          : r,
      );
      // Keep releases already discovered even when Deezer omits them from later pages.
      const seen = new Set(releases.map((r) => r.key));
      releases.push(...(previous?.releases.filter((r) => !seen.has(r.key)) ?? []));
      const eligible = followFeed({
        follows: [follow],
        releases,
        hidden: cache.hidden,
        countedPlays: [],
        now: Date.now(),
      }).releaseCards;
      if (ytAllowed() && eligible.some((r) => r.browseId === null)) {
        const matching = yield* Effect.gen(function* () {
          let browseId = follow.ytBrowseId;
          if (browseId === null) {
            const candidates = yield* ytRead(yt.searchArtists(follow.name));
            browseId = candidates === undefined ? null : pickYtArtist(follow.name, candidates);
          }
          if (browseId === null) return releases;
          const current = yield* store.getFollow(follow.name);
          if (current === null || current.followedAt !== follow.followedAt) return releases;
          yield* store.setFollow({ ...current, deezerId: id, ytBrowseId: browseId }, current.level);
          const page = yield* ytRead(yt.artist(browseId));
          if (page === undefined) return releases;
          const albums = [
            ...page.albums.map((a) => ({ ...a, releaseType: a.releaseType ?? ("album" as const) })),
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
                const album = yield* ytRead(yt.album(match.browseId));
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
    }).pipe(Effect.ignore);
  }
});

export const readReleaseFeed = (follows: readonly FollowedArtist[]) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const cache = yield* store.followReleaseCache;
    const listening = yield* store.followReleaseListening(
      followFeed({
        follows,
        releases: cache.artists.flatMap((a) => a.releases),
        hidden: cache.hidden,
        countedPlays: [],
        now: Date.now(),
      }).releaseCards,
      Object.fromEntries(follows.map((f) => [f.key, f.name])),
    );
    return followFeed({ follows, ...listening, hidden: cache.hidden, now: Date.now() })
      .releaseCards;
  });
export const hideRelease = (key: string) =>
  appRuntime.runPromise(Effect.flatMap(LibraryStore, (s) => s.hideFollowRelease(key)));

/** A focus owns its work; leaving or changing either network switch interrupts requests. */
export const useFollowReleases = () => {
  const follows = useFollows();
  const enabled = useFollowedArtistsEnabled();
  const yt = useYtMusicEnabled();
  const explicit = useDontPlayExplicit();
  const [cards, setCards] = useState<readonly FollowRelease[] | undefined>();

  const [revision, setRevision] = useState(0);
  useFocusEffect(
    useCallback(() => {
      // Both values own the lifetime: toggling YT Music aborts its requests; Hide refreshes the cached feed.
      void yt;
      void revision;
      if (!enabled || follows.length === 0) {
        setCards([]);
        return;
      }
      const controller = new AbortController();
      const read = (initial = false) =>
        appRuntime
          .runPromise(readReleaseFeed(follows), { signal: controller.signal })
          .then((value) => {
            if (!controller.signal.aborted)
              setCards(initial && value.length === 0 ? undefined : value);
          });
      void read(true)
        .then(() => appRuntime.runPromise(checkFollowReleases, { signal: controller.signal }))
        .then(() => read())
        .catch(() => {
          if (!controller.signal.aborted) setCards((current) => current ?? []);
        });
      let stop = () => {};
      void appRuntime.runPromise(LibraryStore).then((s) => {
        if (!controller.signal.aborted)
          stop = s.listeningHistoryVersion.subscribe(() => {
            void read().catch(() => {});
          });
      });
      return () => {
        controller.abort();
        stop();
      };
    }, [enabled, yt, follows, revision]),
  );
  return {
    cards: !enabled || follows.length === 0 ? [] : cards?.filter((r) => !explicit || !r.explicit),
    follows,
    refresh: () => setRevision((r) => r + 1),
  };
};
