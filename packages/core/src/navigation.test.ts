import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { TAB_PATH, detailPath, inLibraryStack, isDetailPath, tabOfPath } from "./index.ts";

describe("tabOfPath", () => {
  test("each tab's own screen", () => {
    assert.equal(tabOfPath("/"), "index");
    assert.equal(tabOfPath("/library"), "library");
    assert.equal(tabOfPath("/search"), "search");
    assert.equal(tabOfPath("/playlists"), "playlists");
    assert.equal(tabOfPath("/favorites"), "favorites");
  });

  test("every tab has a path of its own", () => {
    assert.equal(new Set(Object.values(TAB_PATH)).size, 9);
    for (const [tab, path] of Object.entries(TAB_PATH)) assert.equal(tabOfPath(path), tab);
  });

  test("screens opened from a section tab stay in it, under the tab bar", () => {
    assert.equal(tabOfPath("/artists/artist/3"), "artists");
    assert.equal(tabOfPath("/albums/album/12"), "albums");
    assert.equal(tabOfPath("/playlists/artist/3"), "playlists");
  });

  test("Library screens and other screens are pushed over the tabs", () => {
    assert.equal(tabOfPath("/library/artist/3"), null);
    assert.equal(tabOfPath("/library/songs"), null);
    assert.equal(tabOfPath("/settings"), null);
    assert.equal(tabOfPath("/now-playing"), null);
    assert.equal(tabOfPath("/songsx"), null);
    assert.equal(tabOfPath("/search/x"), null);
  });
});

describe("inLibraryStack", () => {
  test("only screens pushed from the Library", () => {
    assert.equal(inLibraryStack("/library/album/1"), true);
    assert.equal(inLibraryStack("/library"), false);
    assert.equal(inLibraryStack("/albums/album/1"), false);
    assert.equal(inLibraryStack("/settings"), false);
  });
});

describe("detailPath", () => {
  test("from a section tab, or a screen in it, a detail opens inside that tab", () => {
    assert.equal(detailPath("/artists", "artist", 3), "/artists/artist/3");
    assert.equal(detailPath("/artists/artist/3", "album", 7), "/artists/album/7");
    assert.equal(detailPath("/playlists", "playlist", 2), "/playlists/playlist/2");
  });

  test("from anywhere else it opens on the Library stack, over the tabs", () => {
    assert.equal(detailPath("/", "album", 7), "/library/album/7");
    assert.equal(detailPath("/library", "album", 7), "/library/album/7");
    assert.equal(detailPath("/library/artists", "artist", 3), "/library/artist/3");
    assert.equal(detailPath("/search", "playlist", 2), "/library/playlist/2");
    assert.equal(detailPath("/now-playing", "artist", 3), "/library/artist/3");
  });
});

describe("isDetailPath", () => {
  test("recognises a detail screen in the Library stack or any section tab", () => {
    assert.equal(isDetailPath("/library/album/7", "album", 7), true);
    assert.equal(isDetailPath("/albums/album/7", "album", 7), true);
    assert.equal(isDetailPath("/songs/album/7", "album", 7), true);
    assert.equal(isDetailPath("/albums/album/8", "album", 7), false);
    assert.equal(isDetailPath("/albums/artist/7", "album", 7), false);
    assert.equal(isDetailPath("/search/album/7", "album", 7), false);
  });
});
