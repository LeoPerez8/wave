import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  UPDATE_APK_RETRY_INTERVAL_MS,
  UPDATE_CHECK_INTERVAL_MS,
  afterApkDownload,
  afterRequestedCheck,
  installTapWhenHandoverEnds,
  installTapAfter,
  latestApkUrl,
  nativeUpdateIsNew,
  nextUpdateStep,
  offeredApk,
  playerKeepsPlaying,
  readLatestApk,
  readSignedApk,
  strandedUpdateRequest,
  stoppedStepNotice,
  updateButtonAction,
  updateButtonLook,
  updatePillShown,
  updatePillSwipeDismisses,
  updateRequestAfter,
  versionOrder,
  type UpdateState,
} from "./index.ts";

const NOW = 1_000_000_000;
const MINUTE = 60_000;

const tried = (ago: number, version = "1.3.0-ti") => ({
  lastApkAttempt: { version, at: NOW - ago },
});

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
  installTap: "none",
  apkChecked: true,
  offeredApkVersion: "1.3.0-ti",
  lastApkAttempt: null,
  updateRequest: "none",
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

describe("a downloaded APK nobody tapped for", () => {
  it("never installs, whether Wave is in front or behind, on any install access", () => {
    for (const installAccess of ["needsPermission", "needsConfirmation", "silent"] as const) {
      for (const visible of [true, false]) {
        for (const playing of [true, false]) {
          assert.equal(
            nextUpdateStep(state({ nativeUpdate: "downloaded", installAccess, visible, playing })),
            "wait",
            `${installAccess} visible=${visible} playing=${playing}`,
          );
        }
      }
    }
  });
});

describe("a tap on Update the app", () => {
  const tapped = { nativeUpdate: "downloaded", installTap: "tapped" } as const;

  it("installs at once, in front and while music plays", () => {
    for (const installAccess of ["needsConfirmation", "silent"] as const) {
      assert.equal(nextUpdateStep(state({ ...tapped, installAccess })), "installApk");
      assert.equal(
        nextUpdateStep(state({ ...tapped, installAccess, playing: true })),
        "installApk",
      );
    }
  });

  it("installs offline, as nothing's left to fetch", () => {
    assert.equal(nextUpdateStep(state({ ...tapped, network: "none" })), "installApk");
  });

  it("waits for a running step to end", () => {
    assert.equal(nextUpdateStep(state({ ...tapped, working: true })), "wait");
  });

  it("starts no install with Wave behind, on any access, so it never closes under another app", () => {
    for (const installAccess of ["needsConfirmation", "silent"] as const) {
      assert.equal(nextUpdateStep(state({ ...tapped, installAccess, visible: false })), "wait");
    }
  });

  it("opens Android's permission screen without the permission", () => {
    assert.equal(
      nextUpdateStep(state({ ...tapped, installAccess: "needsPermission" })),
      "openInstallPermission",
    );
    assert.equal(
      nextUpdateStep(state({ ...tapped, installAccess: "needsPermission", visible: false })),
      "wait",
    );
  });

  it("starts nothing more once it's at Android's screen or handed over", () => {
    for (const installTap of [
      "atPermissionScreen",
      "awayAtPermissionScreen",
      "handedOver",
    ] as const) {
      assert.equal(
        nextUpdateStep(state({ nativeUpdate: "downloaded", installTap, installAccess: "silent" })),
        "wait",
        installTap,
      );
    }
  });
});

