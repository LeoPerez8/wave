import assert from "node:assert/strict";
import { test } from "node:test";
import { pcm16 } from "./recognize.ts";

test("captured samples go to the JVM as 16-bit little-endian PCM, clipped", () => {
  assert.deepEqual(
    [...pcm16(new Float32Array([0, 1, -1, 0.5, 2, -2]))],
    [0, 0, 0xff, 0x7f, 0x00, 0x80, 0x00, 0x40, 0xff, 0x7f, 0x00, 0x80],
  );
});
