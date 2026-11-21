/**
 * #1350: a Magic Queue batch's ranking and a scan's reconciliation, run
 * through the background work's slices, never hold the JavaScript thread for
 * more than sliceMs at a time, whatever the work's size.
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createBackgroundWork,
  rankRadioSongsSteps,
  reconcileScanSteps,
  type YtAlbumSong,
} from "./index.ts";

/** Background work on a virtual clock that each step of the work moves on. */
const setup = () => {
  let time = 0;
  const slices: number[] = [];
  const work = createBackgroundWork({
    now: () => time,
    schedule: () => () => {},
    sliceRan: (_name, _at, durationMs) => slices.push(durationMs),
  });
  const run = <A>(name: string, steps: Iterator<void, A>): A => {
    for (;;) {
      const slice = work.runSlice(name, steps);
      if (slice.done) return slice.value;
    }
  };
  return { run, slices, cost: (ms: number) => (time += ms) };
};

const song = (videoId: string): YtAlbumSong => ({
  videoId,
  title: videoId,
  artists: [`artist ${videoId}`],
  album: null,
  albumId: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
});

describe("background slices stay within 8 ms", () => {
  test("a Magic Queue batch ranking 600 radio songs at 1.5 ms each", () => {
    const { run, slices, cost } = setup();
    const songs = Array.from({ length: 600 }, (_, index) => song(`v${index}`));
    const ranked = run(
      "Magic Queue batch",
      rankRadioSongsSteps(
        { artists: ["Seed"] },
        {
          pages: [{ id: "song:seed", artists: ["Seed"], songs }],
          // Each song's genre lookup stands for the work its ranking costs.
          profileOf: () => {
            cost(1.5);
            return null;
          },
        },
      ),
    );
    assert.equal(ranked.length, 600);
    assert.equal(ranked[0]!.trackId, "yt:v0");
    assert.equal(ranked[599]!.trackId, "yt:v599");
    assert.ok(slices.length >= 600 / 5, `${slices.length} slices`);
    assert.ok(Math.max(...slices) <= 8, `longest slice ${Math.max(...slices)} ms`);
  });

  test("a scan reconciling 2,000 read files at 0.7 ms each", () => {
    const { run, slices, cost } = setup();
    const read = Array.from({ length: 2000 }, (_, index) => ({
      path: `/music/${index}.mp3`,
      sizeBytes: 1000 + index,
      durationMs: 180000,
      title: `Song ${index}`,
      artist: "Artist",
    }));
    const changes = run(
      "scan",
      reconcileScanSteps({
        missing: [],
        read,
        isIndexed: () => {
          cost(0.7);
          return false;
        },
      }),
    );
    assert.equal(changes.added.length, 2000);
    assert.ok(Math.max(...slices) <= 8, `longest slice ${Math.max(...slices)} ms`);
  });
});
