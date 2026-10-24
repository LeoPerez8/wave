import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  RECOMMENDATION_SNAPSHOT,
  snapshotAsk,
  snapshotVersionsAfter,
  type SnapshotSource,
} from "./index.ts";

const { library, catalog, graph } = RECOMMENDATION_SNAPSHOT;

describe("when a recommendation snapshot is read again", () => {
  test("the first ask reads", () => {
    assert.equal(snapshotAsk(catalog, null, {}, 0), "read");
  });

  test("everyone who asks before a write shares the read, under way or done", () => {
    const versions = snapshotVersionsAfter({}, "catalog");
    for (const done of [false, true])
      assert.equal(snapshotAsk(catalog, { versions, done, usedAt: 0 }, versions, 1_000), "share");
  });

  test("a harvest batch written while the catalog is read waits for the read under way, then reads again", () => {
    const before = snapshotVersionsAfter({}, "catalog");
    const after = snapshotVersionsAfter(before, "catalog");
    const reading = { versions: before, done: false, usedAt: 0 };
    assert.equal(snapshotAsk(catalog, reading, after, 1_000), "read-after");
    assert.equal(snapshotAsk(catalog, { ...reading, done: true }, after, 1_000), "read");
  });

  test("a read waiting for the one before it shares whatever was written meanwhile", () => {
    const later = snapshotVersionsAfter(snapshotVersionsAfter({}, "catalog"), "plays");
    assert.equal(snapshotAsk(graph, { versions: null, done: false, usedAt: 0 }, later, 0), "share");
  });

  test("each part reads again only for its own sources", () => {
    const kept = (part: typeof library | typeof catalog | typeof graph, source: SnapshotSource) =>
      snapshotAsk(
        part,
        { versions: {}, done: true, usedAt: 0 },
        snapshotVersionsAfter({}, source),
        0,
      ) === "share";
    // A finished song is a play: the Library and the graph read it, the catalog doesn't.
    assert.deepEqual(
      [kept(library, "plays"), kept(catalog, "plays"), kept(graph, "plays")],
      [false, true, false],
    );
    // A harvest batch grows the catalog, which the graph is derived from too.
    assert.deepEqual(
      [kept(library, "catalog"), kept(catalog, "catalog"), kept(graph, "catalog")],
      [true, false, false],
    );
    // A saved artist page's similar artists reach the graph only.
    assert.deepEqual(
      [kept(library, "similar"), kept(catalog, "similar"), kept(graph, "similar")],
      [true, true, false],
    );
    // Scan changes reach the Library and the graph's play history.
    assert.deepEqual(
      [kept(library, "tracks"), kept(catalog, "tracks"), kept(graph, "tracks")],
      [false, true, false],
    );
    for (const source of ["playlists", "streamed"] as const)
      assert.deepEqual([kept(library, source), kept(graph, source)], [false, true]);
    for (const source of ["favorites", "folders"] as const)
      assert.deepEqual(
        [kept(library, source), kept(catalog, source), kept(graph, source)],
        [true, true, true],
      );
  });

  test("the Library and the catalog are read again once nobody asked for them for a minute; the graph is kept", () => {
    const done = { versions: {}, done: true, usedAt: 10_000 };
    assert.equal(snapshotAsk(library, done, {}, 70_000), "share");
    assert.equal(snapshotAsk(library, done, {}, 70_001), "read");
    assert.equal(snapshotAsk(catalog, done, {}, 70_001), "read");
    assert.equal(snapshotAsk(graph, done, {}, 10 * 60 * 60_000), "share");
  });

  test("a read under way is never given up for being old", () => {
    assert.equal(
      snapshotAsk(library, { versions: {}, done: false, usedAt: 0 }, {}, 10 * 60_000),
      "share",
    );
  });
});
