import assert from "node:assert/strict";
import { test } from "node:test";

import { trackRowDownloaded, unsearchedTrackId } from "./index.ts";

test("a Library song with a file carries the downloaded icon without online songs or settings", () => {
  assert.equal(trackRowDownloaded({ trackId: "42" }), true);
});

test("a missing Library song has no downloaded icon", () => {
  assert.equal(trackRowDownloaded({ trackId: "42", missing: true }), false);
});

test("a Library file no longer found has no downloaded icon", () => {
  assert.equal(trackRowDownloaded({ trackId: "42", fileNotFound: true }), false);
});

test("streamed, unsearched and unavailable songs have no downloaded icon", () => {
  const unsearched = unsearchedTrackId({
    title: "One",
    artists: ["Artist"],
    album: "Album",
    durationMs: 180_000,
    artworkUrl: null,
  });
  for (const trackId of ["yt:video", unsearched, "unavailable:One", ""]) {
    assert.equal(trackRowDownloaded({ trackId }), false, trackId);
  }
});

test("a missing song gains the downloaded icon once its Library file is filled", () => {
  assert.equal(trackRowDownloaded({ trackId: "42", missing: true }), false);
  assert.equal(trackRowDownloaded({ trackId: "42", missing: false }), true);
});
