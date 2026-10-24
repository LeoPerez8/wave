import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { magicSignalSongs } from "./magicSignalSongs.ts";

test("learning keeps Library recording metadata and the downloaded video's identity", async () => {
  const signals = await Effect.runPromise(
    magicSignalSongs("favorite", ["22"], {
      songs: () =>
        Effect.succeed([
          { id: 22, title: "Liked", artistIds: [4], durationMs: 180_000, genre: null },
        ]),
      artists: () => Effect.succeed([{ id: 4, name: "Artist" }]),
      videos: () => Effect.succeed(new Map([[22, "video"]])),
      streamed: () => null,
    }),
  );
  assert.equal(signals[0]?.song.trackId, "22");
  assert.deepEqual(signals[0]?.radio, {
    id: "song:22",
    title: "Liked",
    artists: ["Artist"],
    durationMs: 180_000,
    videoId: "video",
  });
});

test("a streamed action can learn its video radio even when the song is outside the queue", async () => {
  const deps = {
    songs: () => Effect.succeed([]),
    artists: () => Effect.succeed([]),
    videos: () => Effect.succeed(new Map<number, string>()),
    streamed: () => null,
  };
  const signals = await Effect.runPromise(magicSignalSongs("download", ["yt:outside"], deps));
  assert.equal(signals[0]?.radio?.videoId, "outside");
  assert.equal(signals[0]?.song.trackId, "yt:outside");
  assert.deepEqual(await Effect.runPromise(magicSignalSongs("skip", ["yt:outside"], deps)), []);
});
