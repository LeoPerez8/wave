import assert from "node:assert/strict";
import { test } from "node:test";
import type { CatalogSong, YtAlbumSong } from "@wave/core";
import * as Effect from "effect/Effect";

import { magicQueuePopularity } from "./magicQueuePopularity.ts";

const song = (videoId: string): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["a"],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

/** A catalog song two radios carry: popularity 0.75. */
const hit = { song: song("hit"), radios: ["r1", "r2"] } as unknown as CatalogSong;

const libraryWith = (matches: ReadonlyMap<string, number>) => ({
  known: {
    inLibrary: (found: YtAlbumSong) => {
      const id = matches.get(found.videoId);
      return id === undefined ? null : { id };
    },
  },
});

test("a song added to the Library later weighs as the hit it is", async () => {
  const catalog = [hit];
  let library = libraryWith(new Map());
  const popularity = magicQueuePopularity({
    library: Effect.sync(() => library),
    catalog: Effect.succeed(catalog),
    between: Effect.void,
  });
  const before = await Effect.runPromise(popularity);
  assert.equal(before(7), 0);
  // The Library gains the song as track 7; the catalog stays the same object.
  library = libraryWith(new Map([["hit", 7]]));
  const after = await Effect.runPromise(popularity);
  assert.equal(after(7), 0.75);
});

test("the same Library and catalog read the catalog once", async () => {
  const library = libraryWith(new Map([["hit", 7]]));
  let walks = 0;
  const catalog = new Proxy([hit], {
    get: (target, key, receiver) => {
      if (key === Symbol.iterator) walks++;
      return Reflect.get(target, key, receiver);
    },
  });
  const popularity = magicQueuePopularity({
    library: Effect.succeed(library),
    catalog: Effect.succeed(catalog),
    between: Effect.void,
  });
  const first = await Effect.runPromise(popularity);
  const second = await Effect.runPromise(popularity);
  assert.equal(second, first);
  assert.equal(walks, 1);
});

test("every song is a deep cut when the snapshot can't be read", async () => {
  const popularity = magicQueuePopularity({
    library: Effect.fail(new Error("no database")),
    catalog: Effect.succeed([hit]),
    between: Effect.void,
  });
  const lookup = await Effect.runPromise(popularity);
  assert.equal(lookup("hit"), 0);
});
