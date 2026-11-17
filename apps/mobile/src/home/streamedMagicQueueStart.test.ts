import assert from "node:assert/strict";
import { test } from "node:test";

import { startFromLibraryMatch } from "./streamedMagicQueueStart.ts";

test("a streamed seed falls back once when its Library lookup fails", async () => {
  const started: unknown[] = [];

  await startFromLibraryMatch(Promise.reject(new Error("lookup failed")), (match) =>
    started.push(match),
  );

  assert.deepEqual(started, [null]);
});

test("a start failure does not start the streamed seed a second time", async () => {
  let starts = 0;

  await assert.rejects(
    startFromLibraryMatch(Promise.resolve("library song"), () => {
      starts++;
      throw new Error("start failed");
    }),
    /start failed/,
  );

  assert.equal(starts, 1);
});
