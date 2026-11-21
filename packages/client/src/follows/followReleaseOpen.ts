/**
 * Opening a new release the Library lacks: Core's `followReleaseOpening`, with the read of a
 * matched release's album first (`followAlbumOpening`: one YT Music answers without loses its
 * match under every artist),
 * the Albums search an unmatched release needs, and a match found kept so the next opening asks
 * nothing. The phone and the desktop open a card through this one step.
 */
import {
  followAlbumOpening,
  followReleaseOpening,
  followReleaseQuery,
  unmatchFollowRelease,
  type FollowAlbumRead,
  type FollowRelease,
  type FollowReleaseOpening,
  type ReleaseType,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { FollowStore } from "./followStore.ts";

export interface FollowReleaseOpenPorts {
  /** Whether a release may open on YT Music now: both switches on. Read again after the search. */
  readonly ytMusic: () => boolean;
  /** Whether a found match may be kept, or a gone one dropped: Followed artists is still on. */
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
  /**
   * The album's page on YT Music: its songs, or why it has none. `missing` only when YT Music
   * answered without the album; a rejection is no answer.
   */
  readonly album: (browseId: string) => Promise<FollowAlbumRead>;
}

type Store<E> = Pick<FollowStore<E>, "followReleaseCache" | "saveFollowReleases">;

/**
 * Saves [change] over the kept releases of every artist holding [release]'s key, at their check
 * times: a collaboration followed through two artists changes in both.
 */
const saveRelease = <E>(
  store: Store<E>,
  release: FollowRelease,
  change: (releases: readonly FollowRelease[]) => FollowRelease[],
) =>
  Effect.gen(function* () {
    const cache = yield* store.followReleaseCache;
    for (const kept of cache.artists)
      if (kept.releases.some((r) => r.key === release.key))
        yield* store.saveFollowReleases(kept.key, change(kept.releases), kept.checkedAt);
  });

/**
 * Where [release] by [artist] opens: a matched one on its album, read once here ("Not on YouTube
 * Music yet" and the match dropped when YT Music answers without it; no answer still opens it),
 * an unmatched one after a search, its match saved with its songs. A gone album comes back as
 * `notFound`. The `album` port's read is the one the album's page shows, so it reads only once.
 */
export const openFollowRelease = <E>(
  store: Store<E>,
  release: FollowRelease,
  artist: string,
  ports: FollowReleaseOpenPorts,
): Effect.Effect<FollowReleaseOpening, E> =>
  Effect.gen(function* () {
    const read = (browseId: string) =>
      Effect.promise(() => ports.album(browseId).catch((): FollowAlbumRead => "noAnswer"));
    const opening = followReleaseOpening(release, { ytMusic: ports.ytMusic() });
    if (opening.kind === "open") {
      const album = followAlbumOpening(opening.browseId, yield* read(opening.browseId));
      if (album.kind !== "gone") return album;
      if (ports.keep())
        yield* saveRelease(store, release, (releases) =>
          unmatchFollowRelease(releases, release.key),
        );
      return { kind: "notFound" };
    }
    if (opening.kind !== "search") return opening;
    const albums = yield* Effect.promise(() =>
      ports.searchAlbums(followReleaseQuery(release, artist)).catch(() => null),
    );
    const found = followReleaseOpening(release, { ytMusic: ports.ytMusic(), found: albums });
    if (found.kind !== "open") return found;
    const songs = yield* read(found.browseId);
    if (typeof songs !== "object" || songs.videoIds.length === 0 || !ports.keep()) return found;
    yield* saveRelease(store, release, (releases) =>
      releases.map((r) =>
        r.key === release.key
          ? { ...r, browseId: found.browseId, videoIds: [...songs.videoIds] }
          : r,
      ),
    );
    return found;
  });
