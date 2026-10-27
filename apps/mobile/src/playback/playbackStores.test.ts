import assert from "node:assert/strict";
import { test } from "node:test";
import type { NativePlayerState } from "../native/wavePlayer.ts";
import { makePlaybackStores } from "./playbackStores.ts";

const playing: NativePlayerState = {
  status: "ready",
  isPlaying: true,
  playWhenReady: true,
  index: 0,
  item: { id: "a", title: "A", artist: null, album: null, artworkUri: null },
  positionMs: 1_000,
  durationMs: 180_000,
  at: 10_000,
};

test("position reports leave every playback listener asleep and keep the latest snapshot without demand", () => {
  const stores = makePlaybackStores(() => {});
  stores.reportState(playing);
  const before = stores.playbackState.get();
  let wakes = 0;
  const stops = Array.from({ length: 15 }, () => stores.playbackState.subscribe(() => wakes++));
  stores.reportPosition({ positionMs: 1_500, durationMs: 180_000, at: 10_500 });
  assert.equal(wakes, 0);
  assert.equal(stores.playbackState.get(), before);
  assert.deepEqual(stores.positionState.get(), {
    positionMs: 1_500,
    durationMs: 180_000,
    at: 10_500,
    isPlaying: true,
    item: { id: "a" },
  });
  for (const stop of stops) stop();
});

test("only the first position consumer starts reports and the last release stops them", () => {
  const demand: boolean[] = [];
  const { positionState } = makePlaybackStores((requested) => demand.push(requested));
  const stopA = positionState.subscribe(() => {});
  const stopB = positionState.subscribe(() => {});
  assert.deepEqual(demand, [true]);
  stopA();
  stopA();
  assert.deepEqual(demand, [true]);
  stopB();
  assert.deepEqual(demand, [true, false]);
  const stopC = positionState.subscribe(() => {});
  assert.deepEqual(demand, [true, false, true]);
  stopC();
  assert.equal(positionState.listenerCount(), 0);
});

test("event reports and an immediate JS seek keep position fresh without waking playback for the seek", () => {
  const stores = makePlaybackStores(() => {});
  const reports: unknown[] = [];
  const stop = stores.positionState.subscribe(() => reports.push(stores.positionState.get()));
  stores.reportState(playing);
  stores.reportState({
    ...playing,
    status: "buffering",
    isPlaying: false,
    positionMs: 2_000,
    at: 11_000,
  });
  assert.equal(stores.positionState.get().isPlaying, false);
  stores.reportState({
    ...playing,
    isPlaying: false,
    playWhenReady: false,
    positionMs: 2_000,
    at: 12_000,
  });
  stores.reportState({ ...playing, positionMs: 2_000, at: 20_000 });
  const playback = stores.playbackState.get();
  stores.positionState.update((state) => ({ ...state, positionMs: 90_000, at: 21_000 }));
  assert.equal(stores.playbackState.get(), playback);
  assert.equal(stores.positionState.get().positionMs, 90_000);
  stop();
  // A new song updates the snapshot even while the screen is closed.
  stores.reportState({ ...playing, item: null, positionMs: 0, durationMs: null, at: 22_000 });
  assert.deepEqual(stores.positionState.get(), {
    item: null,
    positionMs: 0,
    durationMs: null,
    at: 22_000,
    isPlaying: true,
  });
  assert.equal(reports.length, 5);
  assert.equal("positionMs" in stores.playbackState.get(), false);
});
