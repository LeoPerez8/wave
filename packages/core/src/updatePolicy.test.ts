import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UPDATE_APK_RETRY_INTERVAL_MS,
  UPDATE_CHECK_INTERVAL_MS,
  latestApkUrl,
  nativeUpdateIsNew,
  nextUpdateStep,
  playerKeepsPlaying,
  readLatestApk,
  readSignedApk,
  versionOrder,
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
  nativeUpdate: "none",
  installAccess: "silent",
  lastInstallAskAt: null,
  lastInstallAt: null,
  offeredApkVersion: "1.3.0-ti",
  lastApkAttempt: null,
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

describe("when Wave downloads an APK", () => {
  const found = { nativeUpdate: "available" } as const;

  it("downloads only on an unmetered network", () => {
    assert.equal(nextUpdateStep(state(found)), "downloadApk");
    assert.equal(nextUpdateStep(state({ ...found, network: "metered" })), "wait");
    assert.equal(nextUpdateStep(state({ ...found, network: "none" })), "wait");
  });

  it("downloads in the background and while music plays, which a download doesn't disturb", () => {
    assert.equal(nextUpdateStep(state({ ...found, visible: false, playing: true })), "downloadApk");
  });
});

describe("when Wave installs a downloaded APK silently", () => {
  const ready = { nativeUpdate: "downloaded", visible: false } as const;

  it("installs in the background with nothing playing", () => {
    assert.equal(nextUpdateStep(state(ready)), "installApk");
  });

  it("never installs while Wave is visible", () => {
    assert.equal(nextUpdateStep(state({ ...ready, visible: true })), "wait");
  });

  it("never installs while music plays", () => {
    assert.equal(nextUpdateStep(state({ ...ready, playing: true })), "wait");
  });

  it("installs offline, as nothing's left to fetch", () => {
    assert.equal(nextUpdateStep(state({ ...ready, network: "none" })), "installApk");
  });

  it("gives a failed install 15 minutes before trying again", () => {
    assert.equal(nextUpdateStep(state({ ...ready, lastInstallAt: NOW - 15 * MINUTE + 1 })), "wait");
    assert.equal(
      nextUpdateStep(state({ ...ready, lastInstallAt: NOW - 15 * MINUTE })),
      "installApk",
    );
  });
});

describe("the first native update", () => {
  const ready = { nativeUpdate: "downloaded" } as const;
  const DAY = 24 * 60 * MINUTE;

  it("asks for the permission once the APK is ready and Wave is in front", () => {
    assert.equal(
      nextUpdateStep(state({ ...ready, installAccess: "needsPermission" })),
      "askInstallPermission",
    );
  });

  it("doesn't ask before the APK is ready", () => {
    assert.equal(
      nextUpdateStep(
        state({ nativeUpdate: "available", network: "metered", installAccess: "needsPermission" }),
      ),
      "wait",
    );
  });

  it("doesn't ask from the background, and doesn't install without the permission", () => {
    assert.equal(
      nextUpdateStep(state({ ...ready, installAccess: "needsPermission", visible: false })),
      "wait",
    );
  });

  it("after a decline, keeps the update and asks again a day later", () => {
    const declined = { ...ready, installAccess: "needsPermission" } as const;
    assert.equal(nextUpdateStep(state({ ...declined, lastInstallAskAt: NOW - DAY + 1 })), "wait");
    assert.equal(
      nextUpdateStep(state({ ...declined, lastInstallAskAt: NOW - DAY })),
      "askInstallPermission",
    );
  });

  it("with the permission, shows Android's confirmation in front, since no app may show it behind", () => {
    const first = { ...ready, installAccess: "needsConfirmation" } as const;
    assert.equal(nextUpdateStep(state(first)), "installApk");
    assert.equal(nextUpdateStep(state({ ...first, visible: false })), "wait");
  });

  it("doesn't show Android's confirmation while music plays, as accepting ends the process", () => {
    assert.equal(
      nextUpdateStep(state({ ...ready, installAccess: "needsConfirmation", playing: true })),
      "wait",
    );
  });

  it("after a declined confirmation, shows it again a day later", () => {
    const first = { ...ready, installAccess: "needsConfirmation" } as const;
    assert.equal(nextUpdateStep(state({ ...first, lastInstallAt: NOW - DAY + 1 })), "wait");
    assert.equal(nextUpdateStep(state({ ...first, lastInstallAt: NOW - DAY })), "installApk");
  });
});

describe("a pending APK and a bundle", () => {
  it("doesn't download a bundle, as the APK holds the JS", () => {
    for (const nativeUpdate of ["available", "downloaded"] as const) {
      assert.equal(
        nextUpdateStep(state({ nativeUpdate, bundleAvailable: true, network: "metered" })),
        "wait",
      );
    }
  });

  it("doesn't apply a downloaded bundle, and installs the APK instead", () => {
    assert.equal(
      nextUpdateStep(state({ nativeUpdate: "downloaded", bundleDownloaded: true, visible: false })),
      "installApk",
    );
  });

  it("holds the bundle while the APK waits for Wi-Fi", () => {
    assert.equal(
      nextUpdateStep(
        state({
          nativeUpdate: "available",
          bundleDownloaded: true,
          visible: false,
          network: "metered",
        }),
      ),
      "wait",
    );
  });

  it("keeps checking, as a newer APK may have come out", () => {
    assert.equal(
      nextUpdateStep(state({ nativeUpdate: "downloaded", lastCheckAt: NOW - 15 * MINUTE })),
      "check",
    );
  });
});

