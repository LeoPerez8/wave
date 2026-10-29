import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";

// Keep the real Player service and permission helper; replace only the phone.
let fixtureId = 0;
const loadPlayer = async (version = 33, os = "android") => {
  const id = ++fixtureId;
  const boundary = `data:text/javascript,${encodeURIComponent(`
    export const fixture = ${id};
    export const phone = { requests: [], playing: false, answer: null };
    export const Platform = { OS: ${JSON.stringify(os)}, Version: ${version} };
    export const PermissionsAndroid = {
      PERMISSIONS: { POST_NOTIFICATIONS: "android.permission.POST_NOTIFICATIONS" },
      request: permission => {
        phone.requests.push(permission);
        return new Promise((resolve, reject) => { phone.answer = { resolve, reject }; });
      },
    };
    export const WavePlayer = {
      addListener: () => ({ remove: () => {} }),
      getState: async () => ({
        status: "idle", isPlaying: false, playWhenReady: false, item: null,
        index: -1, positionMs: 0, durationMs: null, at: 0,
      }),
      getSleepTimer: async () => null,
      play: async () => { phone.playing = true; },
      pause: async () => { phone.playing = false; },
    };
  `)}`;
  const src = new URL("../", import.meta.url);
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (["react-native", "@/native/wavePlayer"].includes(specifier))
        return { url: boundary, shortCircuit: true };
      if (specifier.startsWith("@/")) specifier = new URL(specifier.slice(2), src).href;
      if (specifier.startsWith(".") || specifier.startsWith("file:")) {
        const url = new URL(specifier, context.parentURL);
        if (url.href.startsWith(src.href)) {
          if (!url.pathname.endsWith(".ts") && existsSync(new URL(`${url.pathname}.ts`, url)))
            url.pathname += ".ts";
          url.search = `fixture=${id}`;
          return nextResolve(url.href, context);
        }
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    const { Player, layer } = (await import(
      `./Player.ts?fixture=${id}`
    )) as typeof import("./Player.ts");
    const { askForNotifications } = (await import(
      `../lib/askForNotifications.ts?fixture=${id}`
    )) as typeof import("../lib/askForNotifications.ts");
    const { phone } = (await import(boundary)) as {
      phone: {
        requests: string[];
        playing: boolean;
        answer: null | { resolve: (result: string) => void; reject: (error: Error) => void };
      };
    };
    const runtime = ManagedRuntime.make(layer);
    const play = () => runtime.runPromise(Effect.flatMap(Player, (player) => player.play));
    const pause = () => runtime.runPromise(Effect.flatMap(Player, (player) => player.pause));
    return { phone, runtime, play, pause, askForNotifications };
  } finally {
    hooks.deregister();
  }
};

test(
  "first playback asks for notifications without waiting for the permission answer",
  { timeout: 2_000 },
  async () => {
    const { phone, runtime, play } = await loadPlayer();
    try {
      await runtime.runPromise(Effect.void);
      assert.deepEqual(phone.requests, []);
      await play();
      assert.deepEqual(phone.requests, ["android.permission.POST_NOTIFICATIONS"]);
      assert.equal(phone.playing, true);
      phone.answer!.resolve("denied");
    } finally {
      await runtime.dispose();
    }
  },
);

test("denying notifications leaves playback working and resume does not ask again", async () => {
  const { phone, runtime, play, pause, askForNotifications } = await loadPlayer(35);
  try {
    await play();
    phone.answer!.resolve("denied");
    await pause();
    assert.equal(phone.playing, false);
    await play();
    assert.equal(phone.playing, true);
    // A later download uses this same helper and must not prompt a second time.
    askForNotifications();
    assert.deepEqual(phone.requests, ["android.permission.POST_NOTIFICATIONS"]);
  } finally {
    await runtime.dispose();
  }
});

test("work can still ask first, and playback shares its once-per-session prompt", async () => {
  const { phone, runtime, play, askForNotifications } = await loadPlayer();
  try {
    askForNotifications();
    assert.deepEqual(phone.requests, ["android.permission.POST_NOTIFICATIONS"]);
    phone.answer!.resolve("granted");
    await play();
    assert.equal(phone.playing, true);
    assert.equal(phone.requests.length, 1);
  } finally {
    await runtime.dispose();
  }
});

test("a failed permission request leaves playback working", async () => {
  const { phone, runtime, play, pause } = await loadPlayer();
  try {
    await play();
    phone.answer!.reject(new Error("Permission request failed"));
    await pause();
    await play();
    assert.equal(phone.playing, true);
    assert.equal(phone.requests.length, 1);
  } finally {
    await runtime.dispose();
  }
});

test("Android 12 and other platforms play without a notification prompt", async () => {
  for (const [version, os] of [
    [32, "android"],
    [33, "ios"],
  ] as const) {
    const { phone, runtime, play } = await loadPlayer(version, os);
    try {
      await play();
      assert.equal(phone.playing, true);
      assert.deepEqual(phone.requests, []);
    } finally {
      await runtime.dispose();
    }
  }
});
