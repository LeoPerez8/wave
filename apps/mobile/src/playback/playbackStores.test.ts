import assert from "node:assert/strict";
import { test } from "node:test";
import type { NativePlayerState } from "../native/wavePlayer.ts";
import { makePlaybackStores, playerTrouble } from "./playbackStores.ts";

const playing: NativePlayerState = {
  status: "ready",
  isPlaying: true,
  playWhenReady: true,
  waitingForConnection: false,
  errorCode: null,
  index: 0,
  item: { id: "a", title: "A", artist: null, album: null, artworkUri: null },
  positionMs: 1_000,
  durationMs: 180_000,
  at: 10_000,
};

test("the service's network wait reaches JS and ends on timeout while the song stays paused", () => {
  const stores = makePlaybackStores(() => {});
  assert.equal(stores.playbackState.get().waitingForConnection, false);
  const paused = { ...playing, status: "idle", isPlaying: false, playWhenReady: false } as const;
  stores.reportError({ itemId: "a", message: "offline", code: "ytOffline" });
  stores.reportState({ ...paused, waitingForConnection: true });
  assert.equal(stores.playbackState.get().waitingForConnection, true);
  stores.reportState({ ...paused, waitingForConnection: false });
  assert.equal(stores.playbackState.get().waitingForConnection, false);
  assert.equal(stores.playbackState.get().isPlaying, false);
});

test("reopening JS during a wait reads the offline cause and retains it through preparation", () => {
  const stores = makePlaybackStores(() => {});
  stores.reportState({
    ...playing,
    status: "idle",
    isPlaying: false,
    playWhenReady: false,
    waitingForConnection: true,
    errorCode: "ytOffline",
  });
  assert.equal(stores.playbackState.get().errorCode, "ytOffline");
  stores.reportState({
    ...playing,
    status: "buffering",
    isPlaying: false,
    waitingForConnection: false,
  });
  assert.equal(stores.playbackState.get().errorCode, "ytOffline");
  stores.reportState(playing);
  assert.equal(stores.playbackState.get().errorCode, null);
});

test("a song picked after another failed never shows the failed song's error", () => {
  const stores = makePlaybackStores(() => {});
  const stopped = { ...playing, status: "idle", isPlaying: false, playWhenReady: false } as const;
  const b = { id: "b", title: "B", artist: null, album: null, artworkUri: null };
  stores.reportState(playing);
  stores.reportError({ itemId: "a", message: "unavailable", code: "ytUnavailable" });
  stores.reportState({ ...stopped, errorCode: "ytUnavailable" });
  assert.equal(stores.playbackState.get().errorCode, "ytUnavailable");
  // The player is on B but hasn't prepared it yet: A's error still stands natively.
  stores.reportState({ ...stopped, item: b, errorCode: "ytUnavailable" });
  assert.equal(stores.playbackState.get().errorCode, null);
  stores.reportState({ ...stopped, item: b, playWhenReady: true, errorCode: "ytUnavailable" });
  assert.equal(stores.playbackState.get().errorCode, null);
  // Prepared and left paused: nothing of A's comes back.
  stores.reportState({ ...stopped, item: b, status: "ready" });
  assert.deepEqual(playerTrouble(stores.playbackState.get()), {
    waitingForConnection: false,
    retrying: false,
    failed: false,
    errorCode: null,
  });
});

test("a song that fails as the player reaches it keeps its own error, whichever report comes first", () => {
  const stopped = { ...playing, status: "idle", isPlaying: false, playWhenReady: false } as const;
  const b = { id: "b", title: "B", artist: null, album: null, artworkUri: null };
  const failedOnB = { ...stopped, item: b, waitingForConnection: true, errorCode: "ytOffline" };

  const errorFirst = makePlaybackStores(() => {});
  errorFirst.reportState(playing);
  errorFirst.reportError({ itemId: "b", message: "offline", code: "ytOffline" });
  errorFirst.reportState(failedOnB);
  assert.equal(errorFirst.playbackState.get().errorCode, "ytOffline");
  errorFirst.reportState({ ...failedOnB, waitingForConnection: false });
  assert.equal(errorFirst.playbackState.get().errorCode, "ytOffline");

  const stateFirst = makePlaybackStores(() => {});
  stateFirst.reportState(playing);
  stateFirst.reportState(failedOnB);
  stateFirst.reportError({ itemId: "b", message: "offline", code: "ytOffline" });
  stateFirst.reportState({ ...failedOnB, waitingForConnection: false });
  assert.equal(stateFirst.playbackState.get().errorCode, "ytOffline");
  assert.equal(stateFirst.playbackState.get().error, "offline");
});

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

test("the player's trouble follows the wait, the retry and the timeout", () => {
  const stores = makePlaybackStores(() => {});
  const trouble = () => playerTrouble(stores.playbackState.get());
  stores.reportState(playing);
  assert.deepEqual(trouble(), {
    waitingForConnection: false,
    retrying: false,
    failed: false,
    errorCode: null,
  });
  const stopped = { ...playing, status: "idle", isPlaying: false, playWhenReady: false } as const;
  stores.reportError({ itemId: "a", message: "offline", code: "ytOffline" });
  stores.reportState({ ...stopped, waitingForConnection: true, errorCode: "ytOffline" });
  assert.deepEqual(trouble(), {
    waitingForConnection: true,
    retrying: false,
    failed: true,
    errorCode: "ytOffline",
  });
  stores.reportState({ ...playing, status: "buffering", isPlaying: false });
  assert.equal(trouble().retrying, true);
  stores.reportState({ ...stopped, errorCode: "ytOffline" });
  assert.deepEqual(trouble(), {
    waitingForConnection: false,
    retrying: false,
    failed: true,
    errorCode: "ytOffline",
  });
});
