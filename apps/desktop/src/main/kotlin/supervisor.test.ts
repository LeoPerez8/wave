import assert from "node:assert/strict";
import { test } from "node:test";
import { KotlinError, superviseKotlin, type KotlinEvents } from "./supervisor.ts";

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
        setImmediate(events.exit);
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
      setImmediate(current.events.exit);
    },
  };
};

const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

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
  await settle();
  jvms.crash();
  await assert.rejects(pending, (error: unknown) => {
    assert.ok(error instanceof KotlinError);
    assert.equal(error.code, "ERR_UNEXPECTED");
    return true;
  });
  // Restarted with the app's services, before anyone calls.
  await settle();
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
  await settle();
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
  await settle();
  // Each is answered as it finishes, not in the order asked.
  const byId = (line: unknown) => String((line as { id: unknown }).id);
  assert.deepEqual(jvms.fromHost.toSorted((a, b) => byId(a).localeCompare(byId(b))), [
    { id: "j1", error: { code: "ERR_NO_TOKEN", message: "BotGuard refused" } },
    { id: "j2", error: { code: "ERR_UNKNOWN_METHOD", message: "Main has no method signInCookie" } },
    { id: "j3", error: { code: "ERR_HOST", message: "boom" } },
  ]);
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
  for (const line of ["SLF4J(W): No providers", "[1,2]", '{"id":99,"result":1}'])
    jvms.sayRaw(line);
  assert.deepEqual(events, [{ event: "ready", java: "21.0.12" }]);
  assert.equal(await kotlin.call("search", { query: "after the noise" }), "answered");
  kotlin.dispose();
});

test("a JVM that can't start fails the call, and the next call starts another", async () => {
  let starts = true;
  const jvms = fakeJvms(() => "answered");
  const kotlin = superviseKotlin({
    spawn: (events) => {
      if (starts) return jvms.spawn(events);
      setImmediate(events.exit);
      return { write: () => undefined, kill: () => undefined };
    },
    restartDelayMs: () => 60_000,
  });
  starts = false;
  jvms.crash();
  await settle();
  await assert.rejects(kotlin.call("search", { query: "a" }), { code: "ERR_UNEXPECTED" });
  starts = true;
  assert.equal(await kotlin.call("search", { query: "b" }), "answered");
  kotlin.dispose();
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
  await settle();
  assert.equal(jvms.spawns(), 1);
});
