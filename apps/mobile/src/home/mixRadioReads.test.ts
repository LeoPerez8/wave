import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { genreMixSeeds } from "@wave/core";
import { createRadioPageCatalog } from "../ytmusic/radioPageCatalog.ts";
import { createCachedArtistRadioReader, artistRadioCacheId } from "./cachedArtistRadio.ts";
import { readMixRadios } from "./mixRadioReads.ts";

test("four Genre mixes read at most twelve radios in parallel, reusing pages younger than seven days", async () => {
  const artists = Array.from({ length: 15 }, (_, i) => ({ id: i + 1, name: `Artist ${i}` }));
  const seeds = genreMixSeeds({
    artists,
    songs: artists.flatMap((artist, i) =>
      Array.from({ length: 5 }, (_, j) => ({
        id: i * 5 + j,
        artistIds: [artist.id],
        title: `Song ${i}-${j}`,
        artist: artist.name,
        durationMs: 1000,
        addedAt: 0,
        genre: ["Metal", "Rock", "Pop", "Jazz", "Electronic"][Math.floor(i / 3)]!,
      })),
    ),
  });
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
  assert.equal(requests, 12, "every network read starts before any response");
  finishes.splice(0).forEach((finish) => finish());
  const result = await cold;
  assert.deepEqual(
    result.map((pages) => pages.map((radio) => radio.artists[0])),
    [
      ["Artist 0", "Artist 1", "Artist 2"],
      ["Artist 3", "Artist 4", "Artist 5"],
      ["Artist 6", "Artist 7", "Artist 8"],
      ["Artist 9", "Artist 10", "Artist 11"],
    ],
  );
  now += 7 * 86400000 - 1;
  assert.deepEqual(await Effect.runPromise(readMixRadios(seeds, read)), result);
  assert.equal(requests, 12, "fresh radios make no network requests");
  now++;
  // One recently refreshed radio leaves eleven due at the seven-day boundary.
  cache.put(artistRadioCacheId("Artist 0"), page);
  const stale = Effect.runPromise(readMixRadios(seeds, read));
  assert.equal(requests, 23);
  finishes.splice(0).forEach((finish) => finish());
  assert.deepEqual(await stale, result);
});
