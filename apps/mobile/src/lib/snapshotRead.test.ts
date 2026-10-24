/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { RECOMMENDATION_SNAPSHOT, snapshotVersionsAfter, type SnapshotVersions } from "@wave/core";
import * as Effect from "effect/Effect";

import { snapshotRead } from "./snapshotRead.ts";

/** A read the test finishes by hand: each start counts, and `finish` answers the oldest one under way. */
const gatedRead = () => {
  const started: number[] = [];
  const open: ((value: number) => void)[] = [];
  const aborted: number[] = [];
  const read = Effect.callback<number>((resume, signal) => {
    const n = started.length + 1;
    started.push(n);
    open.push((value) => resume(Effect.succeed(value)));
    signal.addEventListener("abort", () => aborted.push(n));
  });
  return {
    read,
    started,
    aborted,
    finish: (value: number) => open.shift()!(value),
  };
};

const sources = () => {
  let versions: SnapshotVersions = {};
  return {
    versions: () => versions,
    write: (source: "catalog" | "plays" | "favorites") => {
      versions = snapshotVersionsAfter(versions, source);
    },
  };
};

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

describe("a snapshot read", () => {
  test("a harvest batch written while the catalog is read doesn't restart it; whoever asks after it gets the next read", async () => {
    const gate = gatedRead();
    const writes = sources();
    const catalog = snapshotRead(gate.read, {
      part: RECOMMENDATION_SNAPSHOT.catalog,
      versions: writes.versions,
    });
    const mixes = Effect.runPromise(catalog.get);
    await turn();
    writes.write("catalog");
    const radio = Effect.runPromise(catalog.get);
    const suggestions = Effect.runPromise(catalog.get);
    await turn();
    assert.deepEqual(gate.started, [1], "the next read waits for the one under way");
    gate.finish(1);
    assert.equal(await mixes, 1, "the read under way answers those who asked before the write");
    await turn();
    assert.deepEqual(gate.started, [1, 2]);
    gate.finish(2);
    assert.deepEqual([await radio, await suggestions], [2, 2]);
    assert.deepEqual(gate.aborted, [], "no read was cancelled");
    catalog.dispose();
  });

  test("a finished song doesn't reach the catalog: everyone after it still shares the one read", async () => {
    const gate = gatedRead();
    const writes = sources();
    const catalog = snapshotRead(gate.read, {
      part: RECOMMENDATION_SNAPSHOT.catalog,
      versions: writes.versions,
    });
    const first = Effect.runPromise(catalog.get);
    await turn();
    writes.write("plays");
    writes.write("favorites");
    const second = Effect.runPromise(catalog.get);
    gate.finish(1);
    assert.deepEqual([await first, await second, await Effect.runPromise(catalog.get)], [1, 1, 1]);
    assert.deepEqual(gate.started, [1]);
    catalog.dispose();
  });

  test("a read every waiter gave up on is cancelled, and the next ask reads again", async () => {
    const gate = gatedRead();
    const catalog = snapshotRead(gate.read, {
      part: RECOMMENDATION_SNAPSHOT.catalog,
      versions: () => ({}),
    });
    const controller = new AbortController();
    const given = Effect.runPromise(catalog.get, { signal: controller.signal }).catch(
      () => "gave up",
    );
    await turn();
    controller.abort();
    assert.equal(await given, "gave up");
    assert.deepEqual(gate.aborted, [1]);
    const again = Effect.runPromise(catalog.get);
    await turn();
    gate.finish(0); // the cancelled read's slot
    gate.finish(2);
    assert.equal(await again, 2);
    catalog.dispose();
  });

  test("a failed read fails its waiters and isn't kept", async () => {
    let reads = 0;
    const catalog = snapshotRead(
      Effect.suspend(() =>
        ++reads === 1 ? Effect.fail(new Error("disk")) : Effect.succeed(reads),
      ),
      { part: RECOMMENDATION_SNAPSHOT.catalog, versions: () => ({}) },
    );
    await assert.rejects(Effect.runPromise(catalog.get));
    assert.equal(await Effect.runPromise(catalog.get), 2);
    catalog.dispose();
  });

  test("dispose releases whoever waits", async () => {
    const gate = gatedRead();
    const catalog = snapshotRead(gate.read, {
      part: RECOMMENDATION_SNAPSHOT.catalog,
      versions: () => ({}),
    });
    const waiting = Effect.runPromise(catalog.get);
    await turn();
    catalog.dispose();
    await assert.rejects(waiting);
    await assert.rejects(Effect.runPromise(catalog.get));
  });

  test("dispose cancels a read under way and the one queued after it, releasing both of their waiters", async () => {
    const gate = gatedRead();
    const writes = sources();
    const catalog = snapshotRead(gate.read, {
      part: RECOMMENDATION_SNAPSHOT.catalog,
      versions: writes.versions,
    });
    const mixes = Effect.runPromise(catalog.get);
    await turn();
    writes.write("catalog");
    const radio = Effect.runPromise(catalog.get);
    await turn();
    catalog.dispose();
    const settled = await Promise.race([
      Promise.allSettled([mixes, radio]),
      turn()
        .then(turn)
        .then(() => "still waiting" as const),
    ]);
    assert.notEqual(settled, "still waiting", "dispose releases every waiter");
    assert.deepEqual(
      (settled as PromiseSettledResult<number>[]).map(({ status }) => status),
      ["rejected", "rejected"],
    );
    assert.deepEqual(gate.aborted, [1], "the read under way is cancelled");
    assert.deepEqual(gate.started, [1], "the queued read never starts");
  });
});
