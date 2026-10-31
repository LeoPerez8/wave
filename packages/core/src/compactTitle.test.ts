import assert from "node:assert/strict";
import { test } from "node:test";

import { compactTitleScroll, compactTitleShown } from "./index.ts";

test("the compact title waits until the large title has fully scrolled away", () => {
  const titleBottom = 400;
  assert.equal(compactTitleShown({ scroll: 399, titleBottom, querying: false }), false);
  assert.equal(compactTitleShown({ scroll: 400, titleBottom, querying: false }), true);
});

test("it hides again when the large title comes back", () => {
  assert.equal(compactTitleShown({ scroll: 120, titleBottom: 400, querying: false }), false);
});

test("a title not measured yet shows nothing, however far the list is", () => {
  const titleBottom = Number.POSITIVE_INFINITY;
  assert.equal(compactTitleShown({ scroll: 5000, titleBottom, querying: false }), false);
});

test("a Find query names the page wherever the list is, the head having stepped aside", () => {
  assert.equal(compactTitleShown({ scroll: 0, titleBottom: 400, querying: true }), true);
  const unmeasured = Number.POSITIVE_INFINITY;
  assert.equal(compactTitleShown({ scroll: 0, titleBottom: unmeasured, querying: true }), true);
});

const away = { listHeight: 600, reduceMotion: false, querying: false };

test("a tap near the top scrolls, animated, to where the list opens", () => {
  assert.deepEqual(compactTitleScroll({ ...away, scroll: 900, openingOffset: 56 }), {
    jumpTo: null,
    offset: 56,
    animated: true,
  });
});

test("a tap on a pinned field's list, or a list with no field, goes to its very top", () => {
  assert.equal(compactTitleScroll({ ...away, scroll: 900, openingOffset: 0 }).offset, 0);
});

test("far down a long list it jumps close first, then animates the last stretch", () => {
  assert.deepEqual(compactTitleScroll({ ...away, scroll: 180_000, openingOffset: 56 }), {
    jumpTo: 1256,
    offset: 56,
    animated: true,
  });
});

test("during a query it goes to the top of the results, field and query in view", () => {
  const going = compactTitleScroll({ ...away, querying: true, scroll: 900, openingOffset: 56 });
  assert.equal(going.offset, 0);
});

test("under reduce motion it jumps, however near", () => {
  assert.deepEqual(
    compactTitleScroll({ ...away, reduceMotion: true, scroll: 300, openingOffset: 56 }),
    { jumpTo: null, offset: 56, animated: false },
  );
  assert.deepEqual(
    compactTitleScroll({ ...away, reduceMotion: true, scroll: 180_000, openingOffset: 56 }),
    { jumpTo: null, offset: 56, animated: false },
  );
});
