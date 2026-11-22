import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { runTestPromise } from "../lib/steppedTesting.ts";
import * as Data from "effect/Data";
import { shareArtistGraph } from "./sharedArtistGraph.ts";
import type { ArtistGraphReads } from "./artistGraph.ts";

class ReadFailed extends Data.TaggedError("LibraryStoreError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

const emptyStore: ArtistGraphReads = {
  graphCatalogPage: () => Effect.succeed({ rows: [], next: null }),
  graphRadioPage: () => Effect.succeed({ rows: [], next: null }),
  ytArtistSimilar: Effect.succeed([]),
  mixCreditNames: Effect.succeed([]),
  graphPlays: Effect.succeed([]),
};

test("a failed graph read is an error, and Try Again can obtain a fresh graph", async (t) => {
  let broken = true;
  const shared = shareArtistGraph(
    Effect.succeed({
      ...emptyStore,
      graphPlays: Effect.suspend(() =>
        broken
          ? Effect.fail(new ReadFailed({ operation: "read graph", cause: "database unavailable" }))
          : emptyStore.graphPlays,
      ),
    }),
    Effect.void,
    Effect.void,
  );
  t.after(shared.dispose);
  await assert.rejects(runTestPromise(shared.get));
  broken = false;
  assert.ok(await runTestPromise(shared.get));
});

test("last-result readers stay available while a new graph derives beyond the old deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let versions = {};
  let release!: () => void;
  let paused = false;
  const shared = shareArtistGraph(
    Effect.succeed(emptyStore),
    Effect.suspend(() =>
      paused
        ? Effect.callback<void>((resume) => {
            release = () => resume(Effect.void);
          })
        : Effect.void,
    ),
    Effect.void,
    { versions: () => versions },
  );
  t.after(shared.dispose);
  assert.equal(shared.peek(), null);
  const first = await runTestPromise(shared.get);
  versions = { catalog: 1 };
  paused = true;
  const warming = runTestPromise(shared.get);
  await new Promise<void>((resolve) => setImmediate(resolve));
  t.mock.timers.tick(120_000);
  assert.equal(shared.peek(), first);
  release();
  const next = await warming;
  assert.notEqual(next, first);
  assert.equal(shared.peek(), next);
});
