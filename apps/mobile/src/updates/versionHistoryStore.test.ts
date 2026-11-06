import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { DatedRelease } from "@wave/core";
import * as Effect from "effect/Effect";

import { createVersionHistoryStore } from "./versionHistoryStore.ts";

const release: DatedRelease = {
  version: "0.48.0-ti",
  date: Date.parse("2026-11-04T12:00:00.000Z"),
  notes: {
    en: { new: ["A"], fixes: [] },
    "pt-BR": { new: ["B"], fixes: [] },
  },
};

const settle = () => new Promise((resolve) => setTimeout(resolve));

/** An answer that arrives when the test says. */
const later = <A>() => {
  let arrive: (value: A) => void = () => {};
  const answer = Effect.promise(() => new Promise<A>((resolve) => (arrive = resolve)));
  return { answer, arrive: (value: A) => arrive(value) };
};

/**
 * A store over a scripted service: each read takes the next answer. [kept] is what the phone holds
 * when it starts.
 */
const store = (
  answers: Effect.Effect<readonly DatedRelease[], unknown>[],
  kept: readonly DatedRelease[] | null = null,
) => {
  let reads = 0;
  const logged: string[] = [];
  const phone = { kept };
  const history = createVersionHistoryStore({
    fetchHistory: () => {
      reads++;
      return answers.shift() ?? Effect.fail(new Error("no more answers"));
    },
    kept: {
      read: () => phone.kept,
      write: (releases) => (phone.kept = releases),
    },
    log: (_, message) => logged.push(message),
  });
  return { history, logged, reads: () => reads, phone };
};

const older: DatedRelease = { ...release, version: "0.47.0-ti" };

describe("Version History's store", () => {
  it("reads the channel's history and tells whoever listens", async () => {
    const service = later<readonly DatedRelease[]>();
    const { history } = store([service.answer]);
    let told = 0;
    history.subscribe(() => told++);
    assert.deepEqual(history.get(), { status: "idle", releases: null });

    history.load();
    assert.equal(history.get().status, "loading");
    service.arrive([release]);
    await settle();

    assert.deepEqual(history.get(), { status: "loaded", releases: [release] });
    assert.ok(told >= 2);
  });

  it("fails to the log, and Try Again reads again", async () => {
    const { history, logged, reads } = store([
      Effect.fail(new Error("offline")),
      Effect.succeed([release]),
    ]);
    history.load();
    await settle();
    assert.deepEqual(history.get(), { status: "failed", releases: null });
    assert.deepEqual(logged, ["The version history fetch failed: offline"]);

    history.load();
    await settle();
    assert.equal(reads(), 2);
    assert.deepEqual(history.get(), { status: "loaded", releases: [release] });
  });

  it("asks once while a read is on its way", async () => {
    const service = later<readonly DatedRelease[]>();
    const { history, reads } = store([service.answer]);
    history.load();
    history.load();
    assert.equal(reads(), 1);
    service.arrive([release]);
    await settle();
    assert.equal(history.get().status, "loaded");
  });

  it("keeps the last list while it reads again, and after that read fails", async () => {
    const service = later<readonly DatedRelease[]>();
    const { history } = store([Effect.succeed([release]), service.answer]);
    history.load();
    await settle();
    history.load();
    assert.deepEqual(history.get(), { status: "loading", releases: [release] });
    service.arrive([]);
    await settle();
    assert.deepEqual(history.get(), { status: "loaded", releases: [] });

    history.load();
    await settle();
    assert.deepEqual(history.get(), { status: "failed", releases: [] });
  });

  it("opens with the list the phone kept, before any read answers", () => {
    const { history, reads } = store([later<readonly DatedRelease[]>().answer], [older]);
    assert.deepEqual(history.get(), { status: "idle", releases: [older] });

    history.load();
    assert.equal(reads(), 1);
    assert.deepEqual(history.get(), { status: "loading", releases: [older] });
  });

  it("keeps each answer on the phone in place of the one before", async () => {
    const { history, phone } = store([Effect.succeed([release, older])], [older]);
    history.load();
    await settle();
    assert.deepEqual(history.get(), { status: "loaded", releases: [release, older] });
    assert.deepEqual(phone.kept, [release, older]);
  });

  it("keeps the kept list on screen and on the phone when the read fails", async () => {
    const { history, phone, logged } = store([Effect.fail(new Error("offline"))], [older]);
    history.load();
    await settle();
    assert.deepEqual(history.get(), { status: "failed", releases: [older] });
    assert.deepEqual(phone.kept, [older]);
    assert.deepEqual(logged, ["The version history fetch failed: offline"]);
  });
});
