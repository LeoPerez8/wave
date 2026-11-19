/**
 * Opening a new release the Library lacks: Core's `followReleaseOpening`, with the Albums search
 * an unmatched release needs, and the match kept so the next opening asks nothing. The phone and
 * the desktop open a card through this one step.
 */
import {
  followReleaseOpening,
  type FollowRelease,
  type FollowReleaseOpening,
  type ReleaseType,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { FollowStore } from "./followStore.ts";

export interface FollowReleaseOpenPorts {
  /** Whether a release may open on YT Music now: both switches on. Read again after the search. */
  readonly ytMusic: () => boolean;
  /** Whether a found match may be kept: Followed artists is still on. */
  readonly keep: () => boolean;
  /** One Albums search on YT Music; null when it failed or was offline. */
  readonly searchAlbums: (query: string) => Promise<
    | readonly {
        readonly title: string;
        readonly releaseType?: ReleaseType | null;
        readonly browseId: string;
        readonly artists: readonly string[];
      }[]
    | null
  >;
  /** The album's songs on YT Music; null when it couldn't be read. */
  readonly albumVideoIds: (browseId: string) => Promise<readonly string[] | null>;
}

/** Where [release] by [artist] opens; a match found by the search is saved with its songs. */
export const openFollowRelease = <E>(
  store: Pick<FollowStore<E>, "followReleaseCache" | "saveFollowReleases">,
  release: FollowRelease,
  artist: string,
  ports: FollowReleaseOpenPorts,
): Effect.Effect<FollowReleaseOpening, E> =>
  Effect.gen(function* () {
    const opening = followReleaseOpening(release, { ytMusic: ports.ytMusic() });
    if (opening.kind !== "search") return opening;
    const albums = yield* Effect.promise(() =>
      ports.searchAlbums(`${artist} ${release.title}`).catch(() => null),
    );
    const found = followReleaseOpening(release, { ytMusic: ports.ytMusic(), found: albums });
    if (found.kind !== "open") return found;
    const videoIds = yield* Effect.promise(() =>
      ports.albumVideoIds(found.browseId).catch(() => null),
    );
    if (videoIds === null || !ports.keep()) return found;
    const cache = yield* store.followReleaseCache;
    const kept = cache.artists.find((a) => a.key === release.artistKey);
    if (kept)
      yield* store.saveFollowReleases(
        release.artistKey,
        kept.releases.map((r) =>
          r.key === release.key ? { ...r, browseId: found.browseId, videoIds: [...videoIds] } : r,
        ),
        kept.checkedAt,
      );
    return found;
  });
