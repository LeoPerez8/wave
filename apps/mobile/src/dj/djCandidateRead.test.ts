import assert from "node:assert/strict";
import test from "node:test";

import { djArtistTile } from "@wave/core";

import { createDjCandidateReader } from "./djCandidateRead.ts";

test("DJ candidates are read on demand once and concurrent requests share the work", async () => {
  const artist = djArtistTile("Portishead")!;
  const reader = createDjCandidateReader();
  let release!: (tiles: readonly (typeof artist)[]) => void;
  let reads = 0;
  const load = () => {
    reads += 1;
    return new Promise<readonly (typeof artist)[]>((resolve) => {
      release = resolve;
    });
  };

  assert.equal(reads, 0);
  const first = reader.read(load);
  const concurrent = reader.read(load);
  await Promise.resolve();
  assert.equal(reads, 1);
  assert.equal(first, concurrent);
  release([artist]);
  assert.deepEqual(await first, [artist]);
  assert.deepEqual(await reader.read(load), [artist]);
  assert.equal(reads, 1);
});

test("a failed DJ candidate read can be retried", async () => {
  const reader = createDjCandidateReader();
  await assert.rejects(reader.read(async () => Promise.reject(new Error("read failed"))));
  const artist = djArtistTile("Portishead")!;
  assert.deepEqual(await reader.read(async () => [artist]), [artist]);
});
