import assert from "node:assert/strict";
import { test } from "node:test";
import { createDownloadRecovery } from "./downloadRecovery.ts";

const done = (id: string, generation = 1) => ({
  id,
  generation,
  phase: "completed",
  acknowledged: true,
});

test("a finished run cleans up once, with no reads for each landed song or repeated poll", async () => {
  let version = 0;
  let reads = 0;
  const recovery = createDownloadRecovery({
    version: () => String(version),
    read: async () => {
      reads++;
      return ["gone"];
    },
    forget: async () => true,
  });
  for (let i = 1; i <= 50; i++) {
    version++;
    await recovery([done("gone"), done(String(i))], true);
  }
  assert.equal(reads, 0);
  const jobs = [done("gone"), done("kept")];
  assert.deepEqual(await recovery(jobs, false), [done("kept")]);
  await recovery(jobs, false);
  assert.equal(reads, 1);
  version++;
  await recovery(jobs, false);
  assert.equal(reads, 2, "a later Library deletion is checked");
});

test("a Library change during recovery discards the old read and a failed read can retry", async () => {
  let version = 1;
  let fail = true;
  let forgets = 0;
  const recovery = createDownloadRecovery({
    version: () => String(version),
    read: async () => {
      if (fail) throw new Error("read failed");
      if (version === 1) version++;
      return ["gone"];
    },
    forget: async (_id: string, generation: number) => {
      assert.equal(generation, 7);
      forgets++;
      return true;
    },
  });
  const jobs = [done("gone", 7)];
  await assert.rejects(recovery(jobs, false), /read failed/);
  fail = false;
  assert.deepEqual(await recovery(jobs, false), jobs);
  assert.equal(forgets, 0, "a stale answer cannot remove the download");
  assert.deepEqual(await recovery(jobs, false), []);
  assert.equal(forgets, 1);
});
