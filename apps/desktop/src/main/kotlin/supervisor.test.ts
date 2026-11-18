import assert from "node:assert/strict";
import { test } from "node:test";
import { pass, withFakeClock } from "../testing/fakeClock.ts";
import { KotlinError, superviseKotlin, type KotlinEvents } from "./supervisor.ts";

// Restarts run on a clock the tests move with `pass`.
withFakeClock();

type Handle = (method: string, params: Record<string, unknown>) => unknown;

/** A thrown error with the code the JVM puts in `error.code`. */
const coded = (code: string, message: string) => Object.assign(new Error(message), { code });

/**
 * JVMs as main sees them, in memory: each spawn reads JSON lines and answers each request with
 * `handle`, as `packages/kotlin-shared/stdio` does. `say` makes the current one write a line of
 * its own; `crash` makes it exit.
 */
const fakeJvms = (handle: Handle = () => null) => {
  const fromHost: unknown[] = [];
  let spawns = 0;
  let current: { events: KotlinEvents; alive: boolean } | undefined;
  const spawn = (events: KotlinEvents) => {
    spawns += 1;
    const jvm = { events, alive: true };
    current = jvm;
    const say = (line: unknown) =>
      queueMicrotask(() => jvm.alive && events.line(JSON.stringify(line)));
    return {
      write: (text: string) => {
        if (!jvm.alive) return;
        const line = JSON.parse(text) as {
          id: unknown;
          method?: string;
          params?: Record<string, unknown>;
        };
        fromHost.push(line);
        if (line.method === undefined) return;
        void Promise.resolve()
          .then(() => handle(line.method as string, line.params ?? {}))
          .then(
            (result) => say({ id: line.id, result }),
            (error: Error & { code?: string }) =>
              say({ id: line.id, error: { code: error.code, message: error.message } }),
          );
      },
      kill: () => {
        if (!jvm.alive) return;
        jvm.alive = false;
        queueMicrotask(events.exit);
      },
    };
  };
  return {
    spawn,
    fromHost,
    spawns: () => spawns,
    say: (line: unknown) => current?.events.line(JSON.stringify(line)),
    sayRaw: (text: string) => current?.events.line(text),
    crash: () => {
      if (current === undefined || !current.alive) return;
      current.alive = false;
      queueMicrotask(current.events.exit);
    },
  };
};

const quick = { restartDelayMs: () => 0 };

test("a call goes to the JVM as a JSON line and comes back with its result", async () => {
  const jvms = fakeJvms((method, params) =>
    method === "readTags" ? { title: `tags of ${String(params["path"])}` } : null,
  );
  const kotlin = superviseKotlin({ spawn: jvms.spawn, ...quick });
  assert.deepEqual(await kotlin.call("readTags", { path: "/music/a.flac" }), {
    title: "tags of /music/a.flac",
  });
  assert.deepEqual(jvms.fromHost, [
    { id: 1, method: "readTags", params: { path: "/music/a.flac" } },
  ]);
  kotlin.dispose();
});

test("a call the JVM fails comes back with the JVM's code", async () => {
  const jvms = fakeJvms(() => {
    throw coded("ERR_YT_OFFLINE", "No connection");
  });
  const kotlin = superviseKotlin({ spawn: jvms.spawn, ...quick });
  await assert.rejects(kotlin.call("search", { query: "caetano" }), (error: unknown) => {
    assert.ok(error instanceof KotlinError);
    assert.equal(error.code, "ERR_YT_OFFLINE");
    assert.equal(error.message, "No connection");
    return true;
  });
  kotlin.dispose();
});

test("a JVM that dies fails the calls it held, and a new one answers the next", async () => {
  let hang = true;
  const jvms = fakeJvms(() => (hang ? new Promise(() => undefined) : { title: "ok" }));
  const kotlin = superviseKotlin({ spawn: jvms.spawn, ...quick });
  const pending = kotlin.call("readTags", { path: "/music/a.flac" });
  await pass();
  jvms.crash();
  const failed = assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof KotlinError);
    assert.equal(error.code, "ERR_UNEXPECTED");
    return true;
  });
  await pass();
  await failed;
  // Restarted with the app's services, before anyone calls.
  assert.equal(jvms.spawns(), 2);
  hang = false;
  assert.deepEqual(await kotlin.call("readTags", { path: "/music/a.flac" }), { title: "ok" });
  assert.equal(jvms.spawns(), 2);
  kotlin.dispose();
});

test("the JVM asks main, and main answers from its host method", async () => {
  const jvms = fakeJvms();
  const asked: unknown[] = [];
  const kotlin = superviseKotlin({
    spawn: jvms.spawn,
    host: {
      poToken: async (params) => {
        asked.push(params);
        return { tokens: ["visitor-token", "video-token"] };
      },
    },
    ...quick,
  });
  jvms.say({ id: "j1", method: "poToken", params: { identifiers: ["visitor", "video"] } });
  await pass();
  assert.deepEqual(asked, [{ identifiers: ["visitor", "video"] }]);
  assert.deepEqual(jvms.fromHost, [
    { id: "j1", result: { tokens: ["visitor-token", "video-token"] } },
  ]);
  kotlin.dispose();
});

