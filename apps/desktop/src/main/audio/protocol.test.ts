import assert from "node:assert/strict";
import { test } from "node:test";
import type { LoudnessResult, PlaybackStatus } from "../../shared/playback.ts";
import {
  answer,
  outputsEvent,
  playbackEvent,
  stamped,
  type AddonEngine,
  type AudioCall,
} from "./protocol.ts";

const paused: PlaybackStatus = { state: "paused", positionMs: 0, durationMs: 1000 };

/** An addon that records its calls and refuses files named "missing", as the real one does. */
const fakeEngine = () => {
  const calls: string[] = [];
  let status: PlaybackStatus = { state: "idle", positionMs: 0 };
  const engine: AddonEngine = {
    load: (path, key, gainDb) => {
      calls.push(
        `load ${path}${key === undefined ? "" : ` ${key}`}${gainDb === undefined ? "" : ` ${gainDb}dB`}`,
      );
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
    preload: (path, key, gainDb, fade) =>
      void calls.push(`preload ${path} ${key} ${gainDb} ${fade}`),
    transitions: () => [],
    measurements: () => [],
    setVolume: () => {},
    setCrossfade: (seconds) => void calls.push(`crossfade ${seconds}`),
    setNormalize: (on) => void calls.push(`normalize ${on}`),
    measure: (path, id) => void calls.push(`measure ${path} ${id}`),
    cancelMeasurements: () => void calls.push("cancel measurements"),
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

test("the playback settings and each song's gain and fade reach the engine", () => {
  const { engine, calls } = fakeEngine();
  const requests: [AudioCall, unknown[]][] = [
    ["load", ["/music/a.flac", "1", -4.5]],
    ["preload", ["/music/b.flac", "2", 2, false]],
    ["preload", ["/music/c.flac", "3", null, true]],
    ["preload", [null, null, null, null]],
    ["setCrossfade", [6.5]],
    ["setNormalize", [false]],
    ["measure", ["/music/d.flac", "m1"]],
    ["cancelMeasurements", []],
  ];
  requests.forEach(([call, args], id) => assert.equal(answer(engine, { id, call, args }).ok, true));
  assert.deepEqual(calls, [
    "load /music/a.flac 1 -4.5dB",
    "preload /music/b.flac 2 2 false",
    "preload /music/c.flac 3 undefined true",
    "preload undefined undefined undefined undefined",
    "crossfade 6.5",
    "normalize false",
    "measure /music/d.flac m1",
    "cancel measurements",
  ]);
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

test("the process reports playback only when the status moved or the engine changed songs", () => {
  const { engine } = fakeEngine();
  let transitions: { key: string; atMs: number }[] = [];
  const watched: AddonEngine = { ...engine, transitions: () => transitions.splice(0) };
  const first = playbackEvent(watched, undefined, 100);
  assert.deepEqual(first, {
    event: "playback",
    status: { state: "idle", positionMs: 0, observedAtMs: 100 },
    transitions: [],
  });
  assert.equal(playbackEvent(watched, first!.status, 125), undefined, "nothing moved");
  transitions = [{ key: "2", atMs: 140 }];
  assert.deepEqual(playbackEvent(watched, first!.status, 150)?.transitions, [
    { key: "2", atMs: 140 },
  ]);
  engine.seek(300);
  assert.equal(playbackEvent(watched, first!.status, 175)?.status.positionMs, 300);
});

test("finished measurements are reported as soon as there are any", () => {
  const { engine } = fakeEngine();
  let measured: LoudnessResult[] = [];
  const watched: AddonEngine = { ...engine, measurements: () => measured.splice(0) };
  const first = playbackEvent(watched, undefined, 100);
  assert.equal(first?.measurements, undefined);
  measured = [{ id: "m1", kind: "measured", loudness: -9.5, peak: 0.8 }];
  assert.deepEqual(playbackEvent(watched, first!.status, 125)?.measurements, [
    { id: "m1", kind: "measured", loudness: -9.5, peak: 0.8 },
  ]);
  assert.equal(playbackEvent(watched, first!.status, 150), undefined);
});

test("an answer carries the time the process took it", () => {
  const { engine } = fakeEngine();
  const response = stamped(answer(engine, { id: 1, call: "status", args: [] }), 500);
  assert.deepEqual(response, {
    id: 1,
    ok: true,
    result: { state: "idle", positionMs: 0, observedAtMs: 500 },
  });
  const refused = answer(engine, { id: 2, call: "load", args: ["/missing"] });
  assert.equal(stamped(refused, 500), refused);
});

test("the outputs are reported when the process starts and each time the list changes", () => {
  const { engine } = fakeEngine();
  let outputs = [{ id: "wasapi:speakers", name: "Speakers" }];
  const watched: AddonEngine = { ...engine, outputs: () => outputs };
  const first = outputsEvent(watched, undefined);
  assert.deepEqual(first, { event: "outputs", outputs });
  assert.equal(outputsEvent(watched, first!.outputs), undefined);
  outputs = [...outputs, { id: "wasapi:headphones", name: "Headphones" }];
  assert.deepEqual(outputsEvent(watched, first!.outputs)?.outputs, outputs);
  // An engine built before outputs could be picked has only the system's default.
  assert.deepEqual(outputsEvent(engine, undefined), { event: "outputs", outputs: [] });
});

test("picking an output reaches the engine, and none means the system's default", () => {
  const { engine } = fakeEngine();
  const picked: (string | undefined)[] = [];
  const picks: AddonEngine = { ...engine, setOutput: (id) => void picked.push(id) };
  assert.equal(answer(picks, { id: 1, call: "setOutput", args: ["wasapi:headphones"] }).ok, true);
  assert.equal(answer(picks, { id: 2, call: "setOutput", args: [null] }).ok, true);
  assert.deepEqual(picked, ["wasapi:headphones", undefined]);
  assert.equal(answer(engine, { id: 3, call: "setOutput", args: ["wasapi:headphones"] }).ok, true);
});
