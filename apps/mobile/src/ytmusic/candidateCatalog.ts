/**
 * Feeding the candidate catalog (docs/spec.md, "Candidate catalog"): every
 * radio (Home's mixes, the Magic Queue) and artist page Wave reads hands
 * what it brought here, and it's written on a free turn, so a read never
 * waits on it or fails because of it. What comes in and what leaves are
 * Core's (`catalogSeen`, `catalogLeaving`, through `LibraryStore`); no
 * request is made for it.
 */
import type { CatalogPage, CatalogPageSong } from "@wave/core";
import * as Effect from "effect/Effect";

import { whenFree } from "@/lib/backgroundWork";
import { LibraryStore } from "@/library/LibraryStore";
import type { NativeYtArtistPage } from "@/native/waveYtMusic";

/**
 * Adds [page] to the catalog, seen now, on the next free turn. Never fails:
 * a write that can't be made is left out (the catalog is a cache).
 */
export const noteCandidates = (page: CatalogPage): Effect.Effect<void, never, LibraryStore> =>
  Effect.gen(function* () {
    if (page.songs.length === 0) return;
    const store = yield* LibraryStore;
    const at = Date.now();
    whenFree(() => Effect.runFork(store.addCandidates(page, at).pipe(Effect.ignore)));
  });

/** Adds the songs [seed]'s radio played (every page read of it) to the catalog. */
export const noteRadio = (seed: string, songs: readonly CatalogPageSong[]) =>
  noteCandidates({ songs, seed });

/**
 * Adds an artist page's top songs to the catalog, with no radio. Only the
 * top songs: every song of a prolific artist (`allSongs`, up to the
 * playlist cap) would push the radios' songs out.
 */
export const noteArtistPage = (page: NativeYtArtistPage) =>
  noteCandidates({ songs: page.songs, seed: null });
