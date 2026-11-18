import assert from "node:assert/strict";
import { test } from "node:test";

import { panelTabs, shownPanelTab, stepPanelTab } from "../shared/panelTabs.ts";

test("the side panel has a Related tab only while YouTube Music is on", () => {
  assert.deepEqual(panelTabs(true), ["lyrics", "queue", "related"]);
  assert.deepEqual(panelTabs(false), ["lyrics", "queue"]);
});

test("Related gives way to the Queue once YouTube Music is off", () => {
  assert.equal(shownPanelTab("related", true), "related");
  assert.equal(shownPanelTab("related", false), "queue");
  assert.equal(shownPanelTab("lyrics", false), "lyrics");
});

test("the arrow keys go round the tabs that show", () => {
  assert.equal(stepPanelTab("queue", 1, true), "related");
  assert.equal(stepPanelTab("related", 1, true), "lyrics");
  assert.equal(stepPanelTab("lyrics", -1, true), "related");
  assert.equal(stepPanelTab("queue", 1, false), "lyrics");
  assert.equal(stepPanelTab("related", -1, false), "lyrics");
});
