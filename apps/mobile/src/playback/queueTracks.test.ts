/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { QueueEntry } from "@wave/core";

import type { SongRow } from "../library/LibraryStore.ts";
import {
  learnQueueTracks,
  lookupFailed,
  queueTracks,
  toQueueTrack,
  tracksToLookUp,
} from "./queueTracks.ts";

const song = (id: number, thumbPath: string | null = `/covers/${id}.thumb.jpg`): SongRow => ({
  id,
  path: `/music/${id}.flac`,
  title: `Song ${id}`,
  artist: `Artist ${id}`,
  album: `Album ${id}`,
  durationMs: 180_000,
  thumbPath,
  artworkPath: thumbPath === null ? null : `/covers/${id}.jpg`,
  titleSort: `song ${id}`,
  artistSort: `artist ${id}`,
  albumSort: `album ${id}`,
  addedAt: 0,
  albumId: id,
  artistId: id,
  discNumber: null,
  trackNumber: null,
});

const entry = (trackId: string, key = `k${trackId}`): QueueEntry => ({
  key,
  trackId,
  contextIndex: null,
});

beforeEach(() => learnQueueTracks([], { forgetOthers: true }));

describe("queue tracks", () => {
  test("a queued song carries its thumbnail for the queue rows", () => {
    assert.deepEqual(toQueueTrack(song(7)), {
      id: "7",
      path: "/music/7.flac",
      title: "Song 7",
      artist: "Artist 7",
      album: "Album 7",
      artworkPath: "/covers/7.jpg",
      thumbPath: "/covers/7.thumb.jpg",
    });
    assert.equal(toQueueTrack(song(8, null)).thumbPath, null);
  });

  test("learned tracks are there to read straight away, and tell subscribers", () => {
    let told = 0;
    const stop = queueTracks.subscribe(() => told++);
    learnQueueTracks([song(1), song(2)].map(toQueueTrack));
    learnQueueTracks([song(3)].map(toQueueTrack));
    stop();
    assert.equal(told, 2);
    assert.deepEqual([...queueTracks.get().keys()], ["1", "2", "3"]);
    assert.equal(queueTracks.get().get("2")?.title, "Song 2");
  });

  test("a new play forgets the old queue's tracks", () => {
    learnQueueTracks([song(1)].map(toQueueTrack));
    learnQueueTracks([song(2)].map(toQueueTrack), { forgetOthers: true });
    assert.deepEqual([...queueTracks.get().keys()], ["2"]);
  });

  test("nothing to learn leaves the tracks as they were", () => {
    learnQueueTracks([song(1)].map(toQueueTrack));
    const before = queueTracks.get();
    learnQueueTracks([]);
    assert.equal(queueTracks.get(), before);
  });
});

describe("tracksToLookUp", () => {
  test("asks only for tracks the queue doesn't know, each once", () => {
    learnQueueTracks([song(1)].map(toQueueTrack));
    const entries = [entry("1"), entry("2"), entry("3"), entry("2", "again")];
    assert.deepEqual(tracksToLookUp(entries), ["2", "3"]);
    // Asked already: opening the queue again doesn't ask again, even before the answer.
    assert.deepEqual(tracksToLookUp(entries), []);
  });

  test("a failed lookup is asked again next time", () => {
    assert.deepEqual(tracksToLookUp([entry("40")]), ["40"]);
    lookupFailed(["40"]);
    assert.deepEqual(tracksToLookUp([entry("40")]), ["40"]);
  });
});
