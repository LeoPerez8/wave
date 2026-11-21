import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { recognizeHandlers } from "./recognizeHandlers.ts";
import { Recognize, type RecognizeShape } from "./recognizeLayer.ts";

/** Runs a call against a Recognize that records what reached it. */
const calls: string[] = [];
const fake = {
  start: (source) => {
    calls.push(`start ${source}`);
    return null as never;
  },
  view: () => null as never,
  close: () => void calls.push("close"),
  audio: (session, pcm) => void calls.push(`audio ${session} ${pcm.length}`),
  captureEnded: (session, why) => void calls.push(`ended ${session} ${why}`),
  run: async (action, playlistId) => {
    calls.push(`run ${action} ${playlistId}`);
    return { kind: "done" };
  },
  allows: () => false,
} satisfies RecognizeShape;
const call = (name: keyof typeof recognizeHandlers, ...args: unknown[]) =>
  Effect.runPromise(
    recognizeHandlers[name](args).pipe(
      Effect.provideService(Recognize, fake),
    ) as Effect.Effect<unknown>,
  );

test("main hears only well-formed Recognize calls", async () => {
  calls.length = 0;
  await call("recognize.start", "microphone");
  await call("recognize.start", "playback");
  await assert.rejects(call("recognize.start", "camera"));
  await call("recognize.audio", 3, new Uint8Array(4));
  await assert.rejects(call("recognize.audio", 3, new Uint8Array(3)), "half a sample");
  await assert.rejects(call("recognize.audio", 3, [1, 0]), "not bytes");
  await assert.rejects(call("recognize.audio", 3, new Uint8Array(64_002)), "too long a piece");
  await assert.rejects(call("recognize.audio", 0, new Uint8Array(2)));
  await call("recognize.captureEnded", 3, "denied");
  await assert.rejects(call("recognize.captureEnded", 3, "bored"));
  await call("recognize.run", "addToShazam");
  await call("recognize.run", "addToPlaylist", 9);
  await assert.rejects(call("recognize.run", "addToPlaylist"));
  await assert.rejects(call("recognize.run", "play", 9));
  await assert.rejects(call("recognize.run", "deleteSong"));
  assert.deepEqual(calls, [
    "start microphone",
    "start playback",
    "audio 3 4",
    "ended 3 denied",
    "run addToShazam undefined",
    "run addToPlaylist 9",
  ]);
});
