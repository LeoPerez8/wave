import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { exposeBridge } from "../../preload/expose.ts";
import type { WaveBridge } from "../../shared/bridge.ts";
import { registerBridge, type IpcHandler } from "../bridge.ts";

/** The window's bridge over main's handlers, with the mini player's calls recorded. */
const connect = (trusted: boolean) => {
  const asked: string[] = [];
  const handlers = new Map<string, IpcHandler>();
  registerBridge(
    { handle: (channel, handler) => handlers.set(channel, handler) },
    { runPromise: (effect) => Effect.runPromise(effect as never) },
    () => trusted,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      open: async () => void asked.push("open"),
      close: () => void asked.push("close"),
      showMain: () => void asked.push("showMain"),
    },
  );
  const exposed = new Map<string, unknown>();
  exposeBridge(
    { exposeInMainWorld: (key, api) => exposed.set(key, api) },
    { invoke: async (channel, ...args) => handlers.get(channel)!({}, ...args) },
  );
  return { asked, wave: exposed.get("wave") as WaveBridge };
};

test("the window opens and closes the mini player and brings the main window back", async () => {
  const { asked, wave } = connect(true);
  assert.equal(await wave.miniPlayer.open(), undefined);
  await wave.miniPlayer.showMain();
  await wave.miniPlayer.close();
  assert.deepEqual(asked, ["open", "showMain", "close"]);
});

test("a frame that isn't Wave's can't open the mini player", async () => {
  const { asked, wave } = connect(false);
  await assert.rejects(wave.miniPlayer.open(), /untrusted/i);
  assert.deepEqual(asked, []);
});
