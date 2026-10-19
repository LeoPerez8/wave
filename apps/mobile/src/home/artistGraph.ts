/**
 * The artist graph (docs/spec.md, "Artist graph"): which artists are close
 * to which, derived by Core (`artistGraph`) from what the phone keeps: the
 * candidate catalog's radios, the saved YT Music artist pages' similar
 * artists and the Library's play history. No request, no storage of its
 * own: it's derived once per session and forgotten when what it's derived
 * from grew (a harvest). Kept free of Expo so it runs under plain Node
 * tests; the app's graph is `artistGraphNow` (`artistGraphNow.ts`).
 */
import { artistGraph, type ArtistGraph, type ArtistGraphPlay } from "@wave/core";
import * as Effect from "effect/Effect";

import type { LibraryStore, LibraryStoreError } from "@/library/LibraryStore";

/** What deriving the graph reads of the library database. */
export type ArtistGraphReads = Pick<
  LibraryStore["Service"],
  "candidateCatalog" | "ytArtistSimilar" | "tasteHistory" | "listSongs" | "listArtists"
>;

/**
 * The artist graph of what [store] keeps: the catalog, the saved pages and
 * every play of a Library song with its song's artists. [between] runs
 * between the reads, to give the JavaScript thread back.
 */
export const readArtistGraph = (
  store: ArtistGraphReads,
  between: Effect.Effect<void> = Effect.void,
): Effect.Effect<ArtistGraph, LibraryStoreError> =>
  Effect.gen(function* () {
    const catalog = yield* store.candidateCatalog;
    const pages = yield* store.ytArtistSimilar;
    yield* between;
    const history = yield* store.tasteHistory;
    const names = new Map((yield* store.listArtists).map((artist) => [artist.id, artist.name]));
    const artistsOf = new Map(
      (yield* store.listSongs).map((song) => [
        String(song.id),
        song.artistIds.flatMap((id) => names.get(id) ?? []),
      ]),
    );
    yield* between;
    const plays = history.plays.flatMap((play): ArtistGraphPlay[] => {
      const artists = artistsOf.get(play.trackId);
      return artists === undefined ? [] : [{ ...play, artists }];
    });
    return artistGraph({ catalog, pages, plays });
  });