describe("what becomes of a tap", () => {
  const front = { visible: true, installAccess: "needsPermission" } as const;
  const behind = { visible: false, installAccess: "needsPermission" } as const;
  const granted = { visible: true, installAccess: "needsConfirmation" } as const;

  it("survives until Android's screen has actually taken Wave's place", () => {
    assert.equal(installTapAfter("atPermissionScreen", front), "atPermissionScreen");
    assert.equal(installTapAfter("atPermissionScreen", behind), "awayAtPermissionScreen");
    assert.equal(installTapAfter("awayAtPermissionScreen", behind), "awayAtPermissionScreen");
  });

  it("continues the install on coming back with the permission", () => {
    assert.equal(installTapAfter("awayAtPermissionScreen", granted), "tapped");
  });

  it("ends on coming back without it, so the screen doesn't open again by itself", () => {
    assert.equal(installTapAfter("awayAtPermissionScreen", front), "none");
  });

  it("ends when Wave leaves for Android's confirmation, so a decline offers it again", () => {
    assert.equal(installTapAfter("handedOver", granted), "handedOver");
    assert.equal(installTapAfter("handedOver", behind), "none");
  });

  it("ends a tap that hasn't reached Android when Wave leaves, on any access", () => {
    for (const installAccess of ["needsPermission", "needsConfirmation", "silent"] as const) {
      assert.equal(installTapAfter("tapped", { visible: false, installAccess }), "none");
    }
  });

  it("leaves no tap as it is, and a tap with Wave in front", () => {
    assert.equal(installTapAfter("none", behind), "none");
    assert.equal(installTapAfter("tapped", front), "tapped");
  });

  it("ends once Android's installer has let go, or Wave is back in front", () => {
    assert.equal(installTapWhenHandoverEnds("handedOver"), "none");
  });

  it("isn't ended by that if it isn't a handover: a new tap, or the permission screen", () => {
    for (const tap of ["none", "tapped", "atPermissionScreen", "awayAtPermissionScreen"] as const) {
      assert.equal(installTapWhenHandoverEnds(tap), tap);
    }
  });
});

describe("what becomes of a request from the update button", () => {
  it("ends when Wave leaves, whatever it wanted", () => {
    for (const request of ["check", "askMobileData", "download"] as const) {
      assert.equal(updateRequestAfter(request, { visible: false }), "none");
    }
  });

  it("stands while Wave is in front", () => {
    for (const request of ["none", "check", "askMobileData", "download"] as const) {
      assert.equal(updateRequestAfter(request, { visible: true }), request);
    }
  });
});

describe("what an APK download ends in", () => {
  const front = { updateRequest: "download", visible: true } as const;

  it("becomes a tap when it's signed and asked for, with Wave in front", () => {
    assert.deepEqual(afterApkDownload({ ...front, download: "signed" }), {
      tapped: true,
      outcome: null,
    });
  });

  it("is only an offer when nobody asked", () => {
    assert.deepEqual(afterApkDownload({ ...front, download: "signed", updateRequest: "none" }), {
      tapped: false,
      outcome: null,
    });
  });

  it("is only an offer with Wave behind, even if the request hasn't been ended yet", () => {
    assert.deepEqual(afterApkDownload({ ...front, download: "signed", visible: false }), {
      tapped: false,
      outcome: null,
    });
  });

  it("says so when it fails and was asked for", () => {
    assert.deepEqual(afterApkDownload({ ...front, download: "failed" }), {
      tapped: false,
      outcome: "downloadFailed",
    });
  });

  it("says nothing when it fails unasked, or with nobody there", () => {
    const quiet = { tapped: false, outcome: null };
    assert.deepEqual(
      afterApkDownload({ ...front, download: "failed", updateRequest: "none" }),
      quiet,
    );
    assert.deepEqual(afterApkDownload({ ...front, download: "failed", visible: false }), quiet);
  });
});

describe("what a step stopped by a throw tells the person", () => {
  it("always says an install or the permission screen failed", () => {
    for (const step of ["installApk", "openInstallPermission"] as const) {
      assert.equal(stoppedStepNotice({ step, updateRequest: "none" }), "installFailed");
    }
  });

  it("says a requested check or download failed", () => {
    assert.equal(stoppedStepNotice({ step: "check", updateRequest: "check" }), "checkFailed");
    assert.equal(
      stoppedStepNotice({ step: "downloadApk", updateRequest: "download" }),
      "downloadFailed",
    );
  });

  it("says nothing of a step nobody asked for", () => {
    assert.equal(stoppedStepNotice({ step: "check", updateRequest: "none" }), null);
  });
});

describe("the APK on offer", () => {
  const offer = {
    nativeUpdate: "downloaded",
    offeredApkVersion: "1.3.0",
    installTap: "none",
  } as const;

  it("is the downloaded version", () => {
    assert.equal(offeredApk(offer), "1.3.0");
  });

  it("isn't one still to download", () => {
    assert.equal(offeredApk({ ...offer, nativeUpdate: "available" }), null);
    assert.equal(offeredApk({ ...offer, nativeUpdate: "none" }), null);
  });

  it("isn't there while a tap is under way", () => {
    assert.equal(offeredApk({ ...offer, installTap: "tapped" }), null);
    assert.equal(offeredApk({ ...offer, installTap: "handedOver" }), null);
  });
});

