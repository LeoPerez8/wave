/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { makeImportIndexCache } from "./importIndexCache.ts";

describe("one Library index for a batch's imports", () => {
  test("playlists read while the Library stays as it was share one index", async () => {
    let version = 1;
    let builds = 0;
    const cache = makeImportIndexCache<string>(() => version);
    const build = async () => `index ${++builds}`;
    assert.equal(await cache.current(build), "index 1");
    assert.equal(await cache.current(build), "index 1");
    version = 2;
    assert.equal(await cache.current(build), "index 2");
    assert.equal(builds, 2);
  });

  test("a Library change while the index is built makes the next playlist build again", async () => {
    let version = 1;
    let builds = 0;
    const cache = makeImportIndexCache<string>(() => version);
    const changing = async () => {
      version++;
      return `index ${++builds}`;
    };
    assert.equal(await cache.current(changing), "index 1");
    assert.equal(await cache.current(async () => `index ${++builds}`), "index 2");
  });

  test("two asking at once wait for the same build", async () => {
    let builds = 0;
    const cache = makeImportIndexCache<string>(() => 1);
    const build = async () => `index ${++builds}`;
    const [one, two] = await Promise.all([cache.current(build), cache.current(build)]);
    assert.equal(one, "index 1");
    assert.equal(two, "index 1");
  });

  test("a failed build isn't kept, and cleared it builds again", async () => {
    let builds = 0;
    const cache = makeImportIndexCache<string>(() => 1);
    await assert.rejects(cache.current(async () => Promise.reject(new Error("closed"))));
    const build = async () => `index ${++builds}`;
    assert.equal(await cache.current(build), "index 1");
    cache.clear();
    assert.equal(await cache.current(build), "index 2");
  });
});
