import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { recapSong, type PlayTotals, type RecapSlide } from "./index.ts";

const song = (id: number): PlayTotals => ({
  id,
  sortKey: `song ${id}`,
  countedPlays: 10 - id,
  listenedMs: 0,
  latestPlayAt: 0,
});
const slides: RecapSlide[] = [
  { kind: "minutes", minutes: 180 },
  { kind: "topSongs", songs: [song(7), song(3), song(5)] },
];

describe("recapSong", () => {
  test("with nothing playing, a slide that features no song plays the Recap's #1", () => {
    assert.equal(recapSong(slides, 0, { playingBefore: false })?.id, 7);
  });

  test("with something playing as the Recap opened, it plays nothing", () => {
    assert.equal(recapSong(slides, 0, { playingBefore: true }), null);
    assert.equal(recapSong(slides, 1, { playingBefore: true }), null);
  });

  test("a slide that features a song plays that one while it shows", () => {
    const featuring = [...slides, { kind: "topSongs", songs: [song(2)] }];
    assert.equal(recapSong(featuring, 2, { playingBefore: false })?.id, 2);
  });

  test("a Recap without a song plays nothing", () => {
    const minutesOnly: RecapSlide[] = [{ kind: "minutes", minutes: 180 }];
    assert.equal(recapSong(minutesOnly, 0, { playingBefore: false }), null);
  });
});
