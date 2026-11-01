import assert from "node:assert/strict";
import { describe, it } from "node:test";

import * as Effect from "effect/Effect";

import { createUpdateRunner, type UpdateClient, type UpdateSurroundings } from "./updateRunner.ts";

/** A runner over a scripted update service, with what it did and logged written down. */
const setup = (client: Partial<UpdateClient> = {}) => {
  const did: string[] = [];
  const logged: { level: string; message: string }[] = [];
  const surroundings: { -readonly [K in keyof UpdateSurroundings]: UpdateSurroundings[K] } = {
    network: "unmetered",
    playing: false,
    visible: true,
    installAccess: "silent",
  };
  let lastCheckAt: number | null = null;
  let lastInstallAskAt: number | null = null;
  let lastInstallAt: number | null = null;
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
      }),
      askInstallPermission: Effect.sync(() => {
        did.push("ask");
        return true;
      }),
      installApk: Effect.sync(() => {
        did.push("install");
      }),
      ...client,
    },
    surroundings: () => surroundings,
    now: () => now,
    lastCheckAt: { get: () => lastCheckAt, set: (at) => (lastCheckAt = at) },
    lastInstallAskAt: { get: () => lastInstallAskAt, set: (at) => (lastInstallAskAt = at) },
    lastInstallAt: { get: () => lastInstallAt, set: (at) => (lastInstallAt = at) },
    log: (level, message) => logged.push({ level, message }),
  });
  return {
    runner,
    did,
    logged,
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

    it("downloads the APK, holds it while Wave is visible, and installs it once hidden", async () => {
      const { runner, did, surroundings, settle } = setup(foundApk);
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk"]);
      surroundings.visible = false;
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk", "install"]);
    });

    it("skips the download of an APK already on the phone", async () => {
      const { runner, did, surroundings, settle } = setup({
        ...nothingElse,
        checkNative: Effect.succeed("downloaded"),
      });
      runner.reconsider();
      await settle();
      surroundings.visible = false;
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["install"]);
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

    it("installs only the APK when a bundle waits too", async () => {
      const { runner, did, surroundings, settle } = setup({ ...foundApk, check: found });
      runner.reconsider();
      await settle();
      surroundings.visible = false;
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk", "install"]);
    });

    it("keeps a native check's failure from stopping the bundle's", async () => {
      const { runner, did, logged, settle } = setup({ check: found, checkNative: failing });
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["download"]);
      assert.ok(logged.some(({ level, message }) => level === "warn" && /APK/.test(message)));
    });

    it("doesn't install again right after a commit, while Android works on it", async () => {
      const { runner, did, surroundings, settle } = setup(foundApk);
      runner.reconsider();
      await settle();
      surroundings.visible = false;
      runner.reconsider();
      await settle();
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk", "install"]);
    });

    it("after a failed install, downloads again 15 minutes on, as the file may be gone", async () => {
      let installs = 0;
      const { runner, did, logged, surroundings, passMinutes, settle } = setup({
        ...foundApk,
        installApk: Effect.suspend(() => {
          installs++;
          return failing;
        }),
      });
      runner.reconsider();
      await settle();
      surroundings.visible = false;
      runner.reconsider();
      await settle();
      assert.equal(installs, 1);
      assert.ok(logged.some(({ message }) => /install failed/i.test(message)));
      passMinutes(15);
      surroundings.visible = true;
      runner.reconsider();
      await settle();
      assert.ok(did.filter((step) => step === "downloadApk").length >= 2);
    });

    it("asks for the permission once a day, and doesn't install without it", async () => {
      const { runner, did, surroundings, passMinutes, settle } = setup(foundApk);
      surroundings.installAccess = "needsPermission";
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk", "ask"]);
      runner.reconsider();
      await settle();
      surroundings.visible = false;
      runner.reconsider();
      await settle();
      assert.deepEqual(did, ["downloadApk", "ask"]);
      passMinutes(24 * 60);
      surroundings.visible = true;
      runner.reconsider();
      await settle();
      assert.equal(did.filter((step) => step === "ask").length, 2);
    });

    it("doesn't spend the day's question when something was in the way", async () => {
      let asks = 0;
      const { runner, surroundings, settle } = setup({
        ...foundApk,
        askInstallPermission: Effect.sync(() => {
          asks++;
          return asks > 1;
        }),
      });
      surroundings.installAccess = "needsPermission";
      runner.reconsider();
      await settle();
      assert.equal(asks, 1);
      runner.reconsider();
      await settle();
      assert.equal(asks, 2);
      runner.reconsider();
      await settle();
      assert.equal(asks, 2);
    });
  });
});
