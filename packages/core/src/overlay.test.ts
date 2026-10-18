import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { cardContentHeight, cardKeyboard, entryDivider, placeOverlayCard } from "./index.ts";

// A phone in portrait, in dp: status bar on top, gesture bar below.
const phone = {
  window: { width: 412, height: 915 },
  insets: { top: 32, bottom: 24, left: 0, right: 0 },
  margin: 24,
  maxWidth: 480,
};

describe("placeOverlayCard", () => {
  test("a short card floats in the middle of the screen, a margin in from each side", () => {
    assert.deepEqual(placeOverlayCard({ ...phone, cardHeight: 300 }), {
      left: 24,
      top: 312,
      width: 364,
      maxHeight: 811,
      flow: "down",
    });
  });

  test("a card taller than the screen stops a margin short of both system bars", () => {
    const frame = placeOverlayCard({ ...phone, cardHeight: 2000 });
    assert.equal(frame.top, 56);
    assert.equal(frame.maxHeight, 811);
  });

  test("on a wide screen the card keeps its maximum width, centred clear of a side cutout", () => {
    const frame = placeOverlayCard({
      ...phone,
      window: { width: 915, height: 412 },
      insets: { top: 24, bottom: 0, left: 32, right: 0 },
      cardHeight: 200,
    });
    assert.deepEqual(frame, { left: 234, top: 118, width: 480, maxHeight: 340, flow: "down" });
  });

  test("a card someone types into sits a margin below the status bar, whatever its height", () => {
    assert.deepEqual(placeOverlayCard({ ...phone, cardHeight: 200, align: "top" }), {
      left: 24,
      top: 56,
      width: 364,
      maxHeight: 811,
      flow: "down",
    });
  });

  test("an open keyboard shortens the card so the keyboard never covers it", () => {
    // 300dp of keyboard above the 24dp gesture bar: 915 - 32 - 24 - 300 - 2 × 24.
    const frame = placeOverlayCard({ ...phone, cardHeight: 200, align: "top", keyboard: 300 });
    assert.deepEqual(frame, { left: 24, top: 56, width: 364, maxHeight: 511, flow: "down" });
  });

  test("a centred card centres in the space above an open keyboard", () => {
    // Space from 32 to 915 - 24 - 300 = 591, so a 200dp card starts at 32 + (559 - 200) / 2.
    const frame = placeOverlayCard({ ...phone, cardHeight: 200, keyboard: 300 });
    assert.equal(frame.top, 212);
  });
});

// A full-width row, 56 dp tall, and a menu kept 8 dp from it.
const near = (top: number) => ({ rect: { top, bottom: top + 56, left: 0, right: 412 }, gap: 8 });

// An album tile on a tablet.
const tile = (left: number, right: number) => ({
  rect: { top: 100, bottom: 400, left, right },
  gap: 8,
});

