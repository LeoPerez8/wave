import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";

import { createSourceRead } from "./sourceRead.ts";

/** A read that counts its starts and finishes when told, like a read in pages between free turns. */
const paced = () => {
  const finishes: (() => void)[] = [];
  let reads = 0;
  const read = Effect.callback<number>((resume) => {
    const answer = ++reads;
    finishes.push(() => resume(Effect.succeed(answer)));
  });
  return { read, finish: () => finishes.pop()!(), reads: () => reads };
};

const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

test("the answer is kept until a source it reads changes", async () => {
  const { read, finish, reads } = paced();
  const source = createSourceRead(read, ["playlists"]);
  const asked = Effect.runPromise(source.get);
  await turn();
  finish();
  assert.equal(await asked, 1);
  assert.equal(await Effect.runPromise(source.get), 1);
  source.change({ kind: "favorites" });
  assert.equal(await Effect.runPromise(source.get), 1);
  assert.equal(reads(), 1);
  source.change({ kind: "playlists" });
  const again = Effect.runPromise(source.get);
  await turn();
  finish();
  assert.equal(await again, 2);
  source.dispose();
});

test("a stream of additions doesn't restart a read under way, and the next ask after it reads again", async () => {
  const { read, finish, reads } = paced();
  const source = createSourceRead(read, ["tracks"]);
  const asked = Effect.runPromise(source.get);
  await turn();
  for (let batch = 0; batch < 10; batch++) source.change({ kind: "tracks", burst: true });
  const meanwhile = Effect.runPromise(source.get);
  await turn();
  assert.equal(reads(), 1);
  finish();
  assert.equal(await asked, 1);
  assert.equal(await meanwhile, 1);
  const next = Effect.runPromise(source.get);
  await turn();
  assert.equal(reads(), 2);
  finish();
  assert.equal(await next, 2);
  source.dispose();
});

test("an edit restarts a read under way, whose waiters get the new answer", async () => {
  const { read, finish, reads } = paced();
  const source = createSourceRead(read, ["playlists"]);
  const asked = Effect.runPromise(source.get);
  await turn();
  source.change({ kind: "playlists" });
  await turn();
  assert.equal(reads(), 2);
  finish();
  assert.equal(await asked, 2);
  source.dispose();
});