test("main answers the JVM's request with an error code when it can't", async () => {
  const jvms = fakeJvms();
  const kotlin = superviseKotlin({
    spawn: jvms.spawn,
    host: {
      poToken: async () => {
        throw coded("ERR_NO_TOKEN", "BotGuard refused");
      },
      broken: async () => {
        throw new Error("boom");
      },
    },
    ...quick,
  });
  jvms.say({ id: "j1", method: "poToken", params: {} });
  jvms.say({ id: "j2", method: "signInCookie", params: {} });
  jvms.say({ id: "j3", method: "broken" });
  await pass();
  // Each is answered as it finishes, not in the order asked.
  const byId = (line: unknown) => String((line as { id: unknown }).id);
  assert.deepEqual(
    jvms.fromHost.toSorted((a, b) => byId(a).localeCompare(byId(b))),
    [
      { id: "j1", error: { code: "ERR_NO_TOKEN", message: "BotGuard refused" } },
      {
        id: "j2",
        error: { code: "ERR_UNKNOWN_METHOD", message: "Main has no method signInCookie" },
      },
      { id: "j3", error: { code: "ERR_HOST", message: "boom" } },
    ],
  );
  kotlin.dispose();
});

test("the JVM's events reach main, and lines that aren't the protocol are skipped", async () => {
  const jvms = fakeJvms(() => "answered");
  const events: unknown[] = [];
  const kotlin = superviseKotlin({
    spawn: jvms.spawn,
    onEvent: (event) => events.push(event),
    ...quick,
  });
  jvms.say({ event: "ready", java: "21.0.12" });
  for (const line of ["SLF4J(W): No providers", "[1,2]", '{"id":99,"result":1}']) jvms.sayRaw(line);
  assert.deepEqual(events, [{ event: "ready", java: "21.0.12" }]);
  assert.equal(await kotlin.call("search", { query: "after the noise" }), "answered");
  kotlin.dispose();
});

test("a call made while the JVM is down waits for its restart instead of starting one", async () => {
  const jvms = fakeJvms(() => "answered");
  const kotlin = superviseKotlin({ spawn: jvms.spawn, restartDelayMs: () => 120 });
  jvms.crash();
  await pass();
  const calls = [kotlin.call("search", { query: "a" }), kotlin.call("search", { query: "b" })];
  await pass(119);
  assert.equal(jvms.spawns(), 1, "no call starts a JVM before its wait is over");
  await pass(1);
  assert.deepEqual(await Promise.all(calls), ["answered", "answered"]);
  assert.equal(jvms.spawns(), 2);
  kotlin.dispose();
});

test("a JVM that can't start fails the calls that waited for it, and is tried again later", async () => {
  let starts = false;
  let spawns = 0;
  const jvms = fakeJvms(() => "answered");
  const kotlin = superviseKotlin({
    spawn: (events) => {
      spawns += 1;
      if (starts) return jvms.spawn(events);
      queueMicrotask(events.exit);
      return { write: () => undefined, kill: () => undefined };
    },
    restartDelayMs: () => 40,
  });
  await pass();
  assert.equal(spawns, 1);
  const failed = assert.rejects(kotlin.call("search", { query: "a" }), { code: "ERR_UNEXPECTED" });
  await pass(39);
  assert.equal(spawns, 1, "one start per wait, however many calls come");
  await pass(1);
  await failed;
  assert.equal(spawns, 2);
  starts = true;
  const answered = kotlin.call("search", { query: "b" });
  await pass(40);
  assert.equal(await answered, "answered");
  assert.equal(spawns, 3);
  kotlin.dispose();
});

test("calls waiting for a restart fail when main shuts the JVM down", async () => {
  const jvms = fakeJvms(() => "answered");
  const kotlin = superviseKotlin({ spawn: jvms.spawn, restartDelayMs: () => 60_000 });
  jvms.crash();
  await pass();
  const waiting = kotlin.call("search", { query: "a" });
  kotlin.dispose();
  await assert.rejects(waiting, { code: "ERR_UNEXPECTED" });
  assert.equal(jvms.spawns(), 1);
});

test("shutting down fails what's pending, kills the JVM and refuses new calls", async () => {
  const jvms = fakeJvms(() => new Promise(() => undefined));
  const kotlin = superviseKotlin({ spawn: jvms.spawn, ...quick });
  const pending = kotlin.call("readTags", { path: "/music/a.flac" });
  kotlin.dispose();
  await assert.rejects(pending, { code: "ERR_UNEXPECTED" });
  await assert.rejects(kotlin.call("readTags", { path: "/music/a.flac" }), {
    code: "ERR_UNEXPECTED",
  });
  await pass();
  assert.equal(jvms.spawns(), 1);
});
