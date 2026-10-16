import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  startTabSwitch,
  stepTabSwitch,
  type TabSwitch,
  type TabSwitchEvent,
  type TabSwitchStep,
} from "./index.ts";

type Tab = "index" | "library" | "songs" | "albums" | "search";

/** Runs [events] from Home on screen; returns the switches sent, in order, and the end state. */
const run = (events: readonly TabSwitchEvent<Tab>[], from: Tab = "index") => {
  let state: TabSwitch<Tab> = startTabSwitch(from);
  const sent: Tab[] = [];
  for (const event of events) {
    const step = stepTabSwitch(state, event);
    state = step.state;
    if (step.send !== null) sent.push(step.send);
  }
  return { sent, state };
};

const tap = (tab: Tab, at = 0): TabSwitchEvent<Tab> => ({ type: "tap", tab, at });
const shown = (tab: Tab | null, at = 0): TabSwitchEvent<Tab> => ({ type: "shown", tab, at });

describe("tab switches", () => {
  test("taps while a switch is on its way send nothing more until it shows", () => {
    const { sent } = run([tap("library"), tap("songs"), tap("albums")]);
    assert.deepEqual(sent, ["library"]);
  });

  test("when the switch shows, the last tab tapped meanwhile goes next, and the taps between are skipped", () => {
    const { sent } = run([
      tap("library"),
      tap("songs"),
      tap("albums"),
      shown("library"),
      shown("albums"),
    ]);
    assert.deepEqual(sent, ["library", "albums"]);
  });

  test("a tap on another tab switches to it at once", () => {
    const { send } = stepTabSwitch(startTabSwitch("index"), { type: "tap", tab: "library", at: 0 });
    assert.equal(send, "library");
  });

  test("taps back to back on a slow phone settle on the last, with fewer switches than taps", () => {
    const taps: Tab[] = ["library", "songs", "albums", "index", "library", "songs", "albums"];
    let state: TabSwitch<Tab> = startTabSwitch("index");
    const sent: Tab[] = [];
    let onItsWay: Tab | null = null;
    // Each switch takes two taps' time to show.
    taps.forEach((tab, i) => {
      if (i % 2 === 1 && onItsWay !== null) {
        const step = stepTabSwitch(state, shown(onItsWay, i * 50));
        state = step.state;
        onItsWay = step.send;
        if (step.send !== null) sent.push(step.send);
      }
      const step = stepTabSwitch(state, tap(tab, i * 50));
      state = step.state;
      if (step.send !== null) {
        sent.push(step.send);
        onItsWay = step.send;
      }
    });
    while (onItsWay !== null) {
      const step: TabSwitchStep<Tab> = stepTabSwitch(state, shown(onItsWay, 1_000));
      state = step.state;
      onItsWay = step.send;
      if (step.send !== null) sent.push(step.send);
    }
    assert.equal(state.shown, "albums");
    assert.ok(sent.length < taps.length, `sent ${sent.join(",")}`);
    assert.equal(sent.at(-1), "albums");
  });

  test("tapping back to the tab on screen while a switch is on its way returns to it", () => {
    const { sent, state } = run([tap("library"), tap("index"), shown("library")]);
    assert.deepEqual(sent, ["library", "index"]);
    assert.equal(state.sent, "index");
  });

  test("tapping the tab already on its way again sends it once", () => {
    const { sent } = run([tap("library"), tap("songs"), tap("library"), shown("library")]);
    assert.deepEqual(sent, ["library"]);
  });

  test("a switch that never shows doesn't hold the bar: a tap after a second sends again", () => {
    const { sent } = run([tap("library", 0), tap("songs", 400), tap("songs", 1_000)]);
    assert.deepEqual(sent, ["library", "songs"]);
  });

  test("a tapped tab arriving enters from the tab it replaced", () => {
    const { state } = run([tap("library")]);
    const step = stepTabSwitch(state, shown("library"));
    assert.deepEqual(step.enter, { from: "index", to: "library" });
  });

  test("a tab shown without a tap (launch, Back, a link) doesn't enter", () => {
    assert.equal(stepTabSwitch(startTabSwitch<Tab>(null), shown("index")).enter, null);
    assert.equal(stepTabSwitch(startTabSwitch<Tab>("index"), shown("songs")).enter, null);
  });

  test("a tapped tab coming back from under a pushed screen doesn't enter", () => {
    const { state } = run([tap("library"), shown(null)], "index");
    assert.equal(stepTabSwitch(state, shown("library")).enter, null);
  });

  test("a tap on the tab on screen sends nothing", () => {
    const { send } = stepTabSwitch(startTabSwitch("index"), { type: "tap", tab: "index", at: 0 });
    assert.equal(send, null);
  });

  test("a tap on the tab on screen, with no switch on its way, re-taps it (back to its top and root)", () => {
    const step = stepTabSwitch(startTabSwitch<Tab>("index"), tap("index"));
    assert.equal(step.retapped, true);
  });

  test("a tap that switches, or waits for a switch on its way, is no re-tap", () => {
    const first = stepTabSwitch(startTabSwitch<Tab>("index"), tap("library"));
    assert.equal(first.retapped, false);
    // Back to the tab on screen while the switch is on its way: a switch back, not a re-tap.
    assert.equal(stepTabSwitch(first.state, tap("index", 100)).retapped, false);
    assert.equal(stepTabSwitch(first.state, tap("songs", 100)).retapped, false);
  });

  test("once the switch showed, a tap on that tab re-taps it", () => {
    const { state } = run([tap("library"), shown("library")]);
    assert.equal(stepTabSwitch(state, tap("library", 200)).retapped, true);
  });

  test("a tap on the tab on screen after a switch was lost re-taps it", () => {
    const { state } = run([tap("library", 0)]);
    const step = stepTabSwitch(state, tap("index", 1_000));
    assert.equal(step.send, null);
    assert.equal(step.retapped, true);
  });
});
