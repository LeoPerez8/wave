import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import * as Data from "effect/Data";
import { playlistRecommendationSession } from "@wave/core";
import { shareArtistGraph } from "./sharedArtistGraph.ts";
import type { ArtistGraphReads } from "./artistGraph.ts";

class ReadFailed extends Data.TaggedError("LibraryStoreError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {}

const emptyStore: ArtistGraphReads = {
  graphCatalogPage: () => Effect.succeed({ rows: [], next: null }),
  graphRadioPage: () => Effect.succeed({ rows: [], next: null }),
  graphSimilarPage: () => Effect.succeed({ rows: [], next: null }),
  graphPlayPage: () => Effect.succeed({ rows: [], next: null }),
};

test("a hung shared graph fails all its readers and a later ask can read again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let hung = true;
  const shared = shareArtistGraph(
    Effect.succeed({
      ...emptyStore,
      graphPlayPage: () => (hung ? Effect.never : emptyStore.graphPlayPage([-1, 0])),
    }),
    Effect.void,
    Effect.void,
  );
  t.after(shared.dispose);
  const first = Effect.runPromise(shared.get);
  const peer = Effect.runPromise(shared.get);
  let outcome = "pending";
  const failed = Promise.all([assert.rejects(first), assert.rejects(peer)]).then(() => {
    outcome = "failed";
  });
  t.mock.timers.tick(15_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(outcome, "failed", "graph work has a fifteen-second deadline");
  await failed;
  hung = false;
  const graph = await Effect.runPromise(shared.get);
  assert.ok(graph);
  assert.equal(await Effect.runPromise(shared.get), graph);
});

test("a failed graph read is an error, and Try Again can obtain a fresh graph", async (t) => {
  let broken = true;
  const shared = shareArtistGraph(
    Effect.succeed({
      ...emptyStore,
      graphPlayPage: () =>
        broken
          ? Effect.fail(new ReadFailed({ operation: "read graph", cause: "database unavailable" }))
          : emptyStore.graphPlayPage([-1, 0]),
    }),
    Effect.void,
    Effect.void,
  );
  t.after(shared.dispose);
  await assert.rejects(Effect.runPromise(shared.get));
  broken = false;
  assert.ok(await Effect.runPromise(shared.get));
});

test("playlist suggestions stop loading on a graph timeout and a renewal retries the graph", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  let hung = true;
  const shared = shareArtistGraph(
    Effect.succeed({
      ...emptyStore,
      graphPlayPage: () => (hung ? Effect.never : emptyStore.graphPlayPage([-1, 0])),
    }),
    Effect.void,
    Effect.void,
  );
  const session = playlistRecommendationSession({
    newId: () => "offer",
    read: async () => ({
      playlist: [],
      sources: { library: [], catalog: [], graph: await Effect.runPromise(shared.get), now: 0 },
    }),
    dismiss: async () => {},
  });
  t.after(() => {
    session.dispose();
    shared.dispose();
  });
  const loading = session.renew();
  assert.equal(session.get().loading, true);
  t.mock.timers.tick(15_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(session.get().loading, false);
  assert.equal(session.get().error, "load");
  await loading;
  hung = false;
  await session.renew();
  assert.equal(session.get().loading, false);
  assert.equal(session.get().error, null);
});

test("a stalled catalog fails the graph at its fifteen-second deadline", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const shared = shareArtistGraph(Effect.succeed(emptyStore), Effect.void, Effect.void, {
    catalog: Effect.never,
  });
  t.after(shared.dispose);
  let outcome = "pending";
  const failed = assert.rejects(Effect.runPromise(shared.get)).then(() => {
    outcome = "failed";
  });
  t.mock.timers.tick(15_000);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(outcome, "failed", "the wait for the catalog counts towards the graph's deadline");
  await failed;
});