describe("the update pill", () => {
  const clear = {
    offered: "1.3.0",
    ignored: null,
    nowPlayingShown: false,
    cardOpen: false,
    otherPillShown: false,
  };

  it("shows with an APK on offer and nothing in the way", () => {
    assert.equal(updatePillShown(clear), true);
  });

  it("doesn't show with nothing on offer", () => {
    assert.equal(updatePillShown({ ...clear, offered: null }), false);
  });

  it("hides while Now Playing or a card is open", () => {
    assert.equal(updatePillShown({ ...clear, nowPlayingShown: true }), false);
    assert.equal(updatePillShown({ ...clear, cardOpen: true }), false);
  });

  it("waits for another floating pill to leave", () => {
    assert.equal(updatePillShown({ ...clear, otherPillShown: true }), false);
  });

  it("stays away for the version swiped, and comes back for a newer one", () => {
    assert.equal(updatePillShown({ ...clear, ignored: "1.3.0" }), false);
    assert.equal(updatePillShown({ ...clear, ignored: "1.2.9" }), true);
  });

  it("goes on a sideways swipe a third of its width, or a flick, either way", () => {
    const swipe = (translationX: number, velocityX = 0) =>
      updatePillSwipeDismisses({ translationX, velocityX, width: 300 });
    assert.equal(swipe(100), true);
    assert.equal(swipe(-100), true);
    assert.equal(swipe(60), false);
    assert.equal(swipe(-60), false);
    assert.equal(swipe(20, 1500), true);
    assert.equal(swipe(-20, -1500), true);
  });
});

