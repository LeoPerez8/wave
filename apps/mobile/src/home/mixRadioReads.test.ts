import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import type { DiscoverMixSeed } from "@wave/core";
import { createRadioPageCatalog } from "../ytmusic/radioPageCatalog.ts";
import { createCachedArtistRadioReader, artistRadioCacheId } from "./cachedArtistRadio.ts";
import { readMixRadios } from "./mixRadioReads.ts";

test("Artist mixes start their radios in parallel and reuse pages younger than seven days", async () => {
  const seeds: DiscoverMixSeed[] = Array.from({ length: 4 }, (_, i) => ({
    id: `artist:Artist ${i}`,
    kind: "artist",
    name: `Artist ${i}`,
    from: "library",
  }));
  let saved: string | null = null;
  let now = 1;
  const cache = createRadioPageCatalog(
    {
      read: () => saved,
      write: (value) => {
        saved = value;
      },
    },
    () => now,
  );
  const page = { songs: [], continuation: "next" };
  let requests = 0;
  const finishes: (() => void)[] = [];
  const read = createCachedArtistRadioReader({
    cache,
    live: () =>
      Effect.callback<typeof page>((resume) => {
        requests++;
        finishes.push(() => resume(Effect.succeed(page)));
      }),
    note: () => Effect.void,
  });
  const cold = Effect.runPromise(readMixRadios(seeds, read));
  assert.equal(requests, 4, "every network read starts before any response");
  finishes.splice(0).forEach((finish) => finish());
  const result = await cold;
  assert.deepEqual(
    result.map((pages) => pages.map((radio) => radio.artists[0])),
    [["Artist 0"], ["Artist 1"], ["Artist 2"], ["Artist 3"]],
  );
  now += 7 * 86400000 - 1;
  assert.deepEqual(await Effect.runPromise(readMixRadios(seeds, read)), result);
  assert.equal(requests, 4, "fresh radios make no network requests");
  now++;
  // One recently refreshed radio leaves three due at the seven-day boundary.
  cache.put(artistRadioCacheId("Artist 0"), page);
  const stale = Effect.runPromise(readMixRadios(seeds, read));
  assert.equal(requests, 7);
  finishes.splice(0).forEach((finish) => finish());
  assert.deepEqual(await stale, result);
});
