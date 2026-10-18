import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { downloadJobKind, unsearchedTrackId } from "./index.ts";

describe("downloadJobKind", () => {
  test("a quality replacement names its direction and Track", () => {
    assert.deepEqual(downloadJobKind("upgrade:12"), {
      kind: "quality",
      direction: "upgrade",
      trackId: 12,
    });
    assert.deepEqual(downloadJobKind("downgrade:3"), {
      kind: "quality",
      direction: "downgrade",
      trackId: 3,
    });
  });

  test("a missing song's job names the Track it fills in", () => {
    assert.deepEqual(downloadJobKind("missing:7"), { kind: "missing", trackId: 7 });
  });

  test("an unsearched song's job is named after what Spotify listed", () => {
    const id = unsearchedTrackId({
      title: "Halo",
      artists: ["Beyoncé"],
      album: null,
      durationMs: 261_000,
      artworkUrl: null,
    });
    assert.deepEqual(downloadJobKind(id), { kind: "unsearched" });
  });

  test("any other job is a YT Music song's, by its own video", () => {
    assert.deepEqual(downloadJobKind("dQw4w9WgXcQ"), { kind: "song" });
    assert.deepEqual(downloadJobKind("missing:x"), { kind: "song" });
  });
});
