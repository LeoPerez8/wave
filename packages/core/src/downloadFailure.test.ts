import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  downloadFailureAnswer,
  downloadFailureCause,
  downloadFailurePlan,
  downloadStorageFull,
} from "./index.ts";

describe("downloadFailureCause", () => {
  test("an error says its class and message", () => {
    assert.equal(
      downloadFailureCause(new Error("A credit names no artist")),
      "Error: A credit names no artist",
    );
    assert.equal(
      downloadFailureCause(new TypeError("Cannot read properties of undefined (reading 'path')")),
      "TypeError: Cannot read properties of undefined (reading 'path')",
    );
  });

  test("a native module's rejection keeps its code", () => {
    const rejection = Object.assign(new Error("Couldn't reach YouTube"), {
      code: "ERR_YT_OFFLINE",
    });
    assert.equal(downloadFailureCause(rejection), "Error [ERR_YT_OFFLINE]: Couldn't reach YouTube");
  });

  test("a tagged error says its tag", () => {
    const locked = Object.assign(new Error("database is locked"), { _tag: "SqlError" });
    assert.equal(downloadFailureCause(locked), "SqlError: database is locked");
    assert.equal(downloadFailureCause({ _tag: "NoSuchElement" }), "NoSuchElement");
  });

  test("what an error was caused by follows it", () => {
    const disk = new Error("disk I/O error");
    const save = new Error("Couldn't save the batch", { cause: disk });
    assert.equal(
      downloadFailureCause(save),
      "Error: Couldn't save the batch <- Error: disk I/O error",
    );
  });

  test("a thrown string is the cause as it is; nothing thrown is no cause", () => {
    assert.equal(downloadFailureCause("bridge went away"), "bridge went away");
    assert.equal(downloadFailureCause(undefined), null);
    assert.equal(downloadFailureCause(null), null);
  });

  test("a cause fits in the journal: at most 1000 characters", () => {
    const cause = downloadFailureCause(new Error("x".repeat(5_000)));
    assert.equal(cause?.length, 1_000);
    assert.ok(cause?.startsWith("Error: xxx"));
  });
});

describe("downloadStorageFull", () => {
  test("a full database or disk is a storage failure", () => {
    const sqlite = Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
    assert.equal(
      downloadStorageFull(new Error("Couldn't save the batch", { cause: sqlite })),
      true,
    );
    assert.equal(
      downloadStorageFull(new Error("write failed: ENOSPC (No space left on device)")),
      true,
    );
  });

  test("any other error is not", () => {
    assert.equal(downloadStorageFull(new Error("database is locked")), false);
    assert.equal(downloadStorageFull(new TypeError("roots is not iterable")), false);
    assert.equal(downloadStorageFull(undefined), false);
  });
});

describe("downloadFailureAnswer", () => {
  const youtube = downloadFailurePlan("youtube", { ytMusicOn: true });
  const soulseek = downloadFailurePlan("soulseek", { ytMusicOn: true });
  const fallback = { source: "youtube", targetPath: "/Music/A/B/01 C.m4a", failurePlan: youtube };
  const tags = { title: "Swallow The Bomb", artist: "Royal Blood" };

  test("a failed prepare keeps the retry and fallback plan the job holds, with what went wrong", () => {
    const answer = downloadFailureAnswer(
      "prepare",
      "failed",
      new TypeError("roots is not iterable"),
      {
        failurePlan: soulseek,
        fallback,
        tags,
      },
    );
    assert.deepEqual(answer, {
      failure: "failed",
      cause: "TypeError: roots is not iterable",
      failurePlan: soulseek,
      fallback,
      tags,
    });
  });

  test("a failure decided on (no folder, no source) has no cause", () => {
    assert.deepEqual(
      downloadFailureAnswer("prepare", "noFolder", undefined, { failurePlan: youtube }),
      {
        failure: "noFolder",
        failurePlan: youtube,
      },
    );
  });

  test("other decisions answer the failure and its cause alone", () => {
    assert.deepEqual(
      downloadFailureAnswer("import", "failed", new Error("A credit names no artist"), {
        failurePlan: soulseek,
        fallback,
        tags,
      }),
      { failure: "failed", cause: "Error: A credit names no artist" },
    );
  });
});
