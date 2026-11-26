import assert from "node:assert/strict";
import { test } from "node:test";
import { makeExternalStore } from "@wave/client/externalStore";
import type { PlaybackState } from "./playbackStores.ts";
import { BACK_ONLINE_MS, makeNetworkSignalStore } from "./networkSignalStore.ts";

const playing: PlaybackState = {
  status: "ready",
  isPlaying: true,
  playWhenReady: true,
  waitingForConnection: false,
  waitRanOut: false,
  item: { id: "a", title: "A", artist: null, album: null, artworkUri: null },
  error: null,
  errorCode: null,
  loadingSince: null,
};

const setup = () => {
  let now = 10_000;
  const timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  const playback = makeExternalStore(playing);
  const connectivity = makeExternalStore({ online: true, onMobileData: false });
  const said: string[] = [];
  const store = makeNetworkSignalStore({
    playback,
    connectivity,
    now: () => now,
    setTimer: (run, ms) => {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return () => {
        timer.live = false;
      };
    },
    announce: (text) => said.push(text),
  });
  const advance = (ms: number) => {
    now += ms;
    for (const timer of timers.filter((t) => t.live && t.at <= now)) {
      timer.live = false;
      timer.run();
    }
  };
  return { store, playback, connectivity, said, advance, now: () => now };
};

test("follows the playback only while someone watches", () => {
  const { store, playback } = setup();
  playback.set({ ...playing, waitingForConnection: true });
  assert.equal(store.get().signal, "playing");
  const stop = store.subscribe(() => {});
  assert.equal(store.get().signal, "offline");
  stop();
  playback.set(playing);
  assert.equal(store.get().signal, "offline");
});

test("Slow shows once the grace runs out, with no new report", () => {
  const { store, playback, said, advance, now } = setup();
  store.subscribe(() => {});
  playback.set({ ...playing, status: "buffering", isPlaying: false, loadingSince: now() });
  assert.equal(store.get().signal, "playing");
  advance(1_499);
  assert.equal(store.get().signal, "playing");
  advance(1);
  assert.equal(store.get().signal, "slow");
  assert.deepEqual(said, ["Slow connection"]);
});

test("the song playing again after Offline says Back online for a moment", () => {
  const { store, playback, said, advance } = setup();
  store.subscribe(() => {});
  playback.set({ ...playing, waitingForConnection: true });
  assert.equal(store.get().signal, "offline");
  playback.set(playing);
  assert.deepEqual(store.get(), { signal: "playing", backOnline: true });
  advance(BACK_ONLINE_MS);
  assert.deepEqual(store.get(), { signal: "playing", backOnline: false });
  assert.deepEqual(said, ["No internet. The song continues when it's back."]);
});

test("after the wait, the connection coming back turns Offline into Back", () => {
  const { store, playback, connectivity, said } = setup();
  store.subscribe(() => {});
  connectivity.set({ online: false, onMobileData: false });
  playback.set({
    ...playing,
    status: "idle",
    isPlaying: false,
    playWhenReady: false,
    errorCode: "ytOffline",
    waitRanOut: true,
  });
  assert.equal(store.get().signal, "offline");
  connectivity.set({ online: true, onMobileData: false });
  assert.equal(store.get().signal, "back");
  assert.deepEqual(said, [
    "No internet. The song continues when it's back.",
    "Internet's back. Tap play to continue.",
  ]);
});

test("a pause by hand during the wait is a normal pause: no Offline, no Back online, no Back", () => {
  const { store, playback, connectivity } = setup();
  store.subscribe(() => {});
  connectivity.set({ online: false, onMobileData: false });
  playback.set({ ...playing, waitingForConnection: true });
  assert.equal(store.get().signal, "offline");
  playback.set({
    ...playing,
    status: "idle",
    isPlaying: false,
    playWhenReady: false,
    errorCode: "ytOffline",
  });
  assert.deepEqual(store.get(), { signal: "playing", backOnline: false });
  connectivity.set({ online: true, onMobileData: false });
  assert.deepEqual(store.get(), { signal: "playing", backOnline: false });
});

test("skipping while Back online shows doesn't carry it to the next song", () => {
  const { store, playback } = setup();
  store.subscribe(() => {});
  playback.set({ ...playing, waitingForConnection: true });
  playback.set(playing);
  assert.deepEqual(store.get(), { signal: "playing", backOnline: true });
  playback.set({ ...playing, item: { ...playing.item!, id: "b", title: "B" } });
  assert.deepEqual(store.get(), { signal: "playing", backOnline: false });
});
