import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  describeTabScreens,
  keepTabs,
  parseTabScreens,
  sameKeptTabs,
  warmTab,
} from "./index.ts";

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

describe("a tab warmed before its first visit (#1438)", () => {
  test("joins the kept tabs, after them, so the next to go is it", () => {
    assert.deepEqual(warmTab(["library", "index"], "search", bar, 5), ["library", "index", "search"]);
  });

  test("a tab already kept, off the bar, or past the limit changes nothing", () => {
    const kept: readonly Tab[] = ["library", "index"];
    assert.equal(warmTab(kept, "library", bar, 5), kept);
    assert.equal(warmTab(kept, "albums", bar, 5), kept);
    assert.equal(warmTab(kept, "search", bar, 2), kept);
  });

  test("a visit then puts it first, like any kept tab", () => {
    const kept = warmTab<Tab>(["index"], "search", bar, 5);
    assert.deepEqual(keepTabs(kept, "search", bar, 5), ["search", "index"]);
  });
});

describe("the kept tabs as the tab navigator sees them (#1438)", () => {
  test("switching between kept tabs keeps the same list, so the navigator isn't drawn for it", () => {
    const shown: readonly Tab[] = ["index", "library"];
    assert.equal(sameKeptTabs(shown, ["library", "index"]), shown);
  });

  test("a tab joining or leaving gives the new list", () => {
    const shown: readonly Tab[] = ["index", "library"];
    assert.deepEqual(sameKeptTabs(shown, ["search", "index", "library"]), ["search", "index", "library"]);
    assert.deepEqual(sameKeptTabs(shown, ["library"]), ["library"]);
    assert.deepEqual(sameKeptTabs(shown, ["songs", "library"]), ["songs", "library"]);
  });
});

describe("how hidden tabs are kept (chosen at bundle time, for the comparison)", () => {
  test("by default a hidden tab is out of the window, display none and frozen, the whole bar kept (#1358)", () => {
    assert.deepEqual(parseTabScreens(undefined), {
      detach: true,
      keepLayout: false,
      freeze: true,
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
    assert.deepEqual(parseTabScreens("thaw"), { ...parseTabScreens(undefined), freeze: false });
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
    assert.equal(parseTabScreens("attach").freeze, false);
  });

  test("a later choice wins: thaw then freeze freezes", () => {
    assert.equal(parseTabScreens("thaw freeze").freeze, true);
    assert.equal(parseTabScreens("freeze,thaw").freeze, false);
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
    assert.equal(
      describeTabScreens(parseTabScreens(undefined)),
      "detach,display-none,freeze,retain=5",
    );
    const thawed = parseTabScreens("thaw");
    assert.equal(describeTabScreens(thawed), "detach,display-none,thaw,retain=5");
    assert.deepEqual(parseTabScreens(describeTabScreens(thawed)), thawed);
    const following = parseTabScreens("follow");
    assert.equal(describeTabScreens(following), "detach,display-none,freeze,follow,retain=5");
    assert.deepEqual(parseTabScreens(describeTabScreens(following)), following);
  });
});
