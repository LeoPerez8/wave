import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  autoAlbumItem,
  autoChildren,
  autoItem,
  autoPageItems,
  autoPlayList,
  autoQueueStart,
  autoTrackItems,
  decodeAutoMediaId,
  encodeAutoMediaId,
  type AutoNode,
  type AutoTrack,
} from "./index.ts";

const homeTab = { type: "tab", tab: "home" } as const;
const mostPlayed = { kind: "home", id: "most-played" } as const;
const favorites = { kind: "home", id: "favorites" } as const;

const song = (id: string, title: string): AutoTrack => ({ id, title, artist: "Artist" });

describe("Auto Home tab", () => {
  test("lists Recently Played, Most Played and Favorites folders, and nothing to fetch", () => {
    const children = autoChildren(homeTab, 0, 10);
    assert.deepEqual(
      children?.items.map((item) => [item.title, item.browsable, item.playable]),
      [
        ["Recently Played", true, false],
        ["Most Played", true, false],
        ["Favorites", true, false],
      ],
    );
    assert.deepEqual(
      children?.items.map((item) => decodeAutoMediaId(item.mediaId)),
      [
        { type: "recentlyPlayed" },
        { type: "list", list: { kind: "home", id: "most-played" } },
        { type: "list", list: { kind: "home", id: "favorites" } },
      ],
    );
    assert.equal(children?.fetch, null);
  });
});

describe("Auto Home sections", () => {
  test("Recently Played lists the recently played albums, a page at a time", () => {
    assert.deepEqual(autoChildren({ type: "recentlyPlayed" }, 0, 20), {
      items: [],
      fetch: { source: { type: "recentlyPlayed" }, offset: 0, limit: 20 },
    });
    assert.deepEqual(autoChildren({ type: "recentlyPlayed" }, 1, 20)?.fetch?.offset, 20);
  });

  test("an album in Recently Played opens the album", () => {
    const item = autoAlbumItem({ id: 7, title: "Kid A", albumArtist: "Radiohead" });
    assert.deepEqual(decodeAutoMediaId(item.mediaId), {
      type: "list",
      list: { kind: "album", id: "7" },
    });
  });

  test("Most Played and Favorites start with Shuffle, then list their songs", () => {
    for (const list of [mostPlayed, favorites]) {
      const children = autoChildren({ type: "list", list }, 0, 10);
      assert.deepEqual(
        children?.items.map((item) => [item.title, item.playable, decodeAutoMediaId(item.mediaId)]),
        [["Shuffle", true, { type: "shuffle", list }]],
      );
      assert.deepEqual(children?.fetch, {
        source: { type: "tracks", list },
        offset: 0,
        limit: 9,
      });
      assert.deepEqual(autoChildren({ type: "list", list }, 2, 10)?.fetch?.offset, 19);
    }
  });

  test("their songs keep the section's order, each playing the section from itself", () => {
    const items = autoTrackItems(mostPlayed, [song("9", "Most"), song("3", "Next")], 0);
    assert.deepEqual(
      items.map((item) => [item.title, item.playable, decodeAutoMediaId(item.mediaId)]),
      [
        ["Most", true, { type: "track", list: mostPlayed, index: 0, trackId: "9" }],
        ["Next", true, { type: "track", list: mostPlayed, index: 1, trackId: "3" }],
      ],
    );
  });
});

/** Page 0 as the app builds it: the node's fixed items (Shuffle), then no rows. */
const firstPageWithoutRows = (node: AutoNode) => autoChildren(node, 0, 10)?.items ?? [];

