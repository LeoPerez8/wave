import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlaybackStatus } from "../../shared/playback.ts";
import { answer, type AddonEngine, type AudioRequest } from "./protocol.ts";
import { AudioEngineError, superviseAudio, type AudioEvents } from "./supervisor.ts";

/** A pretend engine, kept across restarts only in what `log` records. */
const pretendEngine = (): AddonEngine => {
  let status: PlaybackStatus = { state: "idle", positionMs: 0 };
  return {
    load: (path) => {
      if (path.includes("missing")) throw new Error("[not-found] can't read the file");
      status = { state: "paused", positionMs: 0, durationMs: 180_000 };
      return status;
    },
    play: () => void (status = { ...status, state: "playing" }),
    pause: () => void (status = { ...status, state: "paused" }),
    seek: (positionMs) => void (status = { ...status, positionMs }),
    status: () => status,
  };
};

/**
 * Audio processes as main sees them: each fork gets a fresh engine. `stall` makes the current
 * one stop answering; `crash` makes it exit.
 */
const fakeProcesses = () => {
  const log: string[] = [];
  let forks = 0;
  let current: { events: AudioEvents; stalled: boolean; alive: boolean } | undefined;
  const fork = (events: AudioEvents) => {
    forks += 1;
    const engine = pretendEngine();
    const child = { events, stalled: false, alive: true, loaded: "" };
    current = child;
    return {
      send: (request: AudioRequest) => {
        log.push(`${forks}:${request.call}${request.args.length > 0 ? ` ${request.args[0]}` : ""}`);
        if (child.stalled || !child.alive) return;
        if (request.call === "load") child.loaded = String(request.args[0]);
        // A song whose decoding crashes the process, from the first restart on.
        if (request.call === "seek" && child.loaded.includes("poison") && forks > 1) {
          child.alive = false;
          setImmediate(events.exit);
          return;
        }
        const response = answer(engine, request);
        queueMicrotask(() => child.alive && events.message(response));
      },
      kill: () => {
        if (!child.alive) return;
        child.alive = false;
        log.push(`${forks}:killed`);
        setImmediate(events.exit);
      },
    };
  };
  return {
    fork,
    log,
    forks: () => forks,
    stall: () => {
      if (current !== undefined) current.stalled = true;
    },
    crash: () => {
      if (current === undefined) return;
      current.alive = false;
      setImmediate(current.events.exit);
    },
  };
};

const settle = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

const quick = { callTimeoutMs: 100, heartbeatMs: 1_000_000, restartDelayMs: () => 0 };

test("calls reach the engine and come back with its status", async () => {
  const processes = fakeProcesses();
  const audio = superviseAudio({ fork: processes.fork, ...quick });
  assert.equal((await audio.call("load", ["/music/a.opus"])).durationMs, 180_000);
  await audio.call("seek", [60_000]);
  const playing = await audio.call("play", []);
  assert.deepEqual(playing, { state: "playing", positionMs: 60_000, durationMs: 180_000 });
  assert.equal(processes.forks(), 1);
  audio.dispose();
});

test("a refused call rejects with the engine's code", async () => {
  const processes = fakeProcesses();
  const audio = superviseAudio({ fork: processes.fork, ...quick });
  await assert.rejects(audio.call("load", ["/music/missing.mp3"]), (error) => {
    assert.ok(error instanceof AudioEngineError);
    assert.equal(error.code, "not-found");
    return true;
  });
  audio.dispose();
});

test("after a crash a new process takes over, paused where the song was", async () => {
  const processes = fakeProcesses();
  const audio = superviseAudio({ fork: processes.fork, ...quick });
  await audio.call("load", ["/music/a.opus"]);
  await audio.call("seek", [42_000]);
  await audio.call("play", []);
  processes.crash();
  await settle();
  assert.equal(processes.forks(), 2, "restarted without waiting for a call");
  const status = await audio.call("status", []);
  assert.deepEqual(status, { state: "paused", positionMs: 42_000, durationMs: 180_000 });
  assert.equal((await audio.call("play", [])).state, "playing");
  assert.deepEqual(processes.log.slice(-4), ["2:load /music/a.opus", "2:seek 42000", "2:status", "2:play"]);
  audio.dispose();
});

test("a call that never answers kills the stalled process, which then restarts", async () => {
  const processes = fakeProcesses();
  const audio = superviseAudio({ fork: processes.fork, ...quick });
  await audio.call("load", ["/music/a.flac"]);
  processes.stall();
  await assert.rejects(audio.call("play", []), (error) => {
    assert.ok(error instanceof AudioEngineError);
    assert.equal(error.code, "stalled");
    return true;
  });
  await settle();
  assert.ok(processes.log.includes("1:killed"));
  assert.equal(processes.forks(), 2);
  assert.equal((await audio.call("play", [])).state, "playing");
  audio.dispose();
});

test("calls waiting when the process dies reject, and later calls work", async () => {
  const processes = fakeProcesses();
  const audio = superviseAudio({ fork: processes.fork, ...quick });
  await audio.call("status", []);
  processes.stall();
  const waiting = audio.call("status", []);
  processes.crash();
  await assert.rejects(waiting, (error) => error instanceof AudioEngineError && error.code === "restarted");
  await settle();
  assert.equal((await audio.call("status", [])).state, "idle");
  audio.dispose();
});

test("the heartbeat finds a stalled process with no call waiting", async () => {
  const processes = fakeProcesses();
  const audio = superviseAudio({ fork: processes.fork, ...quick, heartbeatMs: 20 });
  await audio.call("status", []);
  processes.stall();
  await settle(300);
  assert.ok(processes.log.includes("1:killed"));
  assert.ok(processes.forks() >= 2);
  audio.dispose();
});

test("a song that keeps crashing the process is dropped instead of restored for ever", async () => {
  const processes = fakeProcesses();
  const audio = superviseAudio({ fork: processes.fork, ...quick });
  await audio.call("load", ["/music/poison.mp3"]);
  await audio.call("seek", [5_000]);
  processes.crash();
  await settle(100);
  const forks = processes.forks();
  await settle(100);
  assert.equal(processes.forks(), forks, "stopped restarting");
  assert.ok(forks <= 5, `${forks} forks`);
  assert.equal((await audio.call("status", [])).state, "idle", "nothing restored");
  audio.dispose();
});

test("disposing kills the process and stops restarting it", async () => {
  const processes = fakeProcesses();
  const audio = superviseAudio({ fork: processes.fork, ...quick });
  await audio.call("status", []);
  audio.dispose();
  await settle();
  assert.equal(processes.forks(), 1);
  assert.ok(processes.log.includes("1:killed"));
  await assert.rejects(audio.call("status", []), (error) => error instanceof AudioEngineError && error.code === "disposed");
});
