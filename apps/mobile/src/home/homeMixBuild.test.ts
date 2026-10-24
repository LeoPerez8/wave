import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { RECOMMENDATION_SNAPSHOT, snapshotVersionsAfter, type SnapshotVersions } from "@wave/core";
import { snapshotRead } from "../lib/snapshotRead.ts";
import { buildHomeMixes } from "./homeMixBuild.ts";

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("both mix rows use one snapshot even when writes arrive during reading and ranking", async () => {
  let versions: SnapshotVersions = {};
  let reads = 0;
  let release!: () => void;
  const snapshot = snapshotRead(
    Effect.callback<{ version: number }>((resume) => {
      const version = ++reads;
      release = () => resume(Effect.succeed({ version }));
    }),
    { part: RECOMMENDATION_SNAPSHOT.library, versions: () => versions },
  );
  const building = Effect.runPromise(
    buildHomeMixes(["artist-mixes", "genre-mixes"], snapshot.get, (id, input) =>
      Effect.sync(() => {
        versions = snapshotVersionsAfter(versions, "plays");
        return `${id}:${input.version}`;
      }),
    ),
  );
  await turn();
  versions = snapshotVersionsAfter(versions, "tracks");
  release();
  const results = await building;
  assert.deepEqual(
    results.map(({ id, result }) => [id, Result.getOrThrow(result)]),
    [
      ["artist-mixes", "artist-mixes:1"],
      ["genre-mixes", "genre-mixes:1"],
    ],
  );
  assert.equal(reads, 1, "a write belongs to the next build");
  snapshot.dispose();
});

test("a slow row doesn't delay starting the other row, and its failure keeps the other's result", async () => {
  let release!: () => void;
  const building = Effect.runPromise(
    buildHomeMixes(["artist-mixes", "genre-mixes"], Effect.succeed("snapshot"), (id, input) =>
      id === "artist-mixes"
        ? Effect.callback<string, string>((resume) => {
            release = () => resume(Effect.fail("artist ranking failed"));
          })
        : Effect.sync(() => {
            release();
            return `${input} genre mixes`;
          }),
    ),
  );
  const [artist, genre] = await building;
  assert.ok(Result.isFailure(artist!.result));
  assert.equal(artist!.result.failure, "artist ranking failed");
  assert.equal(Result.getOrThrow(genre!.result), "snapshot genre mixes");
});

test("a manual refresh builds only the requested row", async () => {
  const results = await Effect.runPromise(
    buildHomeMixes(["genre-mixes"], Effect.succeed(42), (id, input) =>
      Effect.succeed({ id, input }),
    ),
  );
  assert.deepEqual(
    results.map(({ result }) => Result.getOrThrow(result)),
    [{ id: "genre-mixes", input: 42 }],
  );
});
