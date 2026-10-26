import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { mergeCountedPlays } from "./index.ts";

describe("mergeCountedPlays", () => {
  test("adds the streamed plays that are a Library song's to its own, and keeps the rest by video id", () => {
    const merged = mergeCountedPlays({
      library: [
        { id: 1, countedPlays: 2, listenedMs: 400, latestPlayAt: 3_000 },
        { id: 2, countedPlays: 1, listenedMs: 100, latestPlayAt: 1_000 },
      ],
      streamed: [
        { videoId: "a", trackId: 1, countedPlays: 3, listenedMs: 600, latestPlayAt: 2_000 },
        { videoId: "b", trackId: 1, countedPlays: 1, listenedMs: 50, latestPlayAt: 9_000 },
        { videoId: "c", trackId: 5, countedPlays: 4, listenedMs: 800, latestPlayAt: 4_000 },
        { videoId: "d", trackId: null, countedPlays: 2, listenedMs: 300, latestPlayAt: 7_000 },
      ],
    });
    assert.deepEqual(
      merged.library,
      new Map([
        [1, { countedPlays: 6, listenedMs: 1_050, latestPlayAt: 9_000 }],
        [2, { countedPlays: 1, listenedMs: 100, latestPlayAt: 1_000 }],
        [5, { countedPlays: 4, listenedMs: 800, latestPlayAt: 4_000 }],
      ]),
    );
    assert.deepEqual(
      merged.online,
      new Map([["d", { countedPlays: 2, listenedMs: 300, latestPlayAt: 7_000 }]]),
    );
  });

  test("finds a queued song's plays by its queue track id, a streamed song the Library has as that song", () => {
    const merged = mergeCountedPlays({
      library: [
        { id: 1, countedPlays: 2, listenedMs: 0, latestPlayAt: 0 },
        { id: 7, countedPlays: 5, listenedMs: 0, latestPlayAt: 0 },
      ],
      streamed: [
        { videoId: "a", trackId: 1, countedPlays: 3, listenedMs: 0, latestPlayAt: 0 },
        { videoId: "d", trackId: null, countedPlays: 4, listenedMs: 0, latestPlayAt: 0 },
      ],
      // A downloaded song's video id, never streamed.
      libraryVideos: new Map([["dl", 7]]),
    });
    const counted = (id: string) => merged.of(id)?.countedPlays;
    assert.equal(counted("1"), 5);
    assert.equal(counted("yt:a"), 5);
    assert.equal(counted("yt:d"), 4);
    assert.equal(counted("yt:dl"), 5);
    assert.equal(counted("7"), 5);
    assert.equal(counted("yt:never"), undefined);
    assert.equal(counted("3"), undefined);
    assert.equal(counted("not a track id"), undefined);
  });
});
