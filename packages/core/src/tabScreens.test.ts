import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { describeTabScreens, keepTabs, parseTabScreens } from "./index.ts";

type Tab = "index" | "library" | "songs" | "albums" | "search";
const bar: Tab[] = ["index", "library", "songs", "search"];

describe("tabs kept mounted", () => {
  test("a visited tab is kept, the latest first", () => {
    let kept: readonly Tab[] = [];
    for (const tab of ["index", "library", "index"] as const) kept = keepTabs(kept, tab, bar, 5);
    assert.deepEqual(kept, ["index", "library"]);
  });

  test("past the limit, the tab left longest ago goes", () => {
    let kept: readonly Tab[] = [];
    for (const tab of ["index", "library", "songs", "index", "search"] as const) {
      kept = keepTabs(kept, tab, bar, 3);
    }
    assert.deepEqual(kept, ["search", "index", "songs"]);
  });

  test("a tab taken off the bar isn't kept", () => {
    const kept = keepTabs(["index", "albums", "library"], "index", bar, 5);
    assert.deepEqual(kept, ["index", "library"]);
  });

  test("the tab on screen is kept even off the bar, until another shows", () => {
    assert.deepEqual(keepTabs(["index"], "albums", bar, 5), ["albums", "index"]);
  });

  test("under a pushed screen, the tabs stay as they were", () => {
    const kept: readonly Tab[] = ["library", "index"];
    assert.equal(keepTabs(kept, null, bar, 5), kept);
  });

  test("showing the latest tab again keeps the same list (no re-render)", () => {
    const kept: readonly Tab[] = ["library", "index"];
    assert.equal(keepTabs(kept, "library", bar, 5), kept);
  });
});

describe("how hidden tabs are kept (chosen at bundle time, for the comparison)", () => {
  test("by default, as before: out of the window, display none, not frozen, the whole bar kept", () => {
    assert.deepEqual(parseTabScreens(undefined), {
      detach: true,
      keepLayout: false,
      freeze: false,
      followHidden: false,
      retain: 5,
    });
    assert.deepEqual(parseTabScreens(""), parseTabScreens(undefined));
  });

  test("each choice can be named, in any order", () => {
    assert.deepEqual(parseTabScreens("freeze, retain=3 keep-layout"), {
      detach: true,
      keepLayout: true,
      freeze: true,
      followHidden: false,
      retain: 3,
    });
    assert.deepEqual(parseTabScreens("attach"), {
      detach: false,
      keepLayout: false,
      freeze: false,
      followHidden: false,
      retain: 5,
    });
  });

  test("hidden screens stop following stores unless a bundle asks them to follow (#722)", () => {
    assert.equal(parseTabScreens("follow").followHidden, true);
    assert.equal(parseTabScreens("follow pause").followHidden, false);
    assert.equal(parseTabScreens("attach follow").followHidden, true);
  });

  test("a hidden tab left attached doesn't keep its layout: it would draw under the shown one", () => {
    assert.equal(parseTabScreens("attach,keep-layout").keepLayout, false);
  });

  test("only a detached tab can freeze (react-native-screens freezes only the screens it manages)", () => {
    assert.equal(parseTabScreens("attach,freeze").freeze, false);
  });

  test("anything unknown or out of range is left at its default", () => {
    assert.deepEqual(parseTabScreens("retain=0 retain=x fast"), parseTabScreens(undefined));
  });

  test("the description names every choice and reads back as the same choices", () => {
    const screens = parseTabScreens("keep-layout freeze retain=2");
    assert.equal(describeTabScreens(screens), "detach,keep-layout,freeze,retain=2");
    assert.deepEqual(parseTabScreens(describeTabScreens(screens)), screens);
    const attached = parseTabScreens("attach");
    assert.deepEqual(parseTabScreens(describeTabScreens(attached)), attached);
    assert.equal(describeTabScreens(parseTabScreens(undefined)), "detach,display-none,retain=5");
    const following = parseTabScreens("follow");
    assert.equal(describeTabScreens(following), "detach,display-none,follow,retain=5");
    assert.deepEqual(parseTabScreens(describeTabScreens(following)), following);
  });
});