describe("the APK check at a launch", () => {
  it("runs inside the 15 minutes, so a downloaded APK's pill returns after a restart", () => {
    assert.equal(nextUpdateStep(state({ apkChecked: false })), "checkApk");
  });

  it("runs once per launch", () => {
    assert.equal(nextUpdateStep(state({ apkChecked: true })), "wait");
  });

  it("waits for Wave in front and a network", () => {
    assert.equal(nextUpdateStep(state({ apkChecked: false, visible: false })), "wait");
    assert.equal(nextUpdateStep(state({ apkChecked: false, network: "none" })), "wait");
  });

  it("leaves it to a check that's due anyway", () => {
    assert.equal(nextUpdateStep(state({ apkChecked: false, lastCheckAt: null })), "check");
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

  it("doesn't apply a downloaded bundle while an ignored APK stays on the phone", () => {
    assert.equal(
      nextUpdateStep(state({ nativeUpdate: "downloaded", bundleDownloaded: true, visible: false })),
      "wait",
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

describe("the update button in Settings", () => {
  const idle = {
    nativeUpdate: "none",
    installTap: "none",
    updateRequest: "none",
    downloadingApk: false,
  } as const;

  describe("a tap", () => {
    it("installs a downloaded APK", () => {
      assert.equal(updateButtonAction({ ...idle, nativeUpdate: "downloaded" }), "install");
    });

    it("checks when no APK is ready", () => {
      assert.equal(updateButtonAction(idle), "check");
      assert.equal(updateButtonAction({ ...idle, nativeUpdate: "available" }), "check");
    });

    it("joins a download already running, to install what it brings", () => {
      assert.equal(
        updateButtonAction({ ...idle, nativeUpdate: "available", downloadingApk: true }),
        "followDownload",
      );
    });

    it("does nothing while an earlier tap is under way", () => {
      assert.equal(updateButtonAction({ ...idle, updateRequest: "check" }), "none");
      assert.equal(updateButtonAction({ ...idle, updateRequest: "download" }), "none");
      assert.equal(
        updateButtonAction({ ...idle, nativeUpdate: "downloaded", installTap: "handedOver" }),
        "none",
      );
    });
  });

  describe("what it asks of the policy", () => {
    it("checks at once, inside the 15 minutes", () => {
      const justChecked = { lastCheckAt: NOW - MINUTE };
      assert.equal(nextUpdateStep(state({ ...justChecked, updateRequest: "check" })), "check");
    });

    it("waits for a step under way before checking", () => {
      assert.equal(nextUpdateStep(state({ working: true, updateRequest: "check" })), "wait");
    });

    it("asks with Wave in front before using mobile data", () => {
      const asking = state({
        network: "metered",
        nativeUpdate: "available",
        updateRequest: "askMobileData",
      });
      assert.equal(nextUpdateStep(asking), "askMobileData");
      assert.equal(nextUpdateStep({ ...asking, visible: false }), "wait");
    });

    it("downloads on mobile data once allowed, unlike the automatic path", () => {
      const onMobileData = state({ network: "metered", nativeUpdate: "available" });
      assert.equal(nextUpdateStep(onMobileData), "wait");
      assert.equal(nextUpdateStep({ ...onMobileData, updateRequest: "download" }), "downloadApk");
    });

    it("downloads a version the automatic path holds off for a day", () => {
      const heldOff = state({
        nativeUpdate: "available",
        lastApkAttempt: { version: "1.3.0-ti", at: NOW - MINUTE },
      });
      assert.equal(nextUpdateStep(heldOff), "wait");
      assert.equal(nextUpdateStep({ ...heldOff, updateRequest: "download" }), "downloadApk");
    });
  });

  describe("what a requested check leads to", () => {
    const found = {
      visible: true,
      nativeUpdate: "none",
      network: "unmetered",
      bundleAvailable: false,
      bundleDownloaded: false,
      checkFailed: false,
    } as const;

    it("leads nowhere and tells nobody with Wave behind, whatever it found", () => {
      for (const nativeUpdate of ["none", "available", "downloaded"] as const) {
        assert.deepEqual(afterRequestedCheck({ ...found, nativeUpdate, visible: false }), {
          next: "none",
          outcome: null,
        });
      }
    });

    it("installs an APK already on the phone", () => {
      assert.deepEqual(afterRequestedCheck({ ...found, nativeUpdate: "downloaded" }), {
        next: "install",
        outcome: null,
      });
    });

    it("downloads a found APK off mobile data", () => {
      assert.deepEqual(afterRequestedCheck({ ...found, nativeUpdate: "available" }), {
        next: "download",
        outcome: null,
      });
    });

    it("asks first on mobile data", () => {
      assert.deepEqual(
        afterRequestedCheck({ ...found, nativeUpdate: "available", network: "metered" }),
        { next: "askMobileData", outcome: null },
      );
    });

    it("says Wave is up to date when nothing was found", () => {
      assert.deepEqual(afterRequestedCheck(found), { next: "none", outcome: "upToDate" });
    });

    it("leaves a bundle to its silent path, found or already downloaded", () => {
      const silent = { next: "none", outcome: "bundleOnItsWay" };
      assert.deepEqual(afterRequestedCheck({ ...found, bundleAvailable: true }), silent);
      assert.deepEqual(afterRequestedCheck({ ...found, bundleDownloaded: true }), silent);
    });

    it("says the check failed rather than up to date", () => {
      assert.deepEqual(afterRequestedCheck({ ...found, checkFailed: true }), {
        next: "none",
        outcome: "checkFailed",
      });
    });

    it("acts on what a half-failed check did find", () => {
      assert.equal(
        afterRequestedCheck({ ...found, nativeUpdate: "available", checkFailed: true }).next,
        "download",
      );
    });
  });

  describe("a request with no network", () => {
    it("ends with what couldn't happen", () => {
      assert.equal(strandedUpdateRequest("check", "none"), "checkFailed");
      assert.equal(strandedUpdateRequest("download", "none"), "downloadFailed");
      assert.equal(strandedUpdateRequest("askMobileData", "none"), "downloadFailed");
    });

    it("carries on with one, and with no request there's nothing to end", () => {
      assert.equal(strandedUpdateRequest("check", "metered"), null);
      assert.equal(strandedUpdateRequest("none", "none"), null);
    });
  });

  describe("its face", () => {
    it("spins while a tap's check is under way", () => {
      assert.equal(updateButtonLook({ updateRequest: "check", downloadPercent: null }), "checking");
    });

    it("shows the percentage of any download", () => {
      assert.deepEqual(updateButtonLook({ updateRequest: "none", downloadPercent: 42 }), {
        downloading: 42,
      });
    });

    it("rests otherwise", () => {
      assert.equal(updateButtonLook({ updateRequest: "none", downloadPercent: null }), "idle");
    });
  });
});