describe("Auto Home empty sections", () => {
  const sections: [AutoNode, string][] = [
    [{ type: "recentlyPlayed" }, "Nothing played yet"],
    [{ type: "list", list: mostPlayed }, "No plays yet"],
    [{ type: "list", list: favorites }, "No favorites yet"],
  ];

  test("an empty section shows a single item saying so (no Shuffle), which neither opens nor plays", () => {
    for (const [node, title] of sections) {
      const [item, ...more] = autoPageItems(node, 0, firstPageWithoutRows(node));
      assert.equal(more.length, 0);
      assert.equal(item?.title, title);
      assert.equal(item?.browsable, false);
      assert.equal(item?.playable, false);
      const empty = decodeAutoMediaId(item?.mediaId ?? "");
      assert.notEqual(empty, null);
      assert.deepEqual(empty === null ? null : autoItem(empty), item);
      assert.equal(empty === null ? "no node" : autoChildren(empty, 0, 10), null);
    }
  });

  test("a section with rows shows them as they are, Shuffle first", () => {
    const node: AutoNode = { type: "list", list: favorites };
    const page = [
      ...firstPageWithoutRows(node),
      ...autoTrackItems(favorites, [song("1", "One")], 0),
    ];
    assert.deepEqual(
      autoPageItems(node, 0, page).map((item) => item.title),
      ["Shuffle", "One"],
    );
  });

  test("a page past the end of a section stays empty", () => {
    for (const [node] of sections) assert.deepEqual(autoPageItems(node, 1, []), []);
  });

  test("other lists have no empty item", () => {
    assert.deepEqual(autoPageItems({ type: "tab", tab: "albums" }, 0, []), []);
    assert.deepEqual(autoPageItems({ type: "list", list: { kind: "album", id: "1" } }, 0, []), []);
  });
});

describe("Auto Home queue start", () => {
  const songs = [song("9", "Most"), song("3", "Next"), song("5", "Last")];

  test("a Most Played song plays Most Played from itself, as the Home section", () => {
    const node = { type: "track", list: mostPlayed, index: 1, trackId: "3" } as const;
    assert.deepEqual(autoPlayList(node), mostPlayed);
    assert.deepEqual(autoQueueStart(node, songs), {
      context: { kind: "home", id: "most-played" },
      trackIds: ["9", "3", "5"],
      startIndex: 1,
      shuffle: undefined,
    });
  });

  test("a Favorites song plays Favorites from itself, as the Home section", () => {
    const node = { type: "track", list: favorites, index: 0, trackId: "9" } as const;
    assert.deepEqual(autoQueueStart(node, songs), {
      context: { kind: "home", id: "favorites" },
      trackIds: ["9", "3", "5"],
      startIndex: 0,
      shuffle: undefined,
    });
  });

  test("a song that moved in the section still starts from itself", () => {
    const node = { type: "track", list: mostPlayed, index: 0, trackId: "5" } as const;
    assert.equal(autoQueueStart(node, songs)?.startIndex, 2);
  });

  test("Shuffle plays the whole section shuffled, as the Home section", () => {
    assert.deepEqual(autoQueueStart({ type: "shuffle", list: favorites }, songs), {
      context: { kind: "home", id: "favorites" },
      trackIds: ["9", "3", "5"],
      startIndex: undefined,
      shuffle: true,
    });
    assert.equal(autoQueueStart({ type: "shuffle", list: mostPlayed }, []), null);
  });

  test("the sections themselves don't play", () => {
    assert.equal(autoPlayList({ type: "recentlyPlayed" }), null);
    assert.equal(autoQueueStart({ type: "list", list: favorites }, songs), null);
  });
});

describe("Auto Home media IDs", () => {
  test("Home's nodes round-trip through readable media IDs", () => {
    const nodes: [AutoNode, string][] = [
      [{ type: "recentlyPlayed" }, "home/recently-played"],
      [{ type: "list", list: mostPlayed }, "home/most-played"],
      [{ type: "list", list: favorites }, "home/favorites"],
      [{ type: "shuffle", list: mostPlayed }, "home/most-played/shuffle"],
      [{ type: "track", list: favorites, index: 2, trackId: "45" }, "home/favorites/track/2/45"],
    ];
    for (const [node, id] of nodes) {
      assert.equal(encodeAutoMediaId(node), id);
      assert.deepEqual(decodeAutoMediaId(id), node);
    }
  });

  test("other Home media IDs decode to null", () => {
    for (const id of [
      "home",
      "home/recently-added",
      "home/recently-played/more",
      "home/most-played/shuffle/again",
      "home/top-rated",
      "home/favorites/track/2",
    ]) {
      assert.equal(decodeAutoMediaId(id), null, id);
    }
  });

  test("the sections are known by media ID without the library", () => {
    const sections: AutoNode[] = [
      { type: "recentlyPlayed" },
      { type: "list", list: mostPlayed },
      { type: "list", list: favorites },
    ];
    assert.deepEqual(
      sections.map((node) => autoItem(node)?.title),
      ["Recently Played", "Most Played", "Favorites"],
    );
  });
});
