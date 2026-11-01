import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as Effect from "effect/Effect";

import type { NativeUpdate } from "@wave/core";

import { createUpdateRunner, type UpdateClient, type UpdateSurroundings } from "./updateRunner.ts";

/** A runner over a scripted update service, with what it did and logged written down. */
const setup = ({
  lastCheckAt: lastCheckAtAtStart = null,
  ...client
}: Partial<UpdateClient> & { lastCheckAt?: number | null } = {}) => {
  const did: string[] = [];
  const logged: { level: string; message: string }[] = [];
  const notices: string[] = [];
  const surroundings: { -readonly [K in keyof UpdateSurroundings]: UpdateSurroundings[K] } = {
    network: "unmetered",
    playing: false,
    visible: true,
    installAccess: "silent",
  };
  let lastCheckAt: number | null = lastCheckAtAtStart;
  let lastApkAttempt: { version: string; at: number } | null = null;
  let now = 1_000_000_000;
  const runner = createUpdateRunner({
    client: {
      check: Effect.sync(() => {
        did.push("check");
        return false;
      }),
      download: Effect.sync(() => {
        did.push("download");
        return true;
      }),
      apply: Effect.sync(() => {
        did.push("apply");
      }),
      checkNative: Effect.succeed("none"),
      downloadApk: Effect.sync(() => {
        did.push("downloadApk");
        return true;
      }),
      openInstallPermission: Effect.sync(() => {
        did.push("permission");
      }),
      installApk: Effect.sync(() => {
        did.push("install");
      }),
      downloadApkOnMobileData: Effect.sync(() => {
        did.push("downloadApkOnMobileData");
        return true;
      }),
      askMobileData: Effect.sync(() => {
        did.push("askMobileData");
        return true;
      }),
      offeredApkVersion: () => "1.3.0",
      ...client,
    },
    surroundings: () => surroundings,
    now: () => now,
    lastCheckAt: { get: () => lastCheckAt, set: (at) => (lastCheckAt = at) },
    lastApkAttempt: {
      get: () => lastApkAttempt,
      set: (attempt) => (lastApkAttempt = attempt),
    },
    log: (level, message) => logged.push({ level, message }),
    report: (notice) => notices.push(notice),
  });
  return {
    runner,
    did,
    logged,
    notices,
    surroundings,
    passMinutes: (minutes: number) => (now += minutes * 60_000),
    settle: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  };
};

const failing = Effect.fail(new Error("offline"));
const found: UpdateClient["check"] = Effect.succeed(true);

