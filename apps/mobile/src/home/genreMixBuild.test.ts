import assert from "node:assert/strict";
import { test } from "node:test";
import { faithfulGenreMixesSteps, type DiscoverMixSeed, type YtAlbumSong } from "@wave/core";
import * as Effect from "effect/Effect";
import { runGenreMixBuild } from "./genreMixBuild.ts";
import { namedWork } from "../lib/stepped.ts";

test("Home receives the local families before it starts a blocked radio read", async () => {
  const seed = (name: string): DiscoverMixSeed => ({
    kind: "genre",
    id: `genre:${name.toLowerCase()}`,
    name,
    genre: name,
    from: "library",
    artists: [{ id: 1, name: `${name} artist` }],
  });
  const tracks: YtAlbumSong[] = Array.from({ length: 10 }, (_, i) => ({
    videoId: `rock${i}`,
    title: `Rock ${i}`,
    artists: ["Rock artist"],
    durationMs: 180_000,
    album: null,
    albumId: null,
    artworkUrl: null,
    explicit: false,
  }));
  let local: readonly string[] = [];
  const build = faithfulGenreMixesSteps(
    [seed("Pop"), seed("Rock")],
    {
      catalog: tracks.map((song) => ({ song, radios: [], firstSeenAt: 0, lastSeenAt: 0 })),
      genreOf: () => "Rock",
      known: { inLibrary: () => null, known: () => false, nonD: [] },
      library: { artists: [], songs: [] },
    },
    { faithfulness: 3, popularity: 3 },
  );
  const radioStarted = Promise.withResolvers<void>();
  const response = Promise.withResolvers<undefined>();
  const done = Effect.runPromise(
    runGenreMixBuild(
      build,
      (mixes) =>
        Effect.sync(() => {
          local = mixes.map(({ id }) => id);
        }),
      (artist) =>
        Effect.promise(() => {
          assert.equal(artist.name, "Pop artist");
          radioStarted.resolve();
          return response.promise;
        }),
      Effect.void,
    ).pipe(namedWork("genre mixes test")),
  );
  await Promise.race([radioStarted.promise, done]);
  assert.deepEqual(local, ["genre:rock"]);
  response.resolve(undefined);
  assert.deepEqual(
    (await done).map(({ id }) => id),
    local,
  );
});
