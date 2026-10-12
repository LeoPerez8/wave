import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { detailPath, inLibraryStack, isDetailPath, tabOfPath } from "./index.ts";

describe("tabOfPath", () => {
  test("each tab's own screen", () => {
    assert.equal(tabOfPath("/"), "index");
    assert.equal(tabOfPath("/library"), "library");
    assert.equal(tabOfPath("/shortcut"), "shortcut");
    assert.equal(tabOfPath("/search"), "search");
  });

  test("screens opened from the shortcut tab stay in it, under the tab bar", () => {
    assert.equal(tabOfPath("/shortcut/artist/3"), "shortcut");
    assert.equal(tabOfPath("/shortcut/album/12"), "shortcut");
  });

  test("Library screens and other screens are pushed over the tabs", () => {
    assert.equal(tabOfPath("/library/artist/3"), null);
    assert.equal(tabOfPath("/library/songs"), null);
    assert.equal(tabOfPath("/settings"), null);
    assert.equal(tabOfPath("/now-playing"), null);
    assert.equal(tabOfPath("/shortcuts"), null);
  });
});

describe("inLibraryStack", () => {
  test("only screens pushed from the Library", () => {
    assert.equal(inLibraryStack("/library/album/1"), true);
    assert.equal(inLibraryStack("/library"), false);
    assert.equal(inLibraryStack("/shortcut/album/1"), false);
    assert.equal(inLibraryStack("/settings"), false);
  });
});

describe("detailPath", () => {
  test("from the shortcut tab, or a screen in it, a detail opens inside the shortcut tab", () => {
    assert.equal(detailPath("/shortcut", "artist", 3), "/shortcut/artist/3");
    assert.equal(detailPath("/shortcut/artist/3", "album", 7), "/shortcut/album/7");
  });

  test("from anywhere else it opens on the Library stack, over the tabs", () => {
    assert.equal(detailPath("/", "album", 7), "/library/album/7");
    assert.equal(detailPath("/library/artists", "artist", 3), "/library/artist/3");
    assert.equal(detailPath("/search", "playlist", 2), "/library/playlist/2");
    assert.equal(detailPath("/now-playing", "artist", 3), "/library/artist/3");
  });
});

describe("isDetailPath", () => {
  test("recognises a detail screen in either stack", () => {
    assert.equal(isDetailPath("/library/album/7", "album", 7), true);
    assert.equal(isDetailPath("/shortcut/album/7", "album", 7), true);
    assert.equal(isDetailPath("/shortcut/album/8", "album", 7), false);
    assert.equal(isDetailPath("/shortcut/artist/7", "album", 7), false);
  });
});
