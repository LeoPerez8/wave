import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { createBuildSource } from "./buildSource.ts";

test("a source change cancels a suspended build, discards its output and restarts from the new version", async () => {
  const source=createBuildSource();
  let attempts=0, released=0;
  const read=Effect.gen(function*(){
    attempts++;
    if(attempts===1) yield* Effect.callback<void>(()=>Effect.sync(()=>{released++;}));
    return attempts;
  });
  const result=Effect.runPromise(source.run(read,Effect.void));
  source.changed();
  assert.equal(await result,2); assert.equal(released,1);
});
