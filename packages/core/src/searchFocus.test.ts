import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SEARCH_FOCUS_LIMITS,
  startSearchFocus,
  stepSearchFocus,
  type SearchFocusCommand,
  type SearchFocusEvent,
  type SearchFocusState,
} from "./index.ts";

/** Plays [events] from the start; returns the commands given and the last step. */
const play = (events: readonly SearchFocusEvent[], from: SearchFocusState = startSearchFocus()) => {
  let state = from;
  const commands: SearchFocusCommand[] = [];
  let wantsFrame = false;
  for (const event of events) {
    const step = stepSearchFocus(state, event);
    state = step.state;
    if (step.command !== null) commands.push(step.command);
    wantsFrame = step.wantsFrame;
  }
  return { state, commands, wantsFrame };
};

/** Frames every 8 ms (120 Hz) from [from] to [to]. */
const frames = (from: number, to: number): SearchFocusEvent[] => {
  const events: SearchFocusEvent[] = [];
  for (let at = from; at <= to; at += 8) events.push({ type: "frame", at });
  return events;
};

describe("search field focus", () => {
  test("first visit: the tap's request focuses the field on the first frame it is in sight and laid out", () => {
    const waiting = play([{ type: "requested", at: 0 }, ...frames(8, 40), { type: "shown" }]);
    assert.deepEqual(waiting.commands, []);
    assert.equal(waiting.wantsFrame, true);
    const laidOut = play([{ type: "attached" }], waiting.state);
    assert.deepEqual(laidOut.commands, []);
    assert.equal(laidOut.wantsFrame, true);
    const focusing = play([{ type: "frame", at: 56 }], laidOut.state);
    assert.deepEqual(focusing.commands, ["focus"]);
  });

  test("once the field has the focus and the keyboard is up the request is done: no more frames or commands", () => {
    const done = play([
      { type: "shown" },
      { type: "attached" },
      { type: "requested", at: 0 },
      { type: "frame", at: 8 },
      { type: "focused" },
      { type: "keyboardShown" },
    ]);
    assert.equal(done.wantsFrame, false);
    assert.equal(done.state.request, null);
    assert.deepEqual(play(frames(16, 2000), done.state).commands, []);
  });

  test("a focus the field never reports is retried a bounded number of times, then given up", () => {
    const { retryMs, attempts } = SEARCH_FOCUS_LIMITS;
    const run = play([
      { type: "shown" },
      { type: "attached" },
      { type: "requested", at: 0 },
      ...frames(8, 5000),
    ]);
    assert.equal(run.commands.length, attempts);
    assert.deepEqual(run.commands, [
      "focus",
      ...Array<SearchFocusCommand>(attempts - 1).fill("refocus"),
    ]);
    assert.equal(run.state.request, null);
    assert.equal(run.wantsFrame, false);
    // Retries are spaced, not one per frame.
    const early = play([
      { type: "shown" },
      { type: "attached" },
      { type: "requested", at: 0 },
      ...frames(8, 8 + retryMs - 8),
    ]);
    assert.deepEqual(early.commands, ["focus"]);
  });

  test("leaving Search cancels a pending focus and blurs the field", () => {
    const left = play([
      { type: "shown" },
      { type: "attached" },
      { type: "requested", at: 0 },
      { type: "frame", at: 8 },
      { type: "hidden" },
    ]);
    assert.deepEqual(left.commands, ["focus", "blur"]);
    assert.equal(left.wantsFrame, false);
    assert.deepEqual(play(frames(16, 3000), left.state).commands, []);
  });

  test("a request the screen doesn't show up for in time never pops the keyboard later", () => {
    const late = play([
      { type: "requested", at: 0 },
      ...frames(8, SEARCH_FOCUS_LIMITS.waitMs + 8),
      { type: "shown" },
      { type: "attached" },
      ...frames(SEARCH_FOCUS_LIMITS.waitMs + 16, SEARCH_FOCUS_LIMITS.waitMs + 400),
    ]);
    assert.deepEqual(late.commands, []);
    assert.equal(late.wantsFrame, false);
  });

  test("warm visit: a field laid out on an earlier visit is focused on the frame after Search shows again", () => {
    const earlier = play([
      { type: "shown" },
      { type: "attached" },
      { type: "requested", at: 0 },
      { type: "frame", at: 8 },
      { type: "focused" },
      { type: "hidden" },
      { type: "blurred" },
    ]);
    // The tab tap asks before the tab switch shows the screen.
    const back = play(
      [{ type: "requested", at: 5000 }, { type: "frame", at: 5008 }, { type: "shown" }],
      earlier.state,
    );
    assert.deepEqual(back.commands, []);
    assert.deepEqual(play([{ type: "frame", at: 5016 }], back.state).commands, ["focus"]);
  });

  test("rapid tab taps: each Search tap asks again, and a pending one is never retried after leaving", () => {
    const run = play([
      { type: "requested", at: 0 },
      { type: "shown" },
      { type: "attached" },
      { type: "frame", at: 8 },
      { type: "hidden" },
      { type: "requested", at: 40 },
      { type: "shown" },
      { type: "frame", at: 48 },
      { type: "focused" },
      { type: "keyboardShown" },
      ...frames(56, 1000),
    ]);
    assert.deepEqual(run.commands, ["focus", "blur", "focus"]);
    assert.equal(run.wantsFrame, false);
  });

  test("asking while the field has focus and the keyboard is up does nothing", () => {
    const run = play([
      { type: "shown" },
      { type: "attached" },
      { type: "focused" },
      { type: "keyboardShown" },
      { type: "requested", at: 0 },
      ...frames(8, 400),
    ]);
    assert.deepEqual(run.commands, []);
    assert.equal(run.state.request, null);
  });

  test("a focus the field reports without the keyboard coming up is asked again", () => {
    // Android takes the focus of a field its window doesn't serve yet (still being attached)
    // and reports it, but ignores the keyboard asked for with it.
    const run = play([
      { type: "shown" },
      { type: "attached" },
      { type: "requested", at: 0 },
      { type: "frame", at: 8 },
      { type: "focused" },
      ...frames(16, 1200),
    ]);
    assert.equal(run.commands[0], "focus");
    assert.ok(run.commands.includes("refocus"), `asked again: ${run.commands.join(", ")}`);
  });

  test("tapping Search while it shows, after Back put the keyboard away, raises it again", () => {
    // Back hides the keyboard and leaves the field focused.
    const putAway = play([
      { type: "shown" },
      { type: "attached" },
      { type: "requested", at: 0 },
      { type: "frame", at: 8 },
      { type: "focused" },
      { type: "keyboardShown" },
      { type: "keyboardHidden" },
    ]);
    const tapped = play(
      [
        { type: "requested", at: 3000 },
        { type: "frame", at: 3008 },
      ],
      putAway.state,
    );
    // React Native skips a focus on a field it takes as focused: blur, then focus.
    assert.deepEqual(tapped.commands, ["refocus"]);
    const raised = play(
      [{ type: "blurred" }, { type: "focused" }, { type: "keyboardShown" }],
      tapped.state,
    );
    assert.equal(raised.wantsFrame, false);
    assert.deepEqual(play(frames(3016, 5000), raised.state).commands, []);
  });

  test("a focus taken while the keyboard is already up is done at once", () => {
    const run = play([
      { type: "keyboardShown" },
      { type: "shown" },
      { type: "attached" },
      { type: "requested", at: 0 },
      { type: "frame", at: 8 },
      { type: "focused" },
      ...frames(16, 2000),
    ]);
    assert.deepEqual(run.commands, ["focus"]);
    assert.equal(run.wantsFrame, false);
  });

  test("a focus waiting for its keyboard isn't asked again before the keyboard has had time", () => {
    const { keyboardMs, attempts } = SEARCH_FOCUS_LIMITS;
    const waiting = play([
      { type: "shown" },
      { type: "attached" },
      { type: "requested", at: 0 },
      { type: "frame", at: 8 },
      { type: "focused" },
      ...frames(16, keyboardMs),
    ]);
    assert.deepEqual(waiting.commands, ["focus"]);
    // The keyboard never comes: asked a bounded number of times, then given up.
    const given = play(frames(keyboardMs + 8, 10_000), waiting.state);
    assert.equal(given.commands.length, attempts - 1);
    assert.equal(given.state.request, null);
    assert.equal(given.wantsFrame, false);
  });

  test("arriving without a tap (Back from a result) asks nothing", () => {
    const run = play([{ type: "shown" }, { type: "attached" }, ...frames(8, 400)]);
    assert.deepEqual(run.commands, []);
    assert.equal(run.wantsFrame, false);
  });
});
