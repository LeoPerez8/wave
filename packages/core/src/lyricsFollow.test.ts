import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lyricsFollowStart,
  lyricsFollowStep,
  type LyricsFollow,
  type LyricsFollowEvent,
} from "./index.ts";

const off = lyricsFollowStart({ karaoke: false, picking: false });
const on = lyricsFollowStart({ karaoke: true, picking: false });

/** The lyrics once they've opened: the sung line was placed. */
const opened = (start: LyricsFollow): LyricsFollow =>
  lyricsFollowStep(lyricsFollowStep(start, "laidOut").state, "placed").state;

/** How the lyrics move on the last of [events]. */
const lastMove = (start: LyricsFollow, ...events: readonly LyricsFollowEvent[]) => {
  let state = start;
  let move = "stay";
  for (const event of events) ({ state, move } = lyricsFollowStep(state, event));
  return move;
};

test("opening places the sung line without a slide, Karaoke on or off", () => {
  assert.equal(lastMove(off, "laidOut"), "place");
  assert.equal(lastMove(on, "laidOut"), "place");
});

test("with Karaoke off, a layout before the line could be placed still places it", () => {
  // The first layout had no room to scroll, so nothing reported "placed".
  assert.equal(lastMove(off, "laidOut", "laidOut"), "place");
});

test("with Karaoke off, a later layout change doesn't bring the sung line back", () => {
  assert.equal(lastMove(opened(off), "laidOut"), "stay");
});

test("with Karaoke off, the lyrics don't follow the song", () => {
  assert.equal(lastMove(opened(off), "lineChanged"), "stay");
});

test("with Karaoke off, tapping a line leaves the lyrics where they are", () => {
  assert.equal(lastMove(opened(off), "lineTapped"), "stay");
  assert.equal(lastMove(opened(off), "lineTapped", "lineChanged"), "stay");
});

test("with Karaoke off, scrolling by hand doesn't snap back", () => {
  assert.equal(lastMove(opened(off), "fingerDown", "resumeDue"), "stay");
  assert.equal(lastMove(opened(off), "fingerDown", "resumeDue", "lineChanged"), "stay");
});

test("with Karaoke off, finishing a share pick doesn't jump to the sung line", () => {
  assert.equal(lastMove(opened(off), "pickStarted", "pickEnded"), "stay");
  assert.equal(lastMove(opened(off), "pickStarted", "pickEnded", "lineChanged"), "stay");
});

test("with Karaoke on, the lyrics follow the song and hold every layout in place", () => {
  assert.equal(lastMove(opened(on), "lineChanged"), "slide");
  assert.equal(lastMove(opened(on), "laidOut"), "place");
});

test("with Karaoke on, a tapped line slides to rest and following resumes", () => {
  assert.equal(lastMove(opened(on), "fingerDown", "lineTapped"), "slide");
  assert.equal(lastMove(opened(on), "fingerDown", "lineTapped", "lineChanged"), "slide");
});

test("with Karaoke on, a finger stops the follow until the resume comes due", () => {
  assert.equal(lastMove(opened(on), "fingerDown", "lineChanged"), "stay");
  assert.equal(lastMove(opened(on), "fingerDown", "laidOut"), "stay");
  assert.equal(lastMove(opened(on), "fingerDown", "resumeDue"), "slide");
  assert.equal(lastMove(opened(on), "fingerDown", "resumeDue", "lineChanged"), "slide");
});

test("with Karaoke on, picking stops the follow and finishing brings the sung line back", () => {
  assert.equal(lastMove(opened(on), "pickStarted", "lineChanged"), "stay");
  assert.equal(lastMove(opened(on), "pickStarted", "fingerDown", "resumeDue"), "stay");
  assert.equal(lastMove(opened(on), "pickStarted", "pickEnded"), "slide");
  assert.equal(lastMove(opened(on), "pickStarted", "pickEnded", "lineChanged"), "slide");
});

test("with Karaoke on, leaving the screen clears a finger's hold, but not a pick's", () => {
  assert.equal(lastMove(opened(on), "fingerDown", "hidden", "lineChanged"), "slide");
  assert.equal(lastMove(opened(on), "pickStarted", "hidden", "lineChanged"), "stay");
});

test("with Karaoke off, leaving the screen doesn't start following", () => {
  assert.equal(lastMove(opened(off), "hidden", "lineChanged"), "stay");
});

test("turning Karaoke on goes to the sung line and follows", () => {
  assert.equal(lastMove(opened(off), "karaokeOn"), "slide");
  assert.equal(lastMove(opened(off), "karaokeOn", "lineChanged"), "slide");
  assert.equal(lastMove(opened(off), "fingerDown", "karaokeOn", "lineChanged"), "slide");
});

test("turning Karaoke on while picking waits for the pick to end", () => {
  const picking = lyricsFollowStep(opened(off), "pickStarted").state;
  assert.equal(lastMove(picking, "karaokeOn"), "stay");
  assert.equal(lastMove(picking, "karaokeOn", "lineChanged"), "stay");
  assert.equal(lastMove(picking, "karaokeOn", "pickEnded"), "slide");
});

test("turning Karaoke off leaves the lyrics in place and stops following", () => {
  assert.equal(lastMove(opened(on), "karaokeOff"), "stay");
  assert.equal(lastMove(opened(on), "karaokeOff", "lineChanged"), "stay");
  assert.equal(lastMove(opened(on), "karaokeOff", "laidOut"), "stay");
  assert.equal(lastMove(opened(on), "fingerDown", "karaokeOff", "resumeDue"), "stay");
});

test("lyrics that open on a pick don't follow until it ends", () => {
  const picking = opened(lyricsFollowStart({ karaoke: true, picking: true }));
  assert.equal(lastMove(picking, "lineChanged"), "stay");
  assert.equal(lastMove(picking, "pickEnded"), "slide");
});
