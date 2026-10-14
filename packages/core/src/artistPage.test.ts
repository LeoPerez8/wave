import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { artistPageItems } from "./index.ts";

describe("artistPageItems", () => {
  test("each shelf is its heading then one row of all its covers, and the songs follow", () => {
    const items = artistPageItems(
      [
        { label: "Albums", covers: ["a1", "a2", "a3", "a4", "a5"] },
        { label: "Singles & EPs", covers: ["s1", "s2", "s3"] },
        { label: "Appears on", covers: ["x1"] },
      ],
      ["t1", "t2"],
    );
    assert.deepEqual(items, [
      { type: "section", label: "Albums" },
      { type: "shelf", label: "Albums", covers: ["a1", "a2", "a3", "a4", "a5"] },
      { type: "section", label: "Singles & EPs" },
      { type: "shelf", label: "Singles & EPs", covers: ["s1", "s2", "s3"] },
      { type: "section", label: "Appears on" },
      { type: "shelf", label: "Appears on", covers: ["x1"] },
      { type: "section", label: "Songs" },
      { type: "song", song: "t1", index: 0 },
      { type: "song", song: "t2", index: 1 },
    ]);
  });

  test("a shelf with nothing in it is left out, heading and all", () => {
    const items = artistPageItems(
      [
        { label: "Albums", covers: [] },
        { label: "Singles & EPs", covers: ["s1"] },
        { label: "Appears on", covers: [] },
      ],
      ["t1"],
    );
    assert.deepEqual(items, [
      { type: "section", label: "Singles & EPs" },
      { type: "shelf", label: "Singles & EPs", covers: ["s1"] },
      { type: "section", label: "Songs" },
      { type: "song", song: "t1", index: 0 },
    ]);
  });

  test("with no songs there's no Songs heading", () => {
    assert.deepEqual(artistPageItems([{ label: "Albums", covers: ["a1"] }], []), [
      { type: "section", label: "Albums" },
      { type: "shelf", label: "Albums", covers: ["a1"] },
    ]);
  });
});
