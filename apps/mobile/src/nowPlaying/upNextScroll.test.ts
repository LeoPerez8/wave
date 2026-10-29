/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  backToCurrentSong,
  upNextEndSpace,
  upNextScroll,
  type UpNextScroller,
} from "./upNextScroll.ts";

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

  test("a shuffle toggle while Up Next shows starts it at its start, from wherever it was", () => {
    for (const scroll of [120, 300, 900]) {
      const { place } = upNextScroll();
      const { scroller, asked } = list(scroll);
      place(scroller, songs, 300, "off");
      place(scroller, songs, 300, "on");
      assert.deepEqual(asked, [{ offset: 300, animated: false }], `scrolled to ${scroll}`);
    }
  });

  test("each reshuffle while Up Next shows starts it at its start, the same kind picked again too", () => {
    const { place } = upNextScroll();
    const { scroller, asked } = list(900);
    place(scroller, songs, 300, 1);
    place(scroller, songs, 300, 2);
    place(scroller, songs, 300, 3);
    assert.deepEqual(asked, [
      { offset: 300, animated: false },
      { offset: 300, animated: false },
    ]);
  });

  test("with no reshuffle, scrolled down Up Next, the rows on screen hold still", () => {
    const { place } = upNextScroll();
    const { scroller, asked } = list(900);
    place(scroller, songs, 300, 4);
    place(scroller, songs, 300, 4);
    assert.deepEqual(asked, []);
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

describe("upNextEndSpace", () => {
  // A 600 dp list, a 60 dp bar, 50 dp rows, 40 dp of bottom inset.
  const sizes = { bar: 60, row: 50, bottomInset: 40 };

  test("a short Up Next gets the room that lets its start reach the top", () => {
    // 600 - (60 + 3 × 50 + 40) = 350
    assert.equal(upNextEndSpace(600, { ...sizes, count: 3 }), 350);
  });

  test("an empty Up Next leaves the bar at the top over the room under it", () => {
    assert.equal(upNextEndSpace(600, { ...sizes, count: 0 }), 500);
  });

  test("an Up Next filling the list, or far longer than it, needs none", () => {
    assert.equal(upNextEndSpace(600, { ...sizes, count: 10 }), 0);
    assert.equal(upNextEndSpace(600, { ...sizes, count: 2545 }), 0);
  });

  test("a list not laid out yet needs none", () => {
    assert.equal(upNextEndSpace(0, { ...sizes, count: 3 }), 0);
  });
});

describe("backToCurrentSong", () => {
  // Up Next starts 300 dp down a 600 dp list.
  const start = 300;
  const height = 600;

  test("scrolled into History, the pill points down to Up Next", () => {
    assert.equal(backToCurrentSong(120, start, height), "down");
    assert.equal(backToCurrentSong(0, start, height), "down");
  });

  test("more than one screen down Up Next, it points up to its start", () => {
    assert.equal(backToCurrentSong(901, start, height), "up");
    assert.equal(backToCurrentSong(5000, start, height), "up");
  });

  test("at the start of Up Next, or less than a screen down it, there's no pill", () => {
    assert.equal(backToCurrentSong(300, start, height), null);
    assert.equal(backToCurrentSong(299.5, start, height), null);
    assert.equal(backToCurrentSong(600, start, height), null);
    assert.equal(backToCurrentSong(900, start, height), null);
  });

  test("a list not laid out yet shows none", () => {
    assert.equal(backToCurrentSong(120, start, 0), null);
    assert.equal(backToCurrentSong(5000, start, 0), null);
  });

  test("a showing waits for its placement while the scroll is still the one from before", () => {
    // Hidden at the old start of Up Next (300); 3 songs later it starts 168 dp lower.
    assert.equal(backToCurrentSong(300, 468, height, 300), null);
    // Hidden deep in Up Next, or up in History.
    assert.equal(backToCurrentSong(5000, start, height, 5000), null);
    assert.equal(backToCurrentSong(120, start, height, 120), null);
  });

  test("once the list reports another scroll, the pill follows it", () => {
    assert.equal(backToCurrentSong(468, 468, height, 300), null);
    assert.equal(backToCurrentSong(120, start, height, 5000), "down");
    assert.equal(backToCurrentSong(5000, start, height, 120), "up");
    assert.equal(backToCurrentSong(120, start, height, null), "down");
  });
});
