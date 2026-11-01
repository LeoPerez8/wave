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
  };
  let lastCheckAt: number | null = null;
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
      ...client,
    },
    surroundings: () => surroundings,
    now: () => now,
    lastCheckAt: { get: () => lastCheckAt, set: (at) => (lastCheckAt = at) },
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
    let finish = (_: boolean): void => {};
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
});
