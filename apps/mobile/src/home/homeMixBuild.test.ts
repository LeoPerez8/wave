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

test("one wall-clock deadline includes the input wait and ranking, rejecting late mixes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  let inputReady!: () => void;
  let ranked!: () => void;
  const building = Effect.runPromise(
    buildHomeMixes(
      ["artist-mixes"],
      Effect.callback<string>((resume) => {
        inputReady = () => resume(Effect.succeed("snapshot"));
      }),
      () =>
        Effect.callback<string>((resume) => {
          ranked = () => resume(Effect.succeed("late mixes"));
        }),
    ),
  );
  const rejected = assert.rejects(building, /Recommendation deadline elapsed/);
  t.mock.timers.setTime(50_000);
  inputReady();
  await turn();
  t.mock.timers.setTime(60_000);
  ranked();
  await rejected;
});
