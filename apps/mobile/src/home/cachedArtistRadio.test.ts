import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { createRadioPageCatalog } from "../ytmusic/radioPageCatalog.ts";
import { createCachedArtistRadioReader, artistRadioCacheId } from "./cachedArtistRadio.ts";

const page = {
  songs: [
    {
      videoId: "v",
      title: "Song",
      artists: ["Artist"],
      album: null,
      albumId: null,
      durationMs: 1000,
      artworkUrl: null,
      explicit: false,
    },
  ],
  continuation: "next",
};
const setup = () => {
  let now = 1;
  let saved: string | null = null;
  const cache = createRadioPageCatalog(
    {
      read: () => saved,
      write: (value) => {
        saved = value;
      },
    },
    () => now,
  );
  let reads = 0;
  const noted: string[] = [];
  const read = createCachedArtistRadioReader({
    cache,
    live: () =>
      Effect.sync(() => {
        reads++;
        return page;
      }),
    note: (name) =>
      Effect.sync(() => {
        noted.push(name);
      }),
  });
  return {
    cache,
    read,
    noted,
    reads: () => reads,
    advance: (ms: number) => {
      now += ms;
    },
  };
};

test("fresh ordered radio makes no request; a missing or seven-day-old radio is read and cached once", async () => {
  const f = setup();
  assert.deepEqual(await Effect.runPromise(f.read({ name: "Artist" })), page);
  assert.equal(f.reads(), 1);
  assert.deepEqual(await Effect.runPromise(f.read({ name: "ARTIST" })), page);
  assert.equal(f.reads(), 1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(f.noted, ["Artist"]);
  f.advance(7 * 86400000);
  assert.deepEqual(await Effect.runPromise(f.read({ name: "Artist" })), page);
  assert.equal(f.reads(), 2);
  assert.deepEqual(f.cache.getFresh(artistRadioCacheId("Artist")), page);
});

test("the eight-second deadline covers artist lookup and radio IO, preserves cache on failure and allows retry", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const f = setup();
  f.cache.put(artistRadioCacheId("Artist"), page);
  f.advance(7 * 86400000);
  let finish!: () => void;
  const read = createCachedArtistRadioReader({
    cache: f.cache,
    live: () =>
      Effect.callback<typeof page>((resume) => {
        finish = () => resume(Effect.succeed(page));
      }),
    note: () => Effect.void,
  });
  const result = Effect.runPromise(read({ name: "Artist" }));
  const rejected = assert.rejects(result, /Radio deadline elapsed/);
  t.mock.timers.tick(8000);
  await rejected;
  finish();
  assert.equal(
    f.cache.getFresh(artistRadioCacheId("Artist")),
    null,
    "a late result doesn't renew the cache",
  );
  assert.deepEqual(f.cache.get(artistRadioCacheId("Artist")), page);
  assert.deepEqual(await Effect.runPromise(f.read({ name: "Artist" })), page);
});

test("concurrent mixes share one live read of the same artist radio", async () => {
  const f = setup();
  let reads = 0;
  const read = createCachedArtistRadioReader({
    cache: f.cache,
    live: () =>
      Effect.sleep(5).pipe(
        Effect.andThen(
          Effect.sync(() => {
            reads++;
            return page;
          }),
        ),
      ),
    note: () => Effect.void,
  });
  const pages = await Effect.runPromise(
    Effect.all([read({ name: "Artist" }), read({ name: "ARTIST" })], { concurrency: "unbounded" }),
  );
  assert.deepEqual(pages, [page, page]);
  assert.equal(reads, 1);
});

test("canceling one mix doesn't duplicate a radio still needed by another mix", async () => {
  const f = setup();
  let reads = 0;
  let finish!: () => void;
  const read = createCachedArtistRadioReader({
    cache: f.cache,
    live: () =>
      Effect.callback<typeof page>((resume) => {
        reads++;
        finish = () => resume(Effect.succeed(page));
      }),
    note: () => Effect.void,
  });
  const controller = new AbortController();
  const first = Effect.runPromise(read({ name: "Artist" }), { signal: controller.signal });
  const interrupted = assert.rejects(first);
  const second = Effect.runPromise(read({ name: "Artist" }));
  controller.abort();
  await interrupted;
  const third = Effect.runPromise(read({ name: "Artist" }));
  assert.equal(reads, 1);
  finish();
  assert.deepEqual(await Promise.all([second, third]), [page, page]);
});
