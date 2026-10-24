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
    const { place } = upNextScroll();
    const { scroller, asked } = list(0);
    place(scroller, songs, 300);
    assert.deepEqual(asked, []);
  });

  test("each showing opens at the start of Up Next, through the list", () => {
    const { place, hide } = upNextScroll();
    const { scroller, asked } = list(900);
    place(scroller, songs, 300);
    hide();
    place(scroller, songs, 300);
    hide();
    place(scroller, songs, 356);
    assert.deepEqual(asked, [
      { offset: 300, animated: false },
      { offset: 356, animated: false },
    ]);
  });

  test("a new play while Up Next shows starts it at its start", () => {
    const { place } = upNextScroll();
    const { scroller, asked } = list(900);
    place(scroller, songs, 300);
    place(scroller, album, 0);
    assert.deepEqual(asked, [{ offset: 0, animated: false }]);
  });

  test("sitting at the start of Up Next, it stays there as History grows or empties", () => {
    const { place } = upNextScroll();
    const { scroller, asked } = list(300);
    place(scroller, songs, 300);
    place(scroller, songs, 356);
    assert.deepEqual(asked, [{ offset: 356, animated: false }]);

    const emptied = upNextScroll();
    const shuffled = list(300);
    emptied.place(shuffled.scroller, songs, 300);
    emptied.place(shuffled.scroller, songs, 0);
    assert.deepEqual(shuffled.asked, [{ offset: 0, animated: false }]);
  });

  test("scrolled into History or down Up Next, the rows on screen hold still", () => {
    const { place } = upNextScroll();
    const history = list(120);
    place(history.scroller, songs, 300);
    place(history.scroller, songs, 356);
    assert.deepEqual(history.asked, []);

    const down = upNextScroll();
    const deep = list(900);
    down.place(deep.scroller, songs, 300);
    down.place(deep.scroller, songs, 356);
    assert.deepEqual(deep.asked, []);
  });

  test("a list mounted again is left to lay itself out", () => {
    const { place } = upNextScroll();
    const first = list(900);
    place(first.scroller, songs, 300);
    place(null, album, 0);
    const second = list(0);
    place(second.scroller, album, 0);
    assert.deepEqual([...first.asked, ...second.asked], []);
  });
});