describe("the update runner", () => {
  it("checks, downloads what it found, and holds it while Wave is visible", async () => {
    const { runner, did, settle } = setup({ check: found });
    runner.reconsider();
    await settle();
    runner.reconsider();
    await settle();
    assert.deepEqual(did, ["download"]);
  });

  it("applies a held bundle when Wave goes to the background with nothing playing", async () => {
    const { runner, did, surroundings, settle } = setup({ check: found });
    runner.reconsider();
    await settle();
    assert.deepEqual(did, ["download"]);
    surroundings.visible = false;
    runner.reconsider();
    await settle();
    assert.deepEqual(did, ["download", "apply"]);
  });

  it("doesn't apply again while the restart it asked for is on its way", async () => {
    const { runner, did, surroundings, settle } = setup({ check: found });
    runner.reconsider();
    await settle();
    surroundings.visible = false;
    runner.reconsider();
    await settle();
    runner.reconsider();
    await settle();
    assert.deepEqual(did, ["download", "apply"]);
  });

  it("holds the bundle through the background until the music stops", async () => {
    const { runner, did, surroundings, settle } = setup({ check: found });
    runner.reconsider();
    await settle();
    surroundings.visible = false;
    surroundings.playing = true;
    runner.reconsider();
    await settle();
    assert.deepEqual(did, ["download"]);
    surroundings.playing = false;
    runner.reconsider();
    await settle();
    assert.deepEqual(did, ["download", "apply"]);
  });

  it("applies when a download ends after Wave left the foreground", async () => {
    let finish: (isNew: boolean) => void = () => {};
    const { runner, did, surroundings, settle } = setup({
      check: found,
      download: Effect.callback<boolean>((resume) => {
        finish = (isNew) => resume(Effect.succeed(isNew));
      }),
    });
    runner.reconsider();
    await settle();
    surroundings.visible = false;
    runner.reconsider();
    finish(true);
    await settle();
    assert.deepEqual(did, ["apply"]);
  });

  it("doesn't check twice inside 15 minutes, even after a failure", async () => {
    let checks = 0;
    const { runner, passMinutes, settle } = setup({
      check: Effect.suspend(() => {
        checks++;
        return failing;
      }),
    });
    runner.reconsider();
    await settle();
    runner.reconsider();
    await settle();
    assert.equal(checks, 1);
    passMinutes(15);
    runner.reconsider();
    await settle();
    assert.equal(checks, 2);
  });

  it("keeps a failed check to the log", async () => {
    const { runner, logged, settle } = setup({ check: failing });
    runner.reconsider();
    await settle();
    assert.ok(
      logged.some(({ level, message }) => level === "warn" && /check failed/i.test(message)),
    );
  });

  it("finds a failed download again at the next check", async () => {
    let downloads = 0;
    const { runner, logged, passMinutes, settle } = setup({
      check: found,
      download: Effect.suspend(() => {
        downloads++;
        return failing;
      }),
    });
    runner.reconsider();
    await settle();
    runner.reconsider();
    await settle();
    assert.equal(downloads, 1);
    assert.ok(logged.some(({ message }) => /download failed/i.test(message)));
    passMinutes(15);
    runner.reconsider();
    await settle();
    assert.equal(downloads, 2);
  });

  it("logs a check, a download and an apply", async () => {
    const { runner, logged, surroundings, settle } = setup({ check: found });
    runner.reconsider();
    await settle();
    surroundings.visible = false;
    runner.reconsider();
    await settle();
    const lines = logged.map(({ message }) => message).join("\n");
    assert.match(lines, /check/i);
    assert.match(lines, /download/i);
    assert.match(lines, /appl/i);
  });

  it("logs a failed apply and tries again at the next change, not in a loop", async () => {
    let applies = 0;
    const { runner, logged, surroundings, settle } = setup({
      check: found,
      apply: Effect.suspend(() => {
        applies++;
        return failing;
      }),
    });
    runner.reconsider();
    await settle();
    surroundings.visible = false;
    runner.reconsider();
    await settle();
    assert.equal(applies, 1);
    assert.ok(logged.some(({ message }) => /apply failed/i.test(message)));
    runner.reconsider();
    await settle();
    assert.equal(applies, 2);
  });

  it("doesn't hold on to a download that brought nothing new", async () => {
    const { runner, did, surroundings, settle } = setup({
      check: found,
      download: Effect.succeed(false),
    });
    runner.reconsider();
    await settle();
    surroundings.visible = false;
    runner.reconsider();
    await settle();
    assert.deepEqual(did, []);
  });

  describe("with a native update", () => {
    const nothingElse = { check: Effect.succeed(false) };
    const foundApk = { ...nothingElse, checkNative: Effect.succeed("available" as const) };

    it("downloads the APK and never installs it without a tap, in front or behind", async () => {
      const { runner, did, surroundings, settle } = setup(foundApk);
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk"]);
      surroundings.visible = false;
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk"]);
    });

    it("offers the APK only once it has downloaded", async () => {
      let finish: () => void = () => {};
      const { runner, settle } = setup({
        ...foundApk,
        downloadApk: Effect.callback<boolean>((resume) => {
          finish = () => resume(Effect.succeed(true));
        }),
      });
      const heard: (string | null)[] = [];
      runner.subscribe(() => heard.push(runner.offeredVersion()));
      runner.reconsider();
      await settle();
      assert.equal(runner.offeredVersion(), null);
      finish();
      await settle();
      assert.equal(runner.offeredVersion(), "1.3.0");
      assert.equal(heard.at(-1), "1.3.0");
    });

    it("doesn't offer an APK whose download isn't the signed file", async () => {
      const { runner, settle } = setup({ ...foundApk, downloadApk: Effect.succeed(false) });
      runner.reconsider();
      await settle();
      assert.equal(runner.offeredVersion(), null);
    });

    it("skips the download of an APK already on the phone, and installs at a tap", async () => {
      const { runner, did, settle } = setup({
        ...nothingElse,
        checkNative: Effect.succeed("downloaded"),
      });
      runner.reconsider();
      await settle();
      assert.deepEqual(did, []);
      runner.requestInstall();
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["install"]);
    });

    it("installs at a tap while music plays", async () => {
      const { runner, did, surroundings, settle } = setup(foundApk);
      surroundings.playing = true;
      runner.reconsider();
      await settle();
      runner.requestInstall();
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk", "install"]);
    });

    it("ignores a tap with nothing downloaded, so a later download doesn't install", async () => {
      const { runner, did, settle } = setup(foundApk);
      runner.requestInstall();
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk"]);
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk"]);
    });

    it("carries out a tap made while another step runs, when that step ends", async () => {
      let finish: () => void = () => {};
      let checks = 0;
      const { runner, did, passMinutes, settle } = setup({
        check: Effect.suspend(() => {
          checks++;
          return checks === 1
            ? Effect.succeed(false)
            : Effect.callback<boolean>((resume) => {
                finish = () => resume(Effect.succeed(false));
              });
        }),
        checkNative: Effect.succeed("downloaded"),
      });
      runner.reconsider();
      await settle();
      passMinutes(15);
      runner.reconsider();
      await settle();
      runner.requestInstall();
      runner.reconsider();
      await settle();
      assert.deepEqual(did, []);
      finish();
      await settle();
      assert.deepEqual(did, ["install"]);
    });

    it("drops a tap when the check says the APK is no longer there", async () => {
      let update: "available" | "downloaded" = "downloaded";
      let finish: () => void = () => {};
      let checks = 0;
      const { runner, did, surroundings, passMinutes, settle } = setup({
        check: Effect.suspend(() => {
          checks++;
          return checks === 1
            ? Effect.succeed(false)
            : Effect.callback<boolean>((resume) => {
                finish = () => resume(Effect.succeed(false));
              });
        }),
        checkNative: Effect.suspend(() => Effect.succeed(update)),
      });
      surroundings.network = "metered";
      runner.reconsider();
      await settle();
      passMinutes(15);
      runner.reconsider();
      await settle();
      runner.requestInstall();
      update = "available";
      finish();
      await settle();
      surroundings.network = "unmetered";
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk"]);
    });

    it("hides the offer from the tap on, and a second tap doesn't install twice", async () => {
      const { runner, did, settle } = setup(foundApk);
      runner.reconsider();
      await settle();
      runner.requestInstall();
      assert.equal(runner.offeredVersion(), null);
      runner.reconsider();
      await settle();
      runner.requestInstall();
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk", "install"]);
    });

    it("offers it again after a declined confirmation, and installs at the next tap", async () => {
      const { runner, did, surroundings, settle } = setup(foundApk);
      surroundings.installAccess = "needsConfirmation";
      runner.reconsider();
      await settle();
      runner.requestInstall();
      runner.reconsider();
      await settle();
      surroundings.visible = false;
      runner.reconsider();
      await settle();
      surroundings.visible = true;
      runner.reconsider();
      await settle();
      assert.equal(runner.offeredVersion(), "1.3.0");
      assert.deepEqual(did, ["downloadApk", "install"]);
      runner.requestInstall();
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk", "install", "install"]);
    });

    describe("without the install permission", () => {
      const atPermissionScreen = async () => {
        const context = setup(foundApk);
        context.surroundings.installAccess = "needsPermission";
        context.runner.reconsider();
        await context.settle();
        context.runner.requestInstall();
        context.runner.reconsider();
        await context.settle();
        return context;
      };

      it("opens Android's screen at the tap and installs nothing", async () => {
        const { did } = await atPermissionScreen();
        assert.deepEqual(did, ["downloadApk", "permission"]);
      });

      it("never opens it without a tap", async () => {
        const { runner, did, surroundings, passMinutes, settle } = setup(foundApk);
        surroundings.installAccess = "needsPermission";
        runner.reconsider();
        await settle();
        passMinutes(24 * 60);
        runner.reconsider();
        await settle();
        assert.ok(!did.includes("permission"));
      });

      it("isn't taken for a decline before Wave has left for the screen", async () => {
        const { runner, did, surroundings, settle } = await atPermissionScreen();
        runner.reconsider();
        await settle();
        surroundings.visible = false;
        runner.reconsider();
        await settle();
        surroundings.installAccess = "needsConfirmation";
        surroundings.visible = true;
        runner.reconsider();
        await settle();
        assert.deepEqual(did, ["downloadApk", "permission", "install"]);
      });

      it("coming back with it granted continues the install", async () => {
        const { runner, did, surroundings, settle } = await atPermissionScreen();
        surroundings.visible = false;
        runner.reconsider();
        await settle();
        surroundings.installAccess = "needsConfirmation";
        surroundings.visible = true;
        runner.reconsider();
        await settle();
        assert.deepEqual(did, ["downloadApk", "permission", "install"]);
      });

      it("coming back without it offers the APK again, and doesn't reopen the screen", async () => {
        const { runner, did, surroundings, settle } = await atPermissionScreen();
        surroundings.visible = false;
        runner.reconsider();
        await settle();
        surroundings.visible = true;
        runner.reconsider();
        await settle();
        runner.reconsider();
        await settle();
        assert.deepEqual(did, ["downloadApk", "permission"]);
        assert.equal(runner.offeredVersion(), "1.3.0");
      });

      it("offers the APK again when the screen wouldn't open", async () => {
        const { runner, surroundings, logged, settle } = setup({
          ...foundApk,
          openInstallPermission: failing,
        });
        surroundings.installAccess = "needsPermission";
        runner.reconsider();
        await settle();
        runner.requestInstall();
        runner.reconsider();
        await settle();
        assert.equal(runner.offeredVersion(), "1.3.0");
        assert.ok(logged.some(({ level }) => level === "warn"));
      });
    });

    it("finds the APK at a launch inside the 15 minutes, with no bundle check", async () => {
      let checks = 0;
      const { runner, did, settle } = setup({
        check: Effect.sync(() => {
          checks++;
          return false;
        }),
        checkNative: Effect.succeed("downloaded"),
        lastCheckAt: 1_000_000_000 - 60_000,
      });
      runner.reconsider();
      await settle();
      assert.equal(checks, 0);
      assert.equal(runner.offeredVersion(), "1.3.0");
      assert.deepEqual(did, []);
    });

    it("waits for Wi-Fi, and doesn't take the bundle meanwhile", async () => {
      const { runner, did, surroundings, settle } = setup({ ...foundApk, check: found });
      surroundings.network = "metered";
      runner.reconsider();
      await settle();
      assert.deepEqual(did, []);
      surroundings.network = "unmetered";
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk"]);
    });

    it("holds a waiting bundle behind the APK, even with Wave behind", async () => {
      const { runner, did, surroundings, settle } = setup({ ...foundApk, check: found });
      runner.reconsider();
      await settle();
      surroundings.visible = false;
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk"]);
    });

    it("keeps a native check's failure from stopping the bundle's", async () => {
      const { runner, did, logged, settle } = setup({ check: found, checkNative: failing });
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["download"]);
      assert.ok(logged.some(({ level, message }) => level === "warn" && /APK/.test(message)));
    });

    it("after a failed install, waits a day to download again, as the failure may repeat", async () => {
      let installs = 0;
      const { runner, did, logged, passMinutes, settle } = setup({
        ...foundApk,
        installApk: Effect.suspend(() => {
          installs++;
          return failing;
        }),
      });
      runner.reconsider();
      await settle();
      runner.requestInstall();
      runner.reconsider();
      await settle();
      assert.equal(installs, 1);
      assert.ok(logged.some(({ message }) => /install failed/i.test(message)));
      const downloads = () => did.filter((step) => step === "downloadApk").length;
      passMinutes(15);
      runner.reconsider();
      await settle();
      assert.equal(downloads(), 1);
      passMinutes(24 * 60);
      runner.reconsider();
      await settle();
      assert.ok(downloads() > 1);
    });
  });

  describe("when something throws where nothing expected it", () => {
    const thrown = Effect.sync((): never => {
      throw new Error("the binder died");
    });

    it("isn't stuck: a throw in the APK check is logged, and the next check runs", async () => {
      let checks = 0;
      const { runner, logged, passMinutes, settle } = setup({
        check: Effect.sync(() => {
          checks++;
          return false;
        }),
        checkNative: thrown,
      });
      runner.reconsider();
      await settle();
      assert.ok(logged.some(({ level, message }) => level === "warn" && /binder/.test(message)));
      passMinutes(15);
      runner.reconsider();
      await settle();
      assert.equal(checks, 2);
    });

    it("isn't stuck by a throw in any other step", async () => {
      const { runner, did, logged, surroundings, settle } = setup({
        check: found,
        download: thrown,
      });
      runner.reconsider();
      await settle();
      assert.ok(logged.some(({ message }) => /binder/.test(message)));
      surroundings.network = "metered";
      runner.reconsider();
      await settle();
      assert.deepEqual(did, []);
    });
  });

  describe("when an APK's install or download comes to nothing", () => {
    it("doesn't download the same version again for a day after an install", async () => {
      let update: "available" | "downloaded" = "downloaded";
      const { runner, did, passMinutes, settle } = setup({
        check: Effect.succeed(false),
        checkNative: Effect.suspend(() => Effect.succeed(update)),
      });
      runner.reconsider();
      await settle();
      runner.requestInstall();
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["install"]);

      // Android refused it, and the file went with its answer.
      update = "available";
      for (const minutes of [15, 15, 15]) {
        passMinutes(minutes);
        runner.reconsider();
        await settle();
      }
      assert.deepEqual(did, ["install"]);

      passMinutes(24 * 60);
      runner.reconsider();
      await settle();
      assert.deepEqual(did.slice(0, 2), ["install", "downloadApk"]);
    });

    it("holds off the same way after a download that isn't the signed file", async () => {
      let downloads = 0;
      const { runner, logged, passMinutes, settle } = setup({
        checkNative: Effect.succeed("available"),
        downloadApk: Effect.sync(() => {
          downloads++;
          return false;
        }),
      });
      runner.reconsider();
      await settle();
      assert.equal(downloads, 1);
      assert.ok(logged.some(({ level, message }) => level === "warn" && /signed/.test(message)));
      passMinutes(15);
      runner.reconsider();
      await settle();
      runner.reconsider();
      await settle();
      assert.equal(downloads, 1);
    });

    it("doesn't hold off after a download that only failed", async () => {
      let downloads = 0;
      const { runner, passMinutes, settle } = setup({
        checkNative: Effect.succeed("available"),
        downloadApk: Effect.suspend(() => {
          downloads++;
          return failing;
        }),
      });
      runner.reconsider();
      await settle();
      passMinutes(15);
      runner.reconsider();
      await settle();
      assert.equal(downloads, 2);
    });

    it("doesn't hold back the next version", async () => {
      let offered = "1.3.0";
      let update: "available" | "downloaded" = "downloaded";
      const { runner, did, passMinutes, settle } = setup({
        check: Effect.succeed(false),
        checkNative: Effect.suspend(() => Effect.succeed(update)),
        offeredApkVersion: () => offered,
      });
      runner.reconsider();
      await settle();
      runner.requestInstall();
      runner.reconsider();
      await settle();
      offered = "1.3.1";
      update = "available";
      passMinutes(15);
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["install", "downloadApk"]);
    });
  });

  describe("the update button", () => {
    const apkAvailable: UpdateClient["checkNative"] = Effect.succeed("available");
    const apkDownloaded: UpdateClient["checkNative"] = Effect.succeed("downloaded");

    /** Past the first open's own check, so what follows comes from the tap. */
    const opened = async (client: Partial<UpdateClient> = {}) => {
      const run = setup({ lastCheckAt: 999_999_000, ...client });
      run.runner.reconsider();
      await run.settle();
      run.did.length = 0;
      return run;
    };

    const tap = async ({ runner, settle }: Pick<ReturnType<typeof setup>, "runner" | "settle">) => {
      runner.tapUpdateButton();
      runner.reconsider();
      await settle();
    };

    it("checks at a tap inside the 15 minutes and says Wave is up to date", async () => {
      const run = await opened();
      await tap(run);
      assert.deepEqual(run.did, ["check"]);
      assert.deepEqual(run.notices, ["upToDate"]);
    });

    it("installs at a tap a downloaded APK the pill was swiped away for", async () => {
      const run = await opened({ checkNative: apkDownloaded });
      assert.equal(run.runner.offeredVersion(), "1.3.0");
      await tap(run);
      assert.deepEqual(run.did, ["install"]);
      assert.deepEqual(run.notices, []);
    });

    it("downloads and installs what the check finds", async () => {
      let answer: NativeUpdate = "none";
      const run = await opened({ checkNative: Effect.sync(() => answer) });
      answer = "available";
      await tap(run);
      assert.deepEqual(run.did, ["check", "downloadApk", "install"]);
    });

    it("follows the pill's permission path once the download is in", async () => {
      let answer: NativeUpdate = "none";
      const run = await opened({ checkNative: Effect.sync(() => answer) });
      run.surroundings.installAccess = "needsPermission";
      answer = "available";
      await tap(run);
      assert.deepEqual(run.did, ["check", "downloadApk", "permission"]);
    });

    it("asks before mobile data, then downloads on it and installs", async () => {
      let answer: NativeUpdate = "none";
      const run = await opened({ checkNative: Effect.sync(() => answer) });
      run.surroundings.network = "metered";
      answer = "available";
      await tap(run);
      assert.deepEqual(run.did, ["check", "askMobileData", "downloadApkOnMobileData", "install"]);
    });

    it("downloads nothing when the person declines mobile data", async () => {
      let answer: NativeUpdate = "none";
      const run = await opened({
        checkNative: Effect.sync(() => answer),
        askMobileData: Effect.succeed(false),
      });
      run.surroundings.network = "metered";
      answer = "available";
      await tap(run);
      assert.deepEqual(run.did, ["check"]);
      assert.deepEqual(run.notices, []);
      assert.equal(run.runner.buttonLook(), "idle");
    });

    it("leaves a bundle to its silent path, closing nothing", async () => {
      let available = false;
      const run = await opened({ check: Effect.sync(() => available) });
      available = true;
      await tap(run);
      assert.deepEqual(run.did, ["download"]);
      assert.deepEqual(run.notices, ["bundleOnItsWay"]);
    });

    it("says when the check fails", async () => {
      const run = await opened({ checkNative: failing });
      await tap(run);
      assert.deepEqual(run.notices, ["checkFailed"]);
      run.notices.length = 0;
      run.passMinutes(1);
      await tap(run);
      assert.deepEqual(run.notices, ["checkFailed"]);
    });

    it("says the check failed with no network, and tries nothing", async () => {
      const run = await opened();
      run.surroundings.network = "none";
      await tap(run);
      assert.deepEqual(run.did, []);
      assert.deepEqual(run.notices, ["checkFailed"]);
      assert.equal(run.runner.buttonLook(), "idle");
    });

    it("says when the download fails or isn't the signed file", async () => {
      for (const downloadApk of [failing, Effect.succeed(false)]) {
        let answer: NativeUpdate = "none";
        const run = await opened({ checkNative: Effect.sync(() => answer), downloadApk });
        answer = "available";
        await tap(run);
        assert.deepEqual(run.notices, ["downloadFailed"]);
        assert.deepEqual(run.did, ["check"]);
      }
    });

    it("says nothing of an automatic download that fails", async () => {
      const run = setup({ checkNative: apkAvailable, downloadApk: failing });
      run.runner.reconsider();
      await run.settle();
      assert.deepEqual(run.notices, []);
    });

    it("says when an install fails, from the pill too", async () => {
      const run = await opened({ checkNative: apkDownloaded, installApk: failing });
      run.runner.requestInstall();
      run.runner.reconsider();
      await run.settle();
      assert.deepEqual(run.notices, ["installFailed"]);
    });

    it("says when Android refuses the install, and a tap can try again", async () => {
      const run = await opened({ checkNative: apkDownloaded });
      await tap(run);
      run.runner.installRefused();
      assert.deepEqual(run.notices, ["installFailed"]);
      run.did.length = 0;
      await tap(run);
      assert.deepEqual(run.did, ["check", "install"]);
    });

    it("spins while checking, and a second tap doesn't check twice", async () => {
      let finish = (_: Effect.Effect<boolean>) => {};
      const run = await opened({
        check: Effect.callback<boolean>((resume) => {
          run.did.push("check");
          finish = resume;
        }),
      });
      run.runner.tapUpdateButton();
      run.runner.reconsider();
      assert.equal(run.runner.buttonLook(), "checking");
      run.runner.tapUpdateButton();
      run.runner.reconsider();
      finish(Effect.succeed(false));
      await run.settle();
      assert.deepEqual(run.did, ["check"]);
      assert.equal(run.runner.buttonLook(), "idle");
    });

    it("shows the percentage of a download, then rests", async () => {
      let finish = (_: Effect.Effect<boolean>) => {};
      let answer: NativeUpdate = "none";
      const run = await opened({
        checkNative: Effect.sync(() => answer),
        downloadApk: Effect.callback<boolean>((resume) => {
          finish = resume;
        }),
      });
      answer = "available";
      await tap(run);
      assert.equal(run.runner.buttonLook(), 0);
      run.runner.downloadProgress(42);
      assert.equal(run.runner.buttonLook(), 42);
      finish(Effect.succeed(true));
      await run.settle();
      assert.equal(run.runner.buttonLook(), "idle");
      assert.deepEqual(run.did, ["check", "install"]);
    });

    it("joins an automatic download, installing what it brings", async () => {
      let finish = (_: Effect.Effect<boolean>) => {};
      const run = setup({
        checkNative: apkAvailable,
        downloadApk: Effect.callback<boolean>((resume) => {
          finish = resume;
        }),
      });
      run.runner.reconsider();
      await run.settle();
      assert.equal(run.runner.buttonLook(), 0);
      run.runner.tapUpdateButton();
      run.runner.reconsider();
      finish(Effect.succeed(true));
      await run.settle();
      assert.deepEqual(run.did, ["check", "install"]);
    });
  });
});
