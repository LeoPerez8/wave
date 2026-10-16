import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  editTabBar,
  movableTabs,
  parseTabBar,
  storedTabBar,
  tabBarFull,
  tabsOffBar,
} from "./index.ts";

describe("the saved tab bar", () => {
  test("an install that never chose anything has today's bar: Home, Library, Playlists, Search", () => {
    assert.deepEqual(parseTabBar(null, null), ["index", "library", "playlists", "search"]);
  });

  test("the Shortcut tab chosen before the bar could be edited carries over, after Library", () => {
    assert.deepEqual(parseTabBar(null, "albums"), ["index", "library", "albums", "search"]);
    assert.deepEqual(parseTabBar(null, "favorites"), ["index", "library", "favorites", "search"]);
  });

  test("a Shortcut tab of None, junk or Folders (gone from the Library) carries over as no section tab", () => {
    for (const shortcut of ["none", "", "folders", "podcasts"]) {
      assert.deepEqual(parseTabBar(null, shortcut), ["index", "library", "search"]);
    }
  });

  test("a saved bar comes back as saved, the old Shortcut tab ignored", () => {
    assert.deepEqual(parseTabBar(storedTabBar(["index", "genres", "library"]), "albums"), [
      "index",
      "genres",
      "library",
    ]);
    assert.deepEqual(parseTabBar(storedTabBar(["index", "search"]), null), ["index", "search"]);
    assert.deepEqual(parseTabBar(storedTabBar(["index"]), null), ["index"]);
  });

  test("a saved bar is held to the bar's rules: Home first, each tab once, Search last", () => {
    assert.deepEqual(parseTabBar("songs,index,search,artists,songs", null), [
      "index",
      "songs",
      "artists",
      "search",
    ]);
    assert.deepEqual(parseTabBar("library", null), ["index", "library"]);
    assert.deepEqual(parseTabBar("", null), ["index"]);
  });

  test("tabs this Wave doesn't know (a newer Wave's, Folders) are left out", () => {
    assert.deepEqual(parseTabBar("index,folders,albums,podcasts,search", null), [
      "index",
      "albums",
      "search",
    ]);
  });

  test("a saved bar of more than five keeps Home, the first tabs after it and Search", () => {
    assert.deepEqual(parseTabBar("index,library,playlists,artists,albums,songs,search", null), [
      "index",
      "library",
      "playlists",
      "artists",
      "search",
    ]);
    assert.deepEqual(parseTabBar("index,library,playlists,artists,albums,songs", null), [
      "index",
      "library",
      "playlists",
      "artists",
      "albums",
    ]);
  });
});

describe("editing the tab bar", () => {
  const today = ["index", "library", "playlists", "search"] as const;

  test("a removed tab leaves the bar, Search and Library included", () => {
    assert.deepEqual(editTabBar(today, { remove: "playlists" }), ["index", "library", "search"]);
    assert.deepEqual(editTabBar(today, { remove: "search" }), ["index", "library", "playlists"]);
    assert.deepEqual(editTabBar(today, { remove: "library" }), ["index", "playlists", "search"]);
  });

  test("Home can't be removed", () => {
    assert.deepEqual(editTabBar(today, { remove: "index" }), today);
  });

  test("an added tab joins at the end, before the Search pill", () => {
    assert.deepEqual(editTabBar(today, { add: "albums" }), [
      "index",
      "library",
      "playlists",
      "albums",
      "search",
    ]);
    assert.deepEqual(editTabBar(["index", "songs"], { add: "genres" }), [
      "index",
      "songs",
      "genres",
    ]);
  });

  test("Search, added back, takes its pill at the end", () => {
    assert.deepEqual(editTabBar(["index", "library", "songs"], { add: "search" }), [
      "index",
      "library",
      "songs",
      "search",
    ]);
  });

  test("nothing more fits a bar of five", () => {
    const full = ["index", "library", "playlists", "albums", "search"] as const;
    assert.equal(tabBarFull(full), true);
    assert.equal(tabBarFull(today), false);
    assert.deepEqual(editTabBar(full, { add: "songs" }), full);
    assert.deepEqual(
      editTabBar(["index", "library", "playlists", "albums", "songs"], { add: "search" }),
      ["index", "library", "playlists", "albums", "songs"],
    );
  });

  test("a tab already on the bar isn't added twice", () => {
    assert.deepEqual(editTabBar(today, { add: "library" }), today);
  });

  test("the editor drags only the tabs between Home and the Search pill", () => {
    assert.deepEqual(movableTabs(today), ["library", "playlists"]);
    assert.deepEqual(movableTabs(["index", "songs", "albums"]), ["songs", "albums"]);
    assert.deepEqual(movableTabs(["index", "search"]), []);
  });

  test("a dragged tab lands where it's dropped among them, Home and Search staying put", () => {
    const bar = ["index", "library", "playlists", "albums", "search"] as const;
    assert.deepEqual(editTabBar(bar, { move: { from: 2, to: 0 } }), [
      "index",
      "albums",
      "library",
      "playlists",
      "search",
    ]);
    assert.deepEqual(editTabBar(bar, { move: { from: 0, to: 9 } }), [
      "index",
      "playlists",
      "albums",
      "library",
      "search",
    ]);
    assert.deepEqual(editTabBar(bar, { move: { from: 3, to: 0 } }), bar);
  });

  test("the editor lists the tabs off the bar in Library order, Search last", () => {
    assert.deepEqual(tabsOffBar(today), ["artists", "albums", "songs", "genres", "favorites"]);
    assert.deepEqual(tabsOffBar(["index", "albums"]), [
      "library",
      "playlists",
      "artists",
      "songs",
      "genres",
      "favorites",
      "search",
    ]);
  });
});
