import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlaybackStatus } from "../../shared/playback.ts";
import type { ResolveEvent, ResolvedStream, StreamState, StreamingEngine } from "./protocol.ts";
import { streaming } from "./streaming.ts";

const address: ResolvedStream = {
  url: "https://example.invalid/a",
  headers: {},
  itag: 140,
  mimeType: "audio/mp4",
  contentLength: 1000,
};

/** An engine whose songs arrive `arriveMs` after their address, and which logs its calls. */
const fakeEngine = (arriveMs = 5) => {
  const calls: string[] = [];
  const states = new Map<string, StreamState>();
  const expired: { id: number; videoId: string }[] = [];
  const answers: string[] = [];
  let status: PlaybackStatus = { state: "idle", positionMs: 0 };
  const engine: StreamingEngine = {
    load: (path) => {
      calls.push(`load ${path}`);
      status = { state: "paused", positionMs: 0, durationMs: 1000 };
      return status;
    },
    preload: (path) => void calls.push(`preload ${path ?? "-"}`),
    setVolume: () => {},
    setCrossfade: () => {},
    setNormalize: () => {},
    measure: () => {},
    cancelMeasurements: () => {},
    measurements: () => [],
    transitions: () => [],
    play: () => {
      calls.push("play");
      status = { ...status, state: "playing" };
    },
    pause: () => {},
    seek: () => {},
    status: () => status,
    openStream: (videoId) => {
      calls.push(`open ${videoId}`);
      states.set(videoId, "loading");
      if (arriveMs >= 0) setTimeout(() => states.set(videoId, "ready"), arriveMs);
    },
    streamState: (videoId) => states.get(videoId) ?? "missing",
    streamRequests: () => expired.splice(0),
    answerStream: (id, given, error) => void answers.push(`${id}:${given?.itag ?? error}`),
  };
  return { engine, calls, states, expired, answers };
};

/** Main, answering every request for an address with `reply`. */
const fakeMain = (reply: (event: ResolveEvent) => "ok" | string = () => "ok") => {
  const asked: ResolveEvent[] = [];
  let resolvedBy:
    ((answer: Parameters<ReturnType<typeof streaming>["resolved"]>[0]) => void) | undefined;
  const post = (event: ResolveEvent) => {
    asked.push(event);
    const how = reply(event);
    setTimeout(() =>
      resolvedBy?.(
        how === "ok"
          ? { resolved: event.id, address }
          : { resolved: event.id, error: { code: how, message: "no" } },
      ),
    );
  };
  return { asked, post, connect: (to: typeof resolvedBy) => (resolvedBy = to) };
};

const setup = (arriveMs = 5, reply?: (event: ResolveEvent) => "ok" | string) => {
  const engine = fakeEngine(arriveMs);
  const main = fakeMain(reply);
  const stream = streaming(engine.engine, main.post, undefined, { readyTimeoutMs: 200, pollMs: 2 });
  main.connect(stream.resolved);
  return { ...engine, main, stream };
};

test("a YT Music song is resolved, handed to the engine and loaded once it arrives", async () => {
  const { stream, calls, main } = setup();
  const response = await stream.handle({ id: 1, call: "load", args: ["yt:abcdefghijk", "k1"] });
  assert.equal(response.ok, true);
  assert.deepEqual(main.asked, [{ event: "resolve", id: 1, videoId: "abcdefghijk", fresh: false }]);
  assert.deepEqual(calls, ["open abcdefghijk", "load yt:abcdefghijk"]);
});

test("a cached song loads without asking for an address; a failed one asks for a fresh one", async () => {
  const { stream, states, main } = setup();
  states.set("cachedsong1", "cached");
  assert.equal((await stream.handle({ id: 1, call: "load", args: ["yt:cachedsong1"] })).ok, true);
  assert.equal(main.asked.length, 0);
  states.set("brokensong1", "failed");
  assert.equal((await stream.handle({ id: 2, call: "load", args: ["yt:brokensong1"] })).ok, true);
  assert.equal(main.asked[0]?.fresh, true);
});

test("a song main can't resolve fails the load with main's code", async () => {
  const { stream, calls } = setup(5, () => "ERR_YT_OFFLINE");
  const response = await stream.handle({ id: 1, call: "load", args: ["yt:abcdefghijk"] });
  assert.deepEqual(response, {
    id: 1,
    ok: false,
    error: { code: "ERR_YT_OFFLINE", message: "no" },
  });
  assert.deepEqual(calls, []);
});

test("a song that never arrives fails the load in time", async () => {
  const { stream } = setup(-1);
  const response = await stream.handle({ id: 1, call: "load", args: ["yt:abcdefghijk"] });
  assert.equal(response.ok ? "" : response.error.code, "stream-timeout");
});

test("a call after a load waits for it, and status answers at once", async () => {
  const { stream, calls } = setup(20);
  const load = stream.handle({ id: 1, call: "load", args: ["yt:abcdefghijk"] });
  const play = stream.handle({ id: 2, call: "play", args: [] });
  const status = await stream.handle({ id: 3, call: "status", args: [] });
  assert.equal(status.ok && status.result.state, "idle");
  await Promise.all([load, play]);
  assert.deepEqual(calls, ["open abcdefghijk", "load yt:abcdefghijk", "play"]);
});

