import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UPDATE_CHECK_INTERVAL_MS,
  nextUpdateStep,
  playerKeepsPlaying,
  type UpdateState,
} from "./index.ts";

const NOW = 1_000_000_000;
const MINUTE = 60_000;

/** Wave open on Wi-Fi, silent, checked a moment ago, with nothing pending. */
const state = (changes: Partial<UpdateState> = {}): UpdateState => ({
  now: NOW,
  lastCheckAt: NOW - MINUTE,
  network: "unmetered",
  playing: false,
  visible: true,
  working: false,
  bundleAvailable: false,
  bundleDownloaded: false,
  ...changes,
});

describe("when Wave checks for an update", () => {
  it("checks at the first open", () => {
    assert.equal(nextUpdateStep(state({ lastCheckAt: null })), "check");
  });

  it("waits out 15 minutes since the last check", () => {
    assert.equal(UPDATE_CHECK_INTERVAL_MS, 15 * MINUTE);
    assert.equal(nextUpdateStep(state({ lastCheckAt: NOW - 15 * MINUTE + 1 })), "wait");
    assert.equal(nextUpdateStep(state({ lastCheckAt: NOW - 15 * MINUTE })), "check");
  });
});

describe("what stops a check", () => {
  it("doesn't check with no network, so the 15 minutes don't start on a certain failure", () => {
    assert.equal(nextUpdateStep(state({ lastCheckAt: null, network: "none" })), "wait");
  });

  it("checks on mobile data too", () => {
    assert.equal(nextUpdateStep(state({ lastCheckAt: null, network: "metered" })), "check");
  });

  it("doesn't check in the background", () => {
    assert.equal(nextUpdateStep(state({ lastCheckAt: null, visible: false })), "wait");
  });

  it("checks while music plays", () => {
    assert.equal(nextUpdateStep(state({ lastCheckAt: null, playing: true })), "check");
  });

  it("doesn't start anything while a step runs", () => {
    assert.equal(nextUpdateStep(state({ lastCheckAt: null, working: true })), "wait");
    assert.equal(nextUpdateStep(state({ bundleAvailable: true, working: true })), "wait");
    assert.equal(
      nextUpdateStep(state({ bundleDownloaded: true, visible: false, working: true })),
      "wait",
    );
  });

  it("checks after the clock went backwards, rather than waiting until it catches up", () => {
    assert.equal(nextUpdateStep(state({ lastCheckAt: NOW + 60 * MINUTE })), "check");
  });

  it("still checks with a bundle waiting, as a newer one may have come out", () => {
    assert.equal(
      nextUpdateStep(state({ lastCheckAt: NOW - 15 * MINUTE, bundleDownloaded: true })),
      "check",
    );
  });
});

describe("when Wave downloads a bundle", () => {
  it("downloads on any network", () => {
    for (const network of ["metered", "unmetered"] as const) {
      assert.equal(nextUpdateStep(state({ bundleAvailable: true, network })), "downloadBundle");
    }
  });

  it("waits with no network", () => {
    assert.equal(nextUpdateStep(state({ bundleAvailable: true, network: "none" })), "wait");
  });

  it("downloads whether or not Wave is in front or playing", () => {
    assert.equal(
      nextUpdateStep(state({ bundleAvailable: true, visible: false, playing: true })),
      "downloadBundle",
    );
  });

  it("takes the newer bundle before applying the one it has", () => {
    assert.equal(
      nextUpdateStep(state({ bundleAvailable: true, bundleDownloaded: true, visible: false })),
      "downloadBundle",
    );
  });
});

describe("when Wave applies a downloaded bundle", () => {
  const ready = { bundleDownloaded: true };

  it("applies in the background with nothing playing", () => {
    assert.equal(nextUpdateStep(state({ ...ready, visible: false })), "applyBundle");
  });

  it("applies offline, as nothing's left to fetch", () => {
    assert.equal(
      nextUpdateStep(state({ ...ready, visible: false, network: "none" })),
      "applyBundle",
    );
  });

  it("never applies while Wave is visible", () => {
    assert.equal(nextUpdateStep(state(ready)), "wait");
  });

  it("never applies while music plays", () => {
    assert.equal(nextUpdateStep(state({ ...ready, visible: false, playing: true })), "wait");
  });

  it("applies the bundle it has when the newer one can't download", () => {
    assert.equal(
      nextUpdateStep(state({ ...ready, bundleAvailable: true, visible: false, network: "none" })),
      "applyBundle",
    );
  });
});

describe("whether the player counts as playing", () => {
  const player = (
    status: "idle" | "buffering" | "ready" | "ended",
    isPlaying: boolean,
    playWhenReady: boolean,
  ) => playerKeepsPlaying({ status, isPlaying, playWhenReady });

  it("counts playing", () => assert.equal(player("ready", true, true), true));
  it("counts buffering on its way to play", () =>
    assert.equal(player("buffering", false, true), true));
  it("doesn't count paused", () => assert.equal(player("ready", false, false), false));
  it("doesn't count a queue that ended", () => assert.equal(player("ended", false, true), false));
  it("doesn't count an idle player left wanting to play", () =>
    assert.equal(player("idle", false, true), false));
});
