import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  libraryTrackIds,
  playerErrorNotice,
  queuedYtTracks,
  restorePlayback,
  restorableTrack,
  type QueueEntry,
  type QueueState,
} from "./index.ts";

const entry = (key: string, trackId: string): QueueEntry => ({ key, trackId, contextIndex: null });

const queue = (entries: readonly QueueEntry[], index: number): QueueState => ({
  context: { kind: "search", id: null },
  entries,
  index,
  shuffle: false,
  repeat: "off",
  nextKey: entries.length + 1,
});

describe("restorableTrack", () => {
  const saved = queue(
    [entry("1", "11"), entry("2", "yt:dQw4w9WgXcQ"), entry("3", "12"), entry("4", "yt:gone")],
    1,
  );

  test("a restored queue keeps its Library tracks and the YT Music songs it saved", () => {
    const restored = restorePlayback(
      saved,
      42_000,
      restorableTrack({
        libraryIds: new Set([11, 12]),
        savedYtTracks: new Set(["yt:dQw4w9WgXcQ"]),
        ytMusicOn: true,
      }),
    );
    assert.deepEqual(
      restored?.state.entries.map((kept) => kept.trackId),
      ["11", "yt:dQw4w9WgXcQ", "12"],
    );
    assert.equal(restored?.positionMs, 42_000);
  });

  test("with YT Music off, its songs are left out and the Library's play on", () => {
    const restored = restorePlayback(
      saved,
      42_000,
      restorableTrack({
        libraryIds: new Set([11, 12]),
        savedYtTracks: new Set(["yt:dQw4w9WgXcQ"]),
        ytMusicOn: false,
      }),
    );
    assert.deepEqual(
      restored?.state.entries.map((kept) => kept.trackId),
      ["11", "12"],
    );
    // The current song went, so the next one starts from the top.
    assert.equal(restored?.state.index, 1);
    assert.equal(restored?.positionMs, 0);
  });

  test("ids that are neither a Library track nor a YT Music song are left out", () => {
    const available = restorableTrack({
      libraryIds: new Set([11]),
      savedYtTracks: new Set(),
      ytMusicOn: true,
    });
    assert.equal(available("11"), true);
    assert.equal(available("13"), false);
    assert.equal(available("yt:"), false);
    assert.equal(available("song"), false);
  });
});

describe("libraryTrackIds", () => {
  test("the Library tracks of a queue mixing them with YT Music songs, each once", () => {
    assert.deepEqual(
      libraryTrackIds(["11", "yt:dQw4w9WgXcQ", "12", "11", "yt:x", "song"]),
      [11, 12],
    );
  });
});

describe("queuedYtTracks", () => {
  test("the details to keep with a queue: its YT Music songs', each once, in queue order", () => {
    const known = new Map([
      ["11", { id: "11", title: "Library song" }],
      ["yt:a", { id: "yt:a", title: "First" }],
      ["yt:b", { id: "yt:b", title: "Second" }],
      ["yt:c", { id: "yt:c", title: "Not queued any more" }],
    ]);
    const entries = [entry("1", "yt:b"), entry("2", "11"), entry("3", "yt:a"), entry("4", "yt:b")];
    assert.deepEqual(
      queuedYtTracks(entries, known).map((track) => track.title),
      ["Second", "First"],
    );
  });

  test("a YT Music song whose details aren't known is skipped", () => {
    assert.deepEqual(queuedYtTracks([entry("1", "yt:unknown")], new Map()), []);
  });
});

describe("playerErrorNotice", () => {
  test("a YT Music song that can't stream says why, in a line", () => {
    assert.equal(
      playerErrorNotice("ytOffline"),
      "You're offline. YT Music songs need the network.",
    );
    assert.equal(playerErrorNotice("ytDisabled"), "YT Music is off in Settings.");
    assert.equal(playerErrorNotice("ytUnavailable"), "YT Music won't stream this song.");
    assert.equal(playerErrorNotice("ytFailed"), "YT Music didn't send this song. Try again.");
  });

  test("anything else is a file Wave couldn't play", () => {
    assert.equal(playerErrorNotice(null), "Couldn't play this file");
    assert.equal(playerErrorNotice("somethingNew"), "Couldn't play this file");
  });
});
