import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { createKnownVideosRead } from "./knownVideosRead.ts";
import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";
import { selectKnownVideos } from "../library/db/mixKnown.ts";

test("unchanged Home return and two sections read zero known-video rows; only relevant source changes reread", async () => {
  const fixture = await createFastAgainFixture();
  try {
    let reads = 0;
    const read = createKnownVideosRead(
      Effect.sync(() => {
        reads++;
        return selectKnownVideos(fixture.db);
      }),
    );
    const initial = await Effect.runPromise(read.get);
    assert.equal(reads, 1);
    assert.deepEqual(
      await Promise.all([Effect.runPromise(read.get), Effect.runPromise(read.get)]),
      [initial, initial],
    );
    assert.equal(reads, 1);
    read.change({ kind: "favorites" });
    read.change({ kind: "folders" });
    await Effect.runPromise(read.get);
    assert.equal(reads, 1);
    for (const kind of ["plays", "tracks", "playlists", "streamed"] as const) {
      read.change({ kind });
      await Promise.all([Effect.runPromise(read.get), Effect.runPromise(read.get)]);
    }
    assert.equal(reads, 5);
    read.dispose();
  } finally {
    fixture.close();
  }
});
