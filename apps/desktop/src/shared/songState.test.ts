import assert from "node:assert/strict";
import { test } from "node:test";
import { songRowMark } from "./songState.ts";

const file = { id: 7, path: "/m/road.mp3", unavailable: false };
const missing = { id: 7, path: null, unavailable: false };
const state = (
  download: Parameters<typeof songRowMark>[1] extends infer S
    ? S extends { download: infer D }
      ? D
      : never
    : never,
) => ({ id: 7, download, failed: false });

test("a song with a file plays, and one whose file failed to play says so", () => {
  assert.deepEqual(songRowMark(file, undefined), { kind: "play" });
  assert.deepEqual(songRowMark(file, { id: 7, download: null, failed: true }), { kind: "failed" });
});

test("a missing song is told apart from a broken one and offers its download", () => {
  assert.deepEqual(songRowMark(missing, undefined), { kind: "missing" });
  assert.deepEqual(songRowMark(missing, { id: 7, download: null, failed: true }), {
    kind: "missing",
  });
  assert.deepEqual(songRowMark(missing, state({ kind: "failed", reason: "notFound" })), {
    kind: "missing",
  });
});

test("a missing song on its way shows how much of its file arrived", () => {
  assert.deepEqual(songRowMark(missing, state({ kind: "queued" })), {
    kind: "downloading",
    progress: null,
  });
  assert.deepEqual(songRowMark(missing, state({ kind: "downloading", received: 25, total: 100 })), {
    kind: "downloading",
    progress: 0.25,
  });
  assert.deepEqual(songRowMark(missing, state({ kind: "saving" })), {
    kind: "downloading",
    progress: 1,
  });
});

test("a song on a drive that isn't connected and a streamed song keep their own marks", () => {
  assert.deepEqual(songRowMark({ ...file, unavailable: true }, undefined), {
    kind: "unavailable",
  });
  assert.deepEqual(
    songRowMark({ id: 0, path: null, unavailable: false, videoId: "abc" }, undefined),
    {
      kind: "play",
    },
  );
});
