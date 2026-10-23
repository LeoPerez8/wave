import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { createMixIndexesRead } from "./mixIndexesRead.ts";

const later = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

test("a slider re-rank whose cold indexes are read when a song starts still re-ranks, with the indexes read after it", async () => {
  let reads = 0;
  const indexes = createMixIndexesRead(
    Effect.promise(async () => {
      const version = ++reads;
      await later(40);
      return { version };
    }),
  );
  // discoverMixes' rerank: Effect.result(rerankedOf(...)), dropped unless it succeeds.
  const rerank = Effect.runPromise(Effect.result(indexes.get));
  await later(10);
  indexes.change({ kind: "plays", ids: [1], burst: true }); // a song starts
  const result = await rerank;
  assert.ok(Result.isSuccess(result), "the re-rank is applied");
  assert.deepEqual(result.success, { version: 2 });
  assert.equal(reads, 2);
  indexes.dispose();
});

test("only the indexes' sources read them again; the read under way carries on through others", async () => {
  let reads = 0;
  const indexes = createMixIndexesRead(
    Effect.promise(async () => {
      const version = ++reads;
      await later(20);
      return version;
    }),
  );
  const harvest = Effect.runPromise(indexes.get);
  await later(5);
  indexes.change({ kind: "favorites" });
  indexes.change({ kind: "folders" });
  assert.equal(await harvest, 1);
  for (const kind of ["tracks", "playlists", "streamed"] as const) {
    indexes.change({ kind }); // the kept answer is forgotten: the next ask reads
    const waiting = Effect.runPromise(indexes.get);
    await later(5);
    indexes.change({ kind });
    assert.equal(await waiting, reads);
  }
  assert.equal(reads, 7, "each change read once more under its waiter");
  indexes.dispose();
});