test("files play as before", async () => {
  const { stream, calls, main } = setup();
  assert.equal((await stream.handle({ id: 1, call: "load", args: ["/music/a.flac"] })).ok, true);
  assert.deepEqual(calls, ["load /music/a.flac"]);
  assert.equal(main.asked.length, 0);
});

test("a YT Music song lined up next answers at once and lines up once it's here", async () => {
  const { stream, calls } = setup(10);
  const response = await stream.handle({ id: 1, call: "preload", args: ["yt:nextsong001", "k2"] });
  assert.equal(response.ok, true);
  assert.deepEqual(calls, ["preload -"], "the song lined up before is dropped at once");
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.deepEqual(calls, ["preload -", "open nextsong001", "preload yt:nextsong001"]);
});

test("a preload that arrives after a newer load or preload isn't lined up", async () => {
  const { stream, calls } = setup(10);
  await stream.handle({ id: 1, call: "preload", args: ["yt:nextsong001", "k2"] });
  await stream.handle({ id: 2, call: "load", args: ["/music/b.flac", "k3"] });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.ok(!calls.includes("preload yt:nextsong001"), calls.join(", "));
});

test("an address that expires while fetching is resolved again through main", async () => {
  const { stream, expired, answers, main } = setup();
  expired.push({ id: 9, videoId: "abcdefghijk" });
  stream.pump();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(main.asked, [{ event: "resolve", id: 1, videoId: "abcdefghijk", fresh: true }]);
  assert.deepEqual(answers, ["9:140"]);
});

/** Main that never answers a request for an address, as when the JVM hangs. */
const silentMain = (arriveMs = 5) => {
  const engine = fakeEngine(arriveMs);
  const asked: ResolveEvent[] = [];
  const stream = streaming(engine.engine, (event) => void asked.push(event), undefined, {
    readyTimeoutMs: 200,
    resolveTimeoutMs: 40,
    pollMs: 2,
  });
  return { ...engine, asked, stream };
};

test("an address that never comes fails the load in time, and the calls behind it run", async () => {
  const { stream, calls } = silentMain();
  const started = Date.now();
  const load = stream.handle({ id: 1, call: "load", args: ["yt:abcdefghijk"] });
  const pause = stream.handle({ id: 2, call: "pause", args: [] });
  const response = await load;
  assert.equal(response.ok ? "" : response.error.code, "stream-timeout");
  assert.equal((await pause).ok, true);
  assert.ok(Date.now() - started < 190, "well before the wait for the song's bytes is over");
  assert.deepEqual(calls, []);
  // An answer that comes after all is dropped.
  stream.resolved({ resolved: 1, address });
  assert.deepEqual(calls, []);
});

test("a newer load ends the wait of a load still fetching its song", async () => {
  const { stream, calls } = setup(-1);
  const started = Date.now();
  const first = stream.handle({ id: 1, call: "load", args: ["yt:abcdefghijk", "k1"] });
  const play = stream.handle({ id: 2, call: "play", args: [] });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const second = await stream.handle({ id: 3, call: "load", args: ["/music/b.flac", "k2"] });
  assert.ok(Date.now() - started < 150, "the second load didn't wait for the first to time out");
  assert.equal(second.ok, true);
  const superseded = await first;
  assert.equal(superseded.ok ? "" : superseded.error.code, "superseded");
  const played = await play;
  assert.equal(played.ok ? "" : played.error.code, "superseded", "it was meant for the first song");
  assert.deepEqual(calls, ["open abcdefghijk", "load /music/b.flac"]);
});

test("a load still waiting its turn is skipped once a newer one comes", async () => {
  const { stream, calls } = setup(-1);
  const first = stream.handle({ id: 1, call: "load", args: ["yt:abcdefghijk"] });
  const second = stream.handle({ id: 2, call: "load", args: ["/music/b.flac"] });
  const third = await stream.handle({ id: 3, call: "load", args: ["/music/c.flac"] });
  assert.equal(third.ok, true);
  for (const response of [await first, await second])
    assert.equal(response.ok ? "" : response.error.code, "superseded");
  assert.deepEqual(calls, ["load /music/c.flac"]);
});

test("the volume and the playback settings don't wait for a song being fetched", async () => {
  const { stream } = setup(-1);
  const load = stream.handle({ id: 1, call: "load", args: ["yt:abcdefghijk"] });
  const started = Date.now();
  for (const [n, call] of (["setVolume", "setCrossfade", "setNormalize"] as const).entries())
    assert.equal((await stream.handle({ id: 10 + n, call, args: [1] })).ok, true);
  assert.equal((await stream.handle({ id: 20, call: "cancelMeasurements", args: [] })).ok, true);
  assert.ok(Date.now() - started < 100);
  assert.equal((await load).ok, false);
});