describe("whether the channel's APK is an update", () => {
  const latest = {
    version: "1.3.0-ti",
    runtimeVersion: "b",
    url: "https://x/a.apk",
    size: 9,
    channel: "ti",
    sha256: "ab".repeat(32),
  };

  it("is when its runtime version differs and its version is higher", () => {
    assert.equal(
      nativeUpdateIsNew({ installedRuntimeVersion: "a", installedVersion: "1.2.9-ti", latest }),
      true,
    );
  });

  it("isn't with the same runtime version, as a repacked APK's JS arrives over the air", () => {
    assert.equal(
      nativeUpdateIsNew({ installedRuntimeVersion: "b", installedVersion: "1.2.9-ti", latest }),
      false,
    );
  });

  it("isn't at the same or a lower version, which Android would refuse", () => {
    for (const installedVersion of ["1.3.0", "1.3.0-ti", "1.10.0", "2.0.0"]) {
      assert.equal(
        nativeUpdateIsNew({ installedRuntimeVersion: "a", installedVersion, latest }),
        false,
        installedVersion,
      );
    }
  });

  it("counts minors as numbers, not text", () => {
    assert.equal(
      nativeUpdateIsNew({
        installedRuntimeVersion: "a",
        installedVersion: "1.9.0",
        latest: { ...latest, version: "1.10.0" },
      }),
      true,
    );
  });

  it("isn't when a version can't be read", () => {
    assert.equal(
      nativeUpdateIsNew({ installedRuntimeVersion: "a", installedVersion: "dev", latest }),
      false,
    );
  });
});

describe("the service's latest APK", () => {
  const apk = {
    version: "1.3.0",
    runtimeVersion: "b",
    url: "https://github.com/o/r/releases/download/v1.3.0/wave-1.3.0.apk",
    size: 1000,
    channel: "ti",
    sha256: "ab".repeat(32),
  };

  const read = (metadata: unknown, channel = "ti") =>
    readLatestApk(JSON.stringify(metadata), channel);

  it("reads the metadata CI signed", () => {
    assert.deepEqual(read(apk), apk);
  });

  it("refuses an address that isn't https, or anything malformed", () => {
    assert.equal(read({ ...apk, url: "http://x/a.apk" }), null);
    assert.equal(read({ ...apk, size: 0 }), null);
    assert.equal(read({ ...apk, version: 1 }), null);
    assert.equal(read(null), null);
    assert.equal(readLatestApk("not json", "ti"), null);
  });

  it("refuses metadata with no file hash to check the download against", () => {
    const { sha256: _, ...unhashed } = apk;
    assert.equal(read(unhashed), null);
    assert.equal(read({ ...apk, sha256: "abc" }), null);
  });

  it("refuses another channel's metadata, though CI signed that too", () => {
    assert.equal(read(apk, "main"), null);
  });

  it("takes the signed answer apart, and calls one with no signature unreadable", () => {
    const signed = { metadata: JSON.stringify(apk), signature: "c2ln" };
    assert.deepEqual(readSignedApk(signed), signed);
    assert.equal(readSignedApk(apk), null);
    assert.equal(readSignedApk({ metadata: JSON.stringify(apk) }), null);
    assert.equal(readSignedApk({ metadata: JSON.stringify(apk), signature: "" }), null);
    assert.equal(readSignedApk(null), null);
  });

  it("is asked on the service the manifest comes from, by channel", () => {
    assert.equal(
      latestApkUrl({ manifestUrl: "https://u.test/v1/manifest", channel: "ti" }),
      "https://u.test/v1/apk?channel=ti",
    );
  });

  it("has no address without a channel the service knows", () => {
    const manifestUrl = "https://u.test/v1/manifest";
    assert.equal(latestApkUrl({ manifestUrl, channel: "none" }), null);
    assert.equal(latestApkUrl({ manifestUrl, channel: null }), null);
    assert.equal(latestApkUrl({ manifestUrl: undefined, channel: "main" }), null);
  });
});

describe("an APK whose last install or download came to nothing", () => {
  const found = { nativeUpdate: "available", offeredApkVersion: "1.3.0-ti" } as const;
  const tried = (ago: number, version = "1.3.0-ti") => ({
    lastApkAttempt: { version, at: NOW - ago },
  });

  it("isn't downloaded again for a day", () => {
    assert.equal(UPDATE_APK_RETRY_INTERVAL_MS, 24 * 60 * MINUTE);
    const soon = state({ ...found, ...tried(UPDATE_APK_RETRY_INTERVAL_MS - 1) });
    assert.equal(nextUpdateStep(soon), "wait");
  });

  it("is downloaded again after that", () => {
    const later = state({ ...found, ...tried(UPDATE_APK_RETRY_INTERVAL_MS) });
    assert.equal(nextUpdateStep(later), "downloadApk");
  });

  it("doesn't hold back a newer version", () => {
    assert.equal(nextUpdateStep(state({ ...found, ...tried(MINUTE, "1.2.9-ti") })), "downloadApk");
  });

  it("doesn't stay held by a clock set back", () => {
    assert.equal(nextUpdateStep(state({ ...found, ...tried(-MINUTE) })), "downloadApk");
  });

  it("still checks while it's held", () => {
    const held = state({ ...found, ...tried(MINUTE), lastCheckAt: NOW - 15 * MINUTE });
    assert.equal(nextUpdateStep(held), "check");
  });
});

describe("a version's place in the sequence", () => {
  it("orders the channels' versions as one sequence", () => {
    assert.equal(versionOrder("0.46.2"), 4602);
    assert.equal(versionOrder("0.46.3-ti"), 4603);
    assert.equal(versionOrder("1.0.0"), 10000);
  });

  it("isn't a place for anything else", () => {
    assert.equal(versionOrder("1.2"), null);
    assert.equal(versionOrder("1.100.0"), null);
    assert.equal(versionOrder("1.2.3-beta"), null);
  });
});
