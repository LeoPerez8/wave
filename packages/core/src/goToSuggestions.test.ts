import assert from "node:assert/strict";
import { test } from "node:test";

import {
  goToSuggestionsOffered,
  goToSuggestionsScroll,
  playlistSuggestionsPlace,
  type PlaylistRecommendationSlot,
} from "./index.ts";

const list = { scroll: 0, listHeight: 800, bottomInset: 100 };

test("a section below the list's visible part is away, the moment the playlist opens too", () => {
  assert.equal(playlistSuggestionsPlace({ ...list, top: 5000 }), "away");
  assert.equal(playlistSuggestionsPlace({ ...list, top: 700 }), "away");
});

test("a section reaching above the floating chrome is in sight, however far past it the list is", () => {
  assert.equal(playlistSuggestionsPlace({ ...list, top: 699 }), "inSight");
  assert.equal(playlistSuggestionsPlace({ ...list, scroll: 4301, top: 5000 }), "inSight");
  assert.equal(playlistSuggestionsPlace({ ...list, scroll: 9000, top: 5000 }), "inSight");
});

test("a playlist that fits on screen has the section in sight, never away", () => {
  assert.equal(playlistSuggestionsPlace({ ...list, top: 300 }), "inSight");
});

test("a list not laid out yet, or with no section, has no place to go", () => {
  assert.equal(playlistSuggestionsPlace({ ...list, listHeight: 0, top: 300 }), "unknown");
  assert.equal(playlistSuggestionsPlace({ ...list, top: Number.POSITIVE_INFINITY }), "unknown");
});

const session = {
  slots: [null, null, null, null, null],
  loading: false,
  pending: [],
  pendingSlots: [],
  unfilled: [],
  error: null,
} as const;
const offer = { key: "a" } as unknown as PlaylistRecommendationSlot;

test("the pill has somewhere to go while the section loads, fails or holds offers", () => {
  assert.equal(goToSuggestionsOffered({ ...session, loading: true }), true);
  assert.equal(goToSuggestionsOffered({ ...session, error: "load" }), true);
  assert.equal(goToSuggestionsOffered({ ...session, slots: [offer, null] }), true);
});

test("a slot still being replaced, or waiting for a retry, keeps the pill", () => {
  assert.equal(goToSuggestionsOffered({ ...session, pendingSlots: [2] }), true);
  assert.equal(goToSuggestionsOffered({ ...session, unfilled: [2] }), true);
});

test("with no offers left and nothing loading the pill has nowhere to go", () => {
  assert.equal(goToSuggestionsOffered(session), false);
  assert.equal(goToSuggestionsOffered({ ...session, slots: [] }), false);
});

test("a tap puts the section's top at the list's top", () => {
  const going = goToSuggestionsScroll({
    top: 1400,
    scroll: 0,
    listHeight: 800,
    reduceMotion: false,
  });
  assert.equal(going.offset, 1400);
});

test("up to two screens of travel animates; further jumps straight there", () => {
  const from = (scroll: number) =>
    goToSuggestionsScroll({ top: 5000, scroll, listHeight: 800, reduceMotion: false }).animated;
  assert.equal(from(3400), true, "exactly two screens");
  assert.equal(from(3399), false);
  assert.equal(from(0), false);
});

test("under reduce motion a tap always jumps", () => {
  const near = goToSuggestionsScroll({ top: 900, scroll: 0, listHeight: 800, reduceMotion: true });
  assert.deepEqual(near, { offset: 900, animated: false });
});
