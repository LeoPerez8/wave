import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  findFieldPlacement,
  findScrollOnPin,
  readKeepFindVisible,
  storedKeepFindVisible,
} from "./index.ts";

describe("Keep Find Field Visible, as stored", () => {
  test("is off when nothing is stored", () => {
    assert.equal(readKeepFindVisible(null), false);
  });

  test("is on only for what turning it on stores", () => {
    assert.equal(readKeepFindVisible(storedKeepFindVisible(true)), true);
    for (const stored of ["", "off", "true", "1", "ON", "yes"])
      assert.equal(readKeepFindVisible(stored), false, stored);
  });

  test("stores nothing when off, so it reads back (and syncs) as the default", () => {
    assert.equal(storedKeepFindVisible(false), null);
    assert.equal(readKeepFindVisible(storedKeepFindVisible(false)), false);
  });
});

describe("findFieldPlacement", () => {
  const field = 68;
  const viewport = 800;

  test("off: the list opens scrolled past the field and can always scroll it out of sight", () => {
    assert.deepEqual(
      findFieldPlacement({ pinned: false, fieldHeight: field, viewportHeight: viewport }),
      { initialOffset: field, minHeight: viewport + field },
    );
  });

  test("pinned: the list opens at its top and is as tall as its rows", () => {
    assert.deepEqual(
      findFieldPlacement({ pinned: true, fieldHeight: field, viewportHeight: viewport }),
      { initialOffset: 0, minHeight: undefined },
    );
  });
});

describe("findScrollOnPin", () => {
  const field = 68;

  test("pinning takes the field out of the list: the rows stay where they were", () => {
    assert.equal(findScrollOnPin(500, field, true), 500 - field);
  });

  test("pinning a list scrolled just past its field shows its top, field above it", () => {
    assert.equal(findScrollOnPin(field, field, true), 0);
  });

  test("pinning a list showing part of its field lands on its top", () => {
    assert.equal(findScrollOnPin(20, field, true), 0);
    assert.equal(findScrollOnPin(0, field, true), 0);
  });

  test("unpinning puts the field back in the list, above the rows on screen", () => {
    assert.equal(findScrollOnPin(0, field, false), field);
    assert.equal(findScrollOnPin(432, field, false), 500);
  });
});