describe("placeOverlayCard next to an anchor", () => {
  test("a menu opens just below the long-pressed row when it fits there", () => {
    assert.deepEqual(placeOverlayCard({ ...phone, cardHeight: 400, anchor: near(200) }), {
      left: 24,
      top: 264,
      width: 364,
      // The room below the row: content scrolls rather than run past it.
      maxHeight: 603,
      side: "below",
      flow: "down",
    });
  });

  test("a row near the bottom gets its menu above it instead", () => {
    const frame = placeOverlayCard({ ...phone, cardHeight: 400, anchor: near(600) });
    assert.equal(frame.side, "above");
    assert.equal(frame.top, 192);
  });

  test("a menu under a row near the bottom opens below it, over the mini player and tab bar", () => {
    // The floating chrome (tab bar and mini player, 755 to 891 dp) is no bottom edge: only the
    // gesture bar is. A 100 dp card fits between the row's foot (756 + 8) and 915 - 24 - 24.
    const frame = placeOverlayCard({ ...phone, cardHeight: 100, anchor: near(700) });
    assert.deepEqual([frame.side, frame.top, frame.maxHeight], ["below", 764, 103]);
  });

  test("a menu too tall for either side shrinks to fit the roomier side and scrolls", () => {
    const lower = placeOverlayCard({ ...phone, cardHeight: 600, anchor: near(400) });
    assert.deepEqual([lower.side, lower.top, lower.maxHeight], ["below", 464, 403]);
    const higher = placeOverlayCard({ ...phone, cardHeight: 600, anchor: near(500) });
    assert.deepEqual([higher.side, higher.top, higher.maxHeight], ["above", 56, 436]);
  });

  test("a menu shrinks beside its anchor only down to the anchor's least height", () => {
    // A tall tile leaves 159 dp below it and 236 dp above.
    const rect = { top: 300, bottom: 700, left: 0, right: 412 };
    const roomy = placeOverlayCard({
      ...phone,
      cardHeight: 600,
      anchor: { rect, gap: 8, minHeight: 200 },
    });
    assert.deepEqual([roomy.side, roomy.top, roomy.maxHeight], ["above", 56, 236]);
    // Too little room on either side: the card covers the tile rather than shrink further.
    const cramped = placeOverlayCard({
      ...phone,
      cardHeight: 600,
      anchor: { rect, gap: 8, minHeight: 240 },
    });
    assert.deepEqual([cramped.side, cramped.top, cramped.maxHeight], ["above", 56, 811]);
  });

  test("with larger text a menu needs more room beside its anchor before it covers it", () => {
    // The same tall tile: 159 dp below it, 236 dp above. Its heading and entries take
    // twice the room at twice the text size, so 160 dp of them becomes 320.
    const rect = { top: 300, bottom: 700, left: 0, right: 412 };
    const anchor = { rect, gap: 8, minHeight: 160 };
    const usual = placeOverlayCard({ ...phone, cardHeight: 600, anchor, textScale: 1 });
    assert.deepEqual([usual.side, usual.top, usual.maxHeight], ["above", 56, 236]);
    const large = placeOverlayCard({ ...phone, cardHeight: 600, anchor, textScale: 2 });
    assert.deepEqual([large.side, large.top, large.maxHeight], ["above", 56, 811]);
    // Smaller text never lets the menu shrink below the anchor's least height.
    const small = placeOverlayCard({
      ...phone,
      cardHeight: 600,
      anchor: { ...anchor, minHeight: 240 },
      textScale: 0.85,
    });
    assert.equal(small.maxHeight, 811);
  });

  test("a card opened from the tab bar draws over the mini player, clear of the status bar", () => {
    // The tab bar's editor, from a long press on a tab: the bar (64 dp) sits a cell above
    // the gesture bar. The card may run from a gap above the tab (819 - 8 = 811) to a margin
    // below the status bar (56): 755 dp, its rows scrolling and Done showing at its foot.
    const tab = { rect: { top: 819, bottom: 883, left: 24, right: 106 }, gap: 8, minHeight: 160 };
    const tall = placeOverlayCard({ ...phone, cardHeight: 900, anchor: tab });
    assert.deepEqual(tall, {
      left: 24,
      top: 56,
      width: 364,
      maxHeight: 755,
      side: "above",
      flow: "up",
    });
    // A card that fits sits just above the tab, over the mini player.
    const short = placeOverlayCard({ ...phone, cardHeight: 400, anchor: tab });
    assert.deepEqual([short.top, short.maxHeight], [411, 755]);
  });

  test("a menu from a row scrolled up under the status bar stays a margin below the bar", () => {
    // Only the row's last 8 dp show under the 32 dp status bar.
    const frame = placeOverlayCard({ ...phone, cardHeight: 900, anchor: near(-16) });
    assert.deepEqual([frame.side, frame.top, frame.maxHeight], ["below", 56, 811]);
  });

  test("on a wide screen the menu centres under the album tile, kept a margin inside the edges", () => {
    const tablet = { ...phone, window: { width: 1000, height: 1400 }, cardHeight: 300 };
    assert.equal(placeOverlayCard({ ...tablet, anchor: tile(360, 840) }).left, 360);
    assert.equal(placeOverlayCard({ ...tablet, anchor: tile(520, 980) }).left, 496);
    assert.equal(placeOverlayCard({ ...tablet, anchor: tile(20, 480) }).left, 24);
  });
});

describe("which way a card's entries run", () => {
  test("a menu below its row lists its entries downwards, the first one nearest the finger", () => {
    assert.equal(placeOverlayCard({ ...phone, cardHeight: 400, anchor: near(200) }).flow, "down");
  });

  test("a menu above its row lists its entries upwards, so the first one sits next to the row", () => {
    assert.equal(placeOverlayCard({ ...phone, cardHeight: 400, anchor: near(600) }).flow, "up");
  });

  test("a centred card, opened without a finger on a row, lists its entries downwards", () => {
    assert.equal(placeOverlayCard({ ...phone, cardHeight: 400 }).flow, "down");
  });
});

describe("entryDivider", () => {
  test("entries listed downwards have a hairline under each one but the last", () => {
    const lines = [0, 1, 2].map((index) => entryDivider(index, 3, "down"));
    assert.deepEqual(lines, [true, true, false]);
  });

  test("entries listed upwards end at the first one, which goes without a hairline", () => {
    const lines = [0, 1, 2].map((index) => entryDivider(index, 3, "up"));
    assert.deepEqual(lines, [false, true, true]);
  });
});

describe("cardKeyboard", () => {
  test("a card nobody types into closes an open keyboard and lays out as if it were gone", () => {
    assert.deepEqual(cardKeyboard({ keyboard: 320 }), { closeKeyboard: true, keyboard: 0 });
  });

  test("a card someone types into keeps the keyboard and stays clear of it", () => {
    assert.deepEqual(cardKeyboard({ align: "top", keyboard: 320 }), {
      closeKeyboard: false,
      keyboard: 320,
    });
  });

  test("with the keyboard closed there is nothing to close", () => {
    assert.deepEqual(cardKeyboard({ keyboard: 0 }), { closeKeyboard: false, keyboard: 0 });
  });
});

describe("cardContentHeight", () => {
  test("a layout shorter than the card's limit is its content's height", () => {
    assert.equal(cardContentHeight({ known: 300, laidOut: 250, maxHeight: 800 }), 250);
  });

  test("a layout cut short by the limit keeps the taller content height measured before", () => {
    assert.equal(cardContentHeight({ known: 1200, laidOut: 800, maxHeight: 800 }), 1200);
  });

  test("content that grows into the limit is at least as tall as the limit", () => {
    assert.equal(cardContentHeight({ known: 500, laidOut: 800, maxHeight: 800 }), 800);
  });

  test("a layout within a pixel of the limit counts as cut short", () => {
    assert.equal(cardContentHeight({ known: 1200, laidOut: 799.5, maxHeight: 800 }), 1200);
  });
});
