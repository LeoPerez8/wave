import assert from "node:assert/strict";
import { test } from "node:test";
import { createSerialWork } from "./serialWork.ts";

test("daily sections run serially, queued/running work can be cancelled, and a return can retry", async () => {
  const events: string[] = [];
  let finish: (() => void) | undefined;
  const jobs = createSerialWork();
  const artist = jobs.add(
    "artist",
    (signal) =>
      new Promise<void>((resolve) => {
        events.push("artist");
        finish = resolve;
        signal.addEventListener("abort", () => {
          events.push("cancel");
          resolve();
        });
      }),
  );
  const genre = jobs.add("genre", async () => {
    events.push("genre");
  });
  await Promise.resolve();
  assert.deepEqual(events, ["artist"]);
  artist();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ["artist", "cancel", "genre"]);
  genre();
  finish?.();
  jobs.add("artist", async () => {
    events.push("return");
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.at(-1), "return");
  jobs.dispose();
});

test("a rapid tab return queues a replacement behind a cancelled section's cleanup", async () => {
  const jobs = createSerialWork();
  let starts = 0;
  const cancel = jobs.add(
    "artist",
    (signal) =>
      new Promise<void>((resolve) => {
        starts++;
        signal.addEventListener("abort", () => resolve());
      }),
  );
  await Promise.resolve();
  cancel();
  jobs.add("artist", async () => {
    starts++;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(starts, 2);
  jobs.dispose();
});
