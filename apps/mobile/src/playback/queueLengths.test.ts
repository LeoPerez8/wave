import assert from "node:assert/strict";
import { test } from "node:test";
import { makeQueueLengths } from "./queueLengths.ts";
import type { QueueTrack } from "./queueTracks.ts";

const streamed = (id: string, durationMs: number | null): [string, QueueTrack] => [
  id,
  {
    id,
    path: "",
    title: id,
    artist: "Artist",
    album: null,
    artworkPath: null,
    thumbPath: null,
    ytSong: {
      videoId: id.slice(3),
      title: id,
      artists: ["Artist"],
      album: null,
      albumId: null,
      durationMs,
      artworkUrl: null,
      explicit: false,
    },
  },
];

test("a streamed song's length comes with its queue track, a Library song's once it was read", () => {
  const lengths = makeQueueLengths();
  const tracks = new Map([streamed("yt:a", 200_000), streamed("yt:b", null)]);
  assert.equal(lengths.of("yt:a", tracks), 200_000);
  assert.equal(lengths.of("yt:b", tracks), null);
  assert.equal(lengths.of("12", tracks), null);
  assert.deepEqual(lengths.missing(["yt:a", "12", "13", "12", "unsearched:x"]), [12, 13]);
  lengths.learn([12, 13], [{ id: 12, durationMs: 180_000 }]);
  assert.equal(lengths.of("12", tracks), 180_000);
  // A song the Library no longer has stays unknown and isn't asked for again.
  assert.equal(lengths.of("13", tracks), null);
  assert.deepEqual(lengths.missing(["12", "13", "14"]), [14]);
});
