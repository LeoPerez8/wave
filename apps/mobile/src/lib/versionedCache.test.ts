/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { makeExternalStore } from "./externalStore.ts";
import { makeVersionedCache } from "./versionedCache.ts";

/** A build the test settles by hand, recording which version each was for. */
const manualBuilds = () => {
  const pending: { version: number; settle: (value: string | Error) => void }[] = [];
  const build = (version: number) =>
    new Promise<string>((resolve, reject) => {
      pending.push({
        version,
        settle: (value) => (value instanceof Error ? reject(value) : resolve(value)),
      });
    });
  return { pending, build };
};

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe("a value built once per version and shared", () => {
  test("builds once for every subscriber, and only once something subscribes", async () => {
    const version = makeExternalStore(1);
    const { pending, build } = manualBuilds();
    const cache = makeVersionedCache({ version, initial: "nothing", build });
    assert.equal(pending.length, 0);

    let told = 0;
    cache.subscribe(() => told++);
    cache.subscribe(() => told++);
    assert.equal(pending.length, 1);
    pending[0]?.settle("v1");
    await tick();

    assert.equal(cache.get(), "v1");
    assert.equal(told, 2);
    assert.equal(pending.length, 1);
  });

  test("a new version builds again; versions arriving mid-build wait for one more build", async () => {
    const version = makeExternalStore(1);
    const { pending, build } = manualBuilds();
    const cache = makeVersionedCache({ version, initial: "nothing", build });
    cache.subscribe(() => {});
    version.set(2);
    version.set(3);
    assert.equal(pending.length, 1);
    pending[0]?.settle("v1");
    await tick();

    assert.equal(cache.get(), "v1");
    assert.deepEqual(
      pending.map((b) => b.version),
      [1, 3],
    );
    pending[1]?.settle("v3");
    await tick();
    assert.equal(cache.get(), "v3");
    assert.equal(pending.length, 2);
  });

  test("a later subscriber gets the value already built, without a build", async () => {
    const version = makeExternalStore(1);
    const { pending, build } = manualBuilds();
    const cache = makeVersionedCache({ version, initial: "nothing", build });
    const stop = cache.subscribe(() => {});
    pending[0]?.settle("v1");
    await tick();
    stop();

    cache.subscribe(() => {});
    assert.equal(pending.length, 1);
    assert.equal(cache.get(), "v1");
  });

  test("with nobody subscribed a new version waits for the next subscriber", async () => {
    const version = makeExternalStore(1);
    const { pending, build } = manualBuilds();
    const cache = makeVersionedCache({ version, initial: "nothing", build });
    const stop = cache.subscribe(() => {});
    pending[0]?.settle("v1");
    await tick();
    stop();

    version.set(2);
    assert.equal(pending.length, 1);
    cache.subscribe(() => {});
    assert.deepEqual(
      pending.map((b) => b.version),
      [1, 2],
    );
  });

  test("a failed build keeps the last value and is tried again on the next version", async () => {
    const version = makeExternalStore(1);
    const { pending, build } = manualBuilds();
    const cache = makeVersionedCache({ version, initial: "nothing", build });
    cache.subscribe(() => {});
    pending[0]?.settle(new Error("store closed"));
    await tick();

    assert.equal(cache.get(), "nothing");
    version.set(2);
    pending[1]?.settle("v2");
    await tick();
    assert.equal(cache.get(), "v2");
  });

  test("a failed build tells the subscribers and is tried again by the next one, not before", async () => {
    const version = makeExternalStore(1);
    const { pending, build } = manualBuilds();
    const cache = makeVersionedCache({ version, initial: "nothing", build });
    let told = 0;
    cache.subscribe(() => told++);
    pending[0]?.settle(new Error("store busy"));
    await tick();

    assert.equal(told, 1);
    assert.equal(pending.length, 1);
    cache.subscribe(() => {});
    assert.deepEqual(
      pending.map((b) => b.version),
      [1, 1],
    );
    pending[1]?.settle("v1");
    await tick();
    assert.equal(cache.get(), "v1");
    cache.subscribe(() => {});
    assert.equal(pending.length, 2);
  });
});
