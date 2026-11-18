import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { exposeBridge } from "../preload/expose.ts";
import { BRIDGE_CALLS, type WaveBridge } from "../shared/bridge.ts";
import { libraryLayer } from "./database.ts";
import { registerBridge, type IpcHandler } from "./bridge.ts";

const trusted = { senderFrame: "window" };

/** Main's handlers wired to a preload through an in-memory IPC, as Electron does. */
const connect = (file: string, isTrusted = (event: unknown) => event === trusted) => {
  const runtime = ManagedRuntime.make(libraryLayer(file));
  const handlers = new Map<string, IpcHandler>();
  registerBridge(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    runtime,
    isTrusted,
  );
  const exposed = new Map<string, unknown>();
  const sent: string[] = [];
  exposeBridge(
    { exposeInMainWorld: (key, api) => exposed.set(key, api) },
    {
      invoke: async (channel, ...args) => {
        sent.push(channel);
        const handler = handlers.get(channel);
        if (handler === undefined) throw new Error(`No handler for ${channel}`);
        return handler(trusted, ...args);
      },
    },
  );
  return { runtime, handlers, exposed, sent };
};

const withFile = async (run: (file: string) => Promise<void>): Promise<void> => {
  const folder = mkdtempSync(join(tmpdir(), "wave-bridge-"));
  try {
    await run(join(folder, "wave.db"));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

/** Every callable path in an exposed object, such as `library.counts`. */
const callPaths = (value: unknown, path = ""): string[] =>
  typeof value === "function"
    ? [path]
    : typeof value === "object" && value !== null
      ? Object.entries(value).flatMap(([key, inner]) =>
          callPaths(inner, path === "" ? key : `${path}.${key}`),
        )
      : [`${path} (not a call)`];

test("the window reads the Library's counts through the bridge", async () => {
  await withFile(async (file) => {
    const { runtime, exposed } = connect(file);
    await runtime.runPromise(
      Effect.gen(function* () {
        addTrack((yield* Database) as unknown as TestDatabase, { title: "Pink Moon" });
      }),
    );
    const wave = exposed.get("wave") as WaveBridge;
    assert.equal((await wave.library.counts()).songs, 1);
    await runtime.dispose();
  });
});

test("the window gets only the typed calls, never a generic IPC send", async () => {
  await withFile(async (file) => {
    const { runtime, exposed, handlers, sent } = connect(file);
    assert.deepEqual([...exposed.keys()], ["wave"]);
    const paths = callPaths(exposed.get("wave"));
    assert.deepEqual(paths, [...BRIDGE_CALLS]);
    for (const generic of [
      "send",
      "sendSync",
      "invoke",
      "on",
      "once",
      "postMessage",
      "ipcRenderer",
    ])
      assert.ok(!paths.some((path) => path.split(".").includes(generic)), generic);
    assert.deepEqual([...handlers.keys()], [...BRIDGE_CALLS]);
    await (exposed.get("wave") as WaveBridge).library.counts();
    assert.deepEqual(sent, ["library.counts"]);
    await runtime.dispose();
  });
});

test("main refuses a call from a frame other than Wave's window", async () => {
  await withFile(async (file) => {
    const { runtime, handlers } = connect(file);
    const counts = handlers.get("library.counts");
    assert.ok(counts !== undefined);
    await assert.rejects(async () => counts({ senderFrame: "an embedded page" }), /untrusted/i);
    await runtime.dispose();
  });
});
