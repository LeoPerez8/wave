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

  test("a page forgotten is read again on its next opening, and frees its place", () => {
    const pages = knownPages<string>(2);
    pages.set("A", "a");
    pages.set("B", "b");
    pages.forget("A");
    assert.equal(pages.get("A"), undefined);
    pages.set("C", "c");
    assert.equal(pages.get("B"), "b");
    assert.equal(pages.get("C"), "c");
    pages.forget("missing");
  });

  test("it holds at most its bound, however many pages are read (Performance rules, 12)", () => {
    const pages = knownPages<number>(3);
    for (let i = 0; i < 1000; i += 1) pages.set(`page ${i}`, i);
    assert.equal(pages.size(), 3);
    assert.equal(pages.get("page 999"), 999);
    assert.equal(pages.get("page 996"), undefined);
  });
});
