import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { knownPages } from "./index.ts";

describe("knownPages", () => {
  test("a page read this session is known on its next opening", () => {
    const pages = knownPages<string>(4);
    assert.equal(pages.get("yt-album/A"), undefined);
    pages.set("yt-album/A", "album A");
    assert.equal(pages.get("yt-album/A"), "album A");
  });

  test("past its bound it forgets the page opened longest ago", () => {
    const pages = knownPages<string>(2);
    pages.set("A", "a");
    pages.set("B", "b");
    // Opening A again makes B the one opened longest ago.
    assert.equal(pages.get("A"), "a");
    pages.set("C", "c");
    assert.equal(pages.get("B"), undefined);
    assert.equal(pages.get("A"), "a");
    assert.equal(pages.get("C"), "c");
  });

  test("a page read again replaces what was kept, without taking another place", () => {
    const pages = knownPages<string>(2);
    pages.set("A", "old");
    pages.set("B", "b");
    pages.set("A", "new");
    assert.equal(pages.get("A"), "new");
    assert.equal(pages.get("B"), "b");
  });
});
