import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlaybackStatus } from "../../shared/playback.ts";
import { answer, type AddonEngine } from "./protocol.ts";

const paused: PlaybackStatus = { state: "paused", positionMs: 0, durationMs: 1000 };

/** An addon that records its calls and refuses files named "missing", as the real one does. */
const fakeEngine = () => {
  const calls: string[] = [];
  let status: PlaybackStatus = { state: "idle", positionMs: 0 };
  const engine: AddonEngine = {
    load: (path) => {
      calls.push(`load ${path}`);
      if (path.includes("missing")) throw new Error("[not-found] can't read the file: gone");
      status = paused;
      return status;
    },
    play: () => {
      calls.push("play");
      status = { ...status, state: "playing" };
    },
    pause: () => void calls.push("pause"),
    seek: (positionMs) => {
      calls.push(`seek ${positionMs}`);
      status = { ...status, positionMs };
    },
    status: () => status,
  };
  return { engine, calls };
};

test("each request runs on the engine and answers with the status after it", () => {
  const { engine, calls } = fakeEngine();
  assert.deepEqual(answer(engine, { id: 1, call: "load", args: ["/music/a.flac"] }), {
    id: 1,
    ok: true,
    result: paused,
  });
  assert.deepEqual(answer(engine, { id: 2, call: "seek", args: [400] }), {
    id: 2,
    ok: true,
    result: { ...paused, positionMs: 400 },
  });
  assert.equal(answer(engine, { id: 3, call: "play", args: [] }).ok, true);
  assert.deepEqual(answer(engine, { id: 4, call: "status", args: [] }), {
    id: 4,
    ok: true,
    result: { state: "playing", positionMs: 400, durationMs: 1000 },
  });
  assert.deepEqual(calls, ["load /music/a.flac", "seek 400", "play"]);
});

test("a refused call answers with the engine's code and message", () => {
  const { engine } = fakeEngine();
  assert.deepEqual(answer(engine, { id: 7, call: "load", args: ["/music/missing.mp3"] }), {
    id: 7,
    ok: false,
    error: { code: "not-found", message: "can't read the file: gone" },
  });
});

test("an unknown call or a broken addon answers with an error instead of throwing", () => {
  const { engine } = fakeEngine();
  const unknown = answer(engine, { id: 8, call: "eject" as never, args: [] });
  assert.deepEqual(unknown, {
    id: 8,
    ok: false,
    error: { code: "unknown-call", message: "eject" },
  });
  const broken = answer(undefined, { id: 9, call: "status", args: [] });
  assert.equal(broken.ok, false);
  assert.equal(!broken.ok && broken.error.code, "unavailable");
});
