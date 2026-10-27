import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { normalizeTrack } from "@wave/core";
import { loadLibraryStore, loadWorktreeModule } from "../../bench/fastAgain/store.ts";
import { closeTestDatabase, openTestDatabase } from "./db/testDatabase.ts";
import type { LibraryStore } from "./LibraryStore.ts";

test("cold scoped stars follow optimistic gestures and restore the saved star after a failed write without loading global lists", async () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const db = await openTestDatabase();
  // Replace only the Android app runtime boundary; use the real favorite adapter,
  // Effect service and SQLite store. No React hooks or native downloads are run.
  const storeUrl = new URL("./LibraryStore.ts", import.meta.url).href;
  const runtimeUrl = `data:text/javascript,${encodeURIComponent(`
    import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))};
    import { LibraryStore } from ${JSON.stringify(storeUrl)};
    let service;
    export const provide = value => { service = value; };
    export const appRuntime = {
      runPromise: effect => Effect.runPromise(Effect.provideService(effect, LibraryStore, service))
    };
  `)}`;
  // Screen sight is navigation and React Native; the hooks that follow it aren't run here.
  const sightUrl = `data:text/javascript,${encodeURIComponent("export const useSightedStore = () => { throw new Error('not in a screen'); };")}`;
  const favoritesUrl = import.meta.url.replace("favorites.test.ts", "favorites.ts");
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        context.parentURL === favoritesUrl &&
        (specifier === "./runtime" || specifier === new URL("./runtime.ts", import.meta.url).href)
      )
        return { url: runtimeUrl, shortCircuit: true };
      if (context.parentURL === favoritesUrl && /lib\/screenSight(\.ts)?$/.test(specifier))
        return { url: sightUrl, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  try {
    const store = await loadLibraryStore(root, db);
    const { LibraryStoreError } = await loadWorktreeModule<typeof import("./LibraryStore.ts")>(
      root,
      "apps/mobile/src/library/LibraryStore.ts",
    );
    Effect.runSync(
      store.saveBatch(
        [
          {
            ...normalizeTrack({
              path: "/Music/One.m4a",
              title: "One",
              artist: "Artist",
              album: "Record",
              durationMs: 180000,
            }),
            sizeBytes: 1000,
            modifiedAt: 0,
            sampleRate: null,
            bitrateKbps: null,
            artworkHash: null,
            hasLyrics: false,
            explicit: "unknown",
          },
        ],
        [],
      ),
    );
    const track = Effect.runSync(store.listSongs)[0]!;
    Effect.runSync(store.setFavorites([track.id], true));
    let globalReads = 0;
    let fail = true;
    let release!: () => void;
    let gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runtime = (await import(runtimeUrl)) as {
      provide: (service: LibraryStore["Service"]) => void;
    };
    runtime.provide({
      ...store,
      favoriteTrackIds: Effect.suspend(() => {
        globalReads++;
        return store.favoriteTrackIds;
      }),
      listPendingFavorites: Effect.suspend(() => {
        globalReads++;
        return store.listPendingFavorites;
      }),
      setFavorites: (ids, on) =>
        Effect.promise(() => gate).pipe(
          Effect.andThen(() =>
            fail
              ? Effect.fail(new LibraryStoreError({ operation: "write star", cause: "disk full" }))
              : store.setFavorites(ids, on),
          ),
        ),
    });
    const favorites = await loadWorktreeModule<typeof import("./favorites.ts")>(
      root,
      "apps/mobile/src/library/favorites.ts",
    );
    const saved = { favorite: true, pendingFavorite: false };
    favorites.rememberSongFavorite(track.id, saved.favorite);
    const unstar = favorites.setFavorites([track.id], false);
    assert.equal(favorites.scopedSongStarredNow(track.id, null, saved), false);
    release();
    await unstar;
    assert.equal(favorites.scopedSongStarredNow(track.id, null, saved), true);
    assert.equal(
      Effect.runSync(store.nowPlayingSong({ trackId: String(track.id), song: null })).favorite,
      true,
    );

    fail = false;
    gate = Promise.resolve();
    await favorites.setFavorites([track.id], false);
    assert.equal(favorites.scopedSongStarredNow(track.id, null, saved), false);
    assert.equal(
      Effect.runSync(store.nowPlayingSong({ trackId: String(track.id), song: null })).favorite,
      false,
    );

    const song = { videoId: "pending", title: "Absent", artists: ["Artist"], durationMs: 180000 };
    const pendingSaved = { favorite: false, pendingFavorite: true };
    Effect.runSync(store.addPendingFavorites([song]));
    const pending = favorites.setPendingFavorites([song], false);
    assert.equal(favorites.scopedSongStarredNow(null, song.videoId, pendingSaved), false);
    await pending;
    assert.equal(
      Effect.runSync(
        store.nowPlayingSong({
          trackId: "yt:pending",
          song: { ...song, album: null, artworkUrl: null, explicit: false },
        }),
      ).pendingFavorite,
      false,
    );
    assert.equal(globalReads, 0);
  } finally {
    hooks.deregister();
    closeTestDatabase(db);
  }
});
