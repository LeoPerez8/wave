import assert from "node:assert/strict";
import { test } from "node:test";
import { createMediaIntegration } from "./media.ts";

test("system commands control playback, clamp seeks, and can raise a hidden Wave", async () => {
  let state = "playing";
  let position = 30_000;
  let shown = 0;
  const moves: string[] = [];
  const media = createMediaIntegration({
    view: () => ({
      state,
      positionMs: position,
      durationMs: 60_000,
      song: {
        key: "1",
        title: "Pink Moon",
        artist: "Nick Drake",
        album: "Pink Moon",
        coverUrl: null,
      },
    }),
    play: async () => {
      state = "playing";
    },
    pause: async () => {
      state = "paused";
    },
    skip: async (action) => {
      moves.push(action);
    },
    seek: async (ms) => {
      position = ms;
    },
    show: () => {
      shown++;
    },
    quit: () => {},
    publish: () => {},
  });
  await media.command({ action: "toggle" });
  assert.equal(state, "paused");
  await media.command({ action: "play" });
  assert.equal(state, "playing");
  await media.command({ action: "next" });
  await media.command({ action: "previous" });
  assert.deepEqual(moves, ["next", "previous"]);
  await media.command({ action: "seekBy", value: -40_000 });
  assert.equal(position, 0);
  await media.command({ action: "seek", value: 80_000 });
  assert.equal(position, 60_000);
  await media.command({ action: "seek", value: Number.NaN });
  assert.equal(position, 60_000);
  await media.command({ action: "raise" });
  assert.equal(shown, 1);
});
