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
