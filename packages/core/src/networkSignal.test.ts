import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf } from "./localisation.ts";
import {
  NETWORK_SLOW_GRACE_MS,
  followNetworkSignal,
  networkSignal,
  networkSignalAnnouncement,
  networkSignalLabel,
  networkSignalLine,
  networkSignalRecheckMs,
  type NetworkSignalInput,
} from "./index.ts";

const playing: NetworkSignalInput = {
  waitingForConnection: false,
  loading: false,
  loadingSinceMs: null,
  cutByNetwork: false,
  online: true,
  nowMs: 10_000,
};

const loadingFor = (ms: number, extra: Partial<NetworkSignalInput> = {}): NetworkSignalInput => ({
  ...playing,
  loading: true,
  loadingSinceMs: playing.nowMs - ms,
  ...extra,
});

describe("networkSignal", () => {
  test("a song that plays, or is paused by hand, shows nothing", () => {
    assert.equal(networkSignal(playing), "playing");
    assert.equal(networkSignal({ ...playing, online: false }), "playing");
  });

  test("the wait for the network is Offline", () => {
    assert.equal(
      networkSignal({ ...playing, waitingForConnection: true, online: false }),
      "offline",
    );
    // The wait outlasts a connection Android reports before the service resumes.
    assert.equal(networkSignal({ ...playing, waitingForConnection: true }), "offline");
  });

  test("an ordinary start doesn't show Slow: loading waits out the grace first", () => {
    assert.equal(networkSignal(loadingFor(0)), "playing");
    assert.equal(networkSignal(loadingFor(NETWORK_SLOW_GRACE_MS - 1)), "playing");
    assert.equal(networkSignal(loadingFor(NETWORK_SLOW_GRACE_MS)), "slow");
  });

  test("the grace is about a second and a half", () => {
    assert.ok(NETWORK_SLOW_GRACE_MS >= 1000 && NETWORK_SLOW_GRACE_MS <= 2000);
  });

  test("loading past the grace without a connection is Offline, not Slow", () => {
    assert.equal(networkSignal(loadingFor(NETWORK_SLOW_GRACE_MS, { online: false })), "offline");
    assert.equal(networkSignal(loadingFor(0, { online: false })), "playing");
  });

  test("the song loading again after the network cut it is Slow at once", () => {
    assert.equal(networkSignal(loadingFor(0, { cutByNetwork: true })), "slow");
    assert.equal(networkSignal(loadingFor(0, { cutByNetwork: true, online: false })), "offline");
  });

  test("after the wait, the paused song is Back once Android reports a connection", () => {
    assert.equal(networkSignal({ ...playing, cutByNetwork: true }), "back");
  });

  test("after the wait, still offline, the paused song keeps showing Offline", () => {
    assert.equal(networkSignal({ ...playing, cutByNetwork: true, online: false }), "offline");
  });

  test("a loading time missing its start counts from now", () => {
    assert.equal(networkSignal({ ...playing, loading: true }), "playing");
  });
});

describe("networkSignalRecheckMs", () => {
  test("loading inside the grace asks to look again when it ends", () => {
    assert.equal(networkSignalRecheckMs(loadingFor(500)), NETWORK_SLOW_GRACE_MS - 500);
  });

  test("nothing changes with time otherwise", () => {
    assert.equal(networkSignalRecheckMs(playing), null);
    assert.equal(networkSignalRecheckMs(loadingFor(NETWORK_SLOW_GRACE_MS)), null);
    assert.equal(networkSignalRecheckMs({ ...playing, waitingForConnection: true }), null);
    assert.equal(networkSignalRecheckMs(loadingFor(0, { cutByNetwork: true })), null);
  });
});

describe("followNetworkSignal", () => {
  const start = followNetworkSignal(null, "a", "playing");

  test("plain playing says nothing", () => {
    assert.equal(start.backOnline, false);
    assert.equal(followNetworkSignal(start.trail, "a", "playing").backOnline, false);
  });

  test("playing again on the same song after Offline is Back online", () => {
    const offline = followNetworkSignal(start.trail, "a", "offline");
    assert.equal(offline.backOnline, false);
    const loading = followNetworkSignal(offline.trail, "a", "slow");
    assert.equal(loading.backOnline, false);
    const back = followNetworkSignal(loading.trail, "a", "playing");
    assert.equal(back.backOnline, true);
    // Once only.
    assert.equal(followNetworkSignal(back.trail, "a", "playing").backOnline, false);
  });

  test("Slow alone ending isn't Back online", () => {
    const slow = followNetworkSignal(start.trail, "a", "slow");
    assert.equal(followNetworkSignal(slow.trail, "a", "playing").backOnline, false);
  });

  test("another song playing after Offline isn't Back online", () => {
    const offline = followNetworkSignal(start.trail, "a", "offline");
    assert.equal(followNetworkSignal(offline.trail, "b", "playing").backOnline, false);
  });

  test("the wait ending paused is Back, not Back online, and playing on from it says nothing more", () => {
    const offline = followNetworkSignal(start.trail, "a", "offline");
    const back = followNetworkSignal(offline.trail, "a", "back");
    assert.equal(back.backOnline, false);
    assert.equal(followNetworkSignal(back.trail, "a", "playing").backOnline, false);
  });
});

describe("networkSignal text", () => {
  const pt = catalogueOf("pt-BR");

  test("the scrubber's remaining time gives way to the reason", () => {
    assert.equal(networkSignalLabel("offline"), "No internet");
    assert.equal(networkSignalLabel("slow"), "Loading…");
    assert.equal(networkSignalLabel("playing"), null);
    assert.equal(networkSignalLabel("back"), null);
    assert.equal(networkSignalLabel("offline", pt), "Sem internet");
    assert.equal(networkSignalLabel("slow", pt), "Carregando…");
  });

  test("the line under the controls", () => {
    assert.equal(networkSignalLine("back", false), "Internet's back · tap play");
    assert.equal(networkSignalLine("playing", true), "Back online");
    assert.equal(networkSignalLine("playing", false), null);
    assert.equal(networkSignalLine("offline", false), null);
    assert.equal(networkSignalLine("back", false, pt), "A internet voltou · toque no play");
    assert.equal(networkSignalLine("playing", true, pt), "De volta");
  });

  test("TalkBack hears each state as it begins", () => {
    assert.equal(
      networkSignalAnnouncement("playing", "offline"),
      "No internet. The song continues when it's back.",
    );
    assert.equal(networkSignalAnnouncement("playing", "slow"), "Slow connection");
    assert.equal(
      networkSignalAnnouncement("offline", "back"),
      "Internet's back. Tap play to continue.",
    );
    assert.equal(networkSignalAnnouncement("offline", "offline"), null);
    assert.equal(networkSignalAnnouncement("offline", "playing"), null);
    assert.equal(
      networkSignalAnnouncement("slow", "offline", pt),
      "Sem internet. A música continua quando ela voltar.",
    );
    assert.equal(networkSignalAnnouncement("playing", "slow", pt), "Conexão lenta");
  });
});
