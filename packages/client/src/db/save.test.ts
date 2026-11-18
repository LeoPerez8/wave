/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { hasUnscannedRoot } from "./save.ts";
import * as schema from "./schema.ts";
import { openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

const addRoot = (path: string, lastScannedAt: number | null = null): void => {
  db.insert(schema.scanRoots).values({ path, addedAt: 1, lastScannedAt }).run();
};

beforeEach(async () => {
  db = await openTestDatabase();
});

describe("hasUnscannedRoot", () => {
  test("a folder no scan has finished yet is unscanned", () => {
    addRoot("/Music");

    assert.equal(hasUnscannedRoot(db, ["/Music"]), true);
  });

  test("folders scanned before aren't", () => {
    addRoot("/Music", 100);
    addRoot("/Podcasts", 200);

    assert.equal(hasUnscannedRoot(db, ["/Music", "/Podcasts"]), false);
  });

  test("one never-scanned folder among scanned ones is enough", () => {
    addRoot("/Music", 100);
    addRoot("/Podcasts");

    assert.equal(hasUnscannedRoot(db, ["/Music", "/Podcasts"]), true);
  });

  test("only the folders asked about count", () => {
    addRoot("/Music", 100);
    addRoot("/Podcasts");

    assert.equal(hasUnscannedRoot(db, ["/Music"]), false);
    assert.equal(hasUnscannedRoot(db, []), false);
  });

  test("a folder stops being unscanned once a scan is recorded", () => {
    addRoot("/Music");
    db.update(schema.scanRoots)
      .set({ lastScannedAt: 100 })
      .where(eq(schema.scanRoots.path, "/Music"))
      .run();

    assert.equal(hasUnscannedRoot(db, ["/Music"]), false);
  });
});
