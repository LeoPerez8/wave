/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { upNextScroll, type UpNextScroller } from "./upNextScroll.ts";

/** A stand-in for Legend List's handle, scrolled to `scroll`, recording the scrolls asked of it. */
const list = (scroll: number) => {
  const asked: { offset: number; animated?: boolean }[] = [];
  const scroller: UpNextScroller = {
    getState: () => ({ scroll }),
    scrollToOffset: (params) => {
      asked.push(params);
    },
  };
  return { scroller, asked };
};

const songs = { kind: "songs" };
const album = { kind: "album" };

describe("upNextScroll", () => {
  test("a list showing for the first time is left to lay itself out", () => {
    const shown = upNextScroll();
    const { scroller, asked } = list(0);
    shown(scroller, songs);
    assert.deepEqual(asked, []);
  });

  test("showing after a new play starts Up Next from the top, through the list", () => {
    const shown = upNextScroll();
    const { scroller, asked } = list(900);
    shown(scroller, songs);
    shown(scroller, album);
    assert.deepEqual(asked, [{ offset: 0, animated: false }]);
  });

  test("showing again with the same play keeps its place, set again through the list", () => {
    const shown = upNextScroll();
    const { scroller, asked } = list(900);
    shown(scroller, songs);
    shown(scroller, songs);
    assert.deepEqual(asked, [{ offset: 900, animated: false }]);
  });

  test("a play undone before Up Next shows again keeps its place", () => {
    const shown = upNextScroll();
    const { scroller, asked } = list(900);
    shown(scroller, songs);
    // Out of sight: album plays, then New queue playing's Undo brings songs back.
    shown(scroller, songs);
    assert.deepEqual(asked, [{ offset: 900, animated: false }]);
  });

  test("an Undo while Up Next shows starts the restored queue from the top", () => {
    const shown = upNextScroll();
    const { scroller, asked } = list(900);
    shown(scroller, songs);
    shown(scroller, album);
    shown(scroller, songs);
    assert.deepEqual(asked, [
      { offset: 0, animated: false },
      { offset: 0, animated: false },
    ]);
  });

  test("a list mounted again (Up Next emptied, then refilled) is left to lay itself out", () => {
    const shown = upNextScroll();
    const first = list(900);
    shown(first.scroller, songs);
    shown(null, album);
    const second = list(0);
    shown(second.scroller, album);
    assert.deepEqual([...first.asked, ...second.asked], []);
  });
});
