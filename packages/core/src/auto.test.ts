import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AUTO_ROOT,
  autoAlbumItem,
  autoChildren,
  autoItem,
  autoPlayList,
  autoQueueStart,
  autoTrackItems,
  decodeAutoMediaId,
  encodeAutoMediaId,
  type AutoNode,
} from "./index.ts";

const album = { kind: "album", id: "12" } as const;

describe("Auto media IDs", () => {
  test("every node kind round-trips through its media ID", () => {
    const nodes: AutoNode[] = [
      { type: "root" },
      { type: "tab", tab: "home" },
      { type: "tab", tab: "playlists" },
      { type: "tab", tab: "albums" },
      { type: "tab", tab: "artists" },
      { type: "list", list: album },
      { type: "shuffle", list: album },
      { type: "track", list: album, index: 3, trackId: "456" },
    ];
    for (const node of nodes) assert.deepEqual(decodeAutoMediaId(encodeAutoMediaId(node)), node);
  });

  test("media IDs are distinct per node", () => {
    const ids = [
      encodeAutoMediaId({ type: "root" }),
      encodeAutoMediaId({ type: "tab", tab: "albums" }),
      encodeAutoMediaId({ type: "list", list: album }),
      encodeAutoMediaId({ type: "shuffle", list: album }),
      encodeAutoMediaId({ type: "track", list: album, index: 0, trackId: "1" }),
      encodeAutoMediaId({ type: "track", list: album, index: 1, trackId: "1" }),
    ];
    assert.equal(new Set(ids).size, ids.length);
  });

  test("ids holding the separator or escapes still round-trip", () => {
    const odd = { kind: "album", id: "a/b%2F:c d" } as const;
    const node: AutoNode = { type: "track", list: odd, index: 7, trackId: "x/y" };
    assert.deepEqual(decodeAutoMediaId(encodeAutoMediaId(node)), node);
  });

  test("malformed media IDs decode to null", () => {
    for (const id of [
      "",
      "nope",
      "root/extra",
      "tab",
      "tab/radio",
      "tab/albums/more",
      "album",
      "album/",
      "album/12/",
      "album/12/random",
      "album/12/shuffle/again",
      "album/12/track",
      "album/12/track/3",
      "album/12/track/3/",
      "album/12/track/-1/456",
      "album/12/track/1.5/456",
      "album/12/track/03/456",
      "album/12/track/x/456",
      "album/12/track/3/456/9",
      "album/%E0%A4%A",
      "genre/4",
    ]) {
      assert.equal(decodeAutoMediaId(id), null, id);
    }
  });
});

describe("Auto root", () => {
  test("the root is a browsable folder", () => {
    assert.deepEqual(AUTO_ROOT, {
      mediaId: "root",
      title: "Wave",
      subtitle: null,
      browsable: true,
      playable: false,
    });
  });

  test("its children are the four tabs, Home first, and nothing to fetch", () => {
    const children = autoChildren({ type: "root" }, 0, 10);
    assert.deepEqual(
      children?.items.map((item) => [item.title, item.browsable, item.playable]),
      [
        ["Home", true, false],
        ["Playlists", true, false],
        ["Albums", true, false],
        ["Artists", true, false],
      ],
    );
    assert.deepEqual(
      children?.items.map((item) => decodeAutoMediaId(item.mediaId)),
      [
        { type: "tab", tab: "home" },
        { type: "tab", tab: "playlists" },
        { type: "tab", tab: "albums" },
        { type: "tab", tab: "artists" },
      ],
    );
    assert.equal(children?.fetch, null);
  });

  test("tabs page like any list", () => {
    assert.deepEqual(
      autoChildren({ type: "root" }, 1, 3)?.items.map((item) => item.title),
      ["Artists"],
    );
    assert.deepEqual(autoChildren({ type: "root" }, 2, 3)?.items, []);
  });
});

describe("Auto Albums tab", () => {
  const albums = { type: "tab", tab: "albums" } as const;

  test("lists every album, fetched a page at a time", () => {
    assert.deepEqual(autoChildren(albums, 0, 50), {
      items: [],
      fetch: { source: { type: "albums" }, offset: 0, limit: 50 },
    });
    assert.deepEqual(autoChildren(albums, 3, 50)?.fetch, {
      source: { type: "albums" },
      offset: 150,
      limit: 50,
    });
  });

  test("an album opens with its title and album artist", () => {
    const item = autoAlbumItem({ id: 12, title: "OK Computer", albumArtist: "Radiohead" });
    assert.deepEqual(item, {
      mediaId: encodeAutoMediaId({ type: "list", list: album }),
      title: "OK Computer",
      subtitle: "Radiohead",
      browsable: true,
      playable: false,
    });
  });
});

/** An album track; `n` is its track number on disc `disc`. */
const track = (id: string, disc: number | null, n: number | null, title = `Song ${id}`) => ({
  id,
  title,
  artist: "Radiohead",
  discNumber: disc,
  trackNumber: n,
  titleSort: title.toLowerCase(),
  path: `/music/${id}.flac`,
});

// Out of order on purpose: disc 2 first, an unnumbered track, a missing disc (= disc 1).
const albumTracks = [
  track("21", 2, 1),
  track("13", 1, 3),
  track("1x", 1, null, "Bonus"),
  track("11", null, 1),
  track("12", 1, 2),
];
const inAlbumOrder = ["11", "12", "13", "1x", "21"];

describe("Auto items by media ID", () => {
  test("the root, a tab and Shuffle are known without the library", () => {
    assert.deepEqual(autoItem({ type: "root" }), AUTO_ROOT);
    assert.deepEqual(
      autoItem({ type: "tab", tab: "albums" }),
      autoChildren({ type: "root" }, 0, 10)?.items[2],
    );
    assert.deepEqual(
      autoItem({ type: "shuffle", list: album }),
      autoChildren({ type: "list", list: album }, 0, 10)?.items[0],
    );
  });

  test("an album or a track needs its library row", () => {
    assert.equal(autoItem({ type: "list", list: album }), null);
    assert.equal(autoItem({ type: "track", list: album, index: 0, trackId: "1" }), null);
  });
});

describe("Auto queue start", () => {
  const context = { kind: "album", id: "12" };

  test("a track plays its album from that track, keeping the shuffle setting", () => {
    const node = { type: "track", list: album, index: 2, trackId: "13" } as const;
    assert.deepEqual(autoPlayList(node), album);
    assert.deepEqual(autoQueueStart(node, albumTracks), {
      context,
      trackIds: inAlbumOrder,
      startIndex: 2,
      shuffle: undefined,
    });
  });

  test("Shuffle plays the whole album shuffled", () => {
    const node = { type: "shuffle", list: album } as const;
    assert.deepEqual(autoPlayList(node), album);
    assert.deepEqual(autoQueueStart(node, albumTracks), {
      context,
      trackIds: inAlbumOrder,
      startIndex: undefined,
      shuffle: true,
    });
  });

  test("a track that moved within the list still starts from itself", () => {
    // Auto listed it at index 0, but a rescan put another track before it.
    const node = { type: "track", list: album, index: 0, trackId: "12" } as const;
    assert.equal(autoQueueStart(node, albumTracks)?.startIndex, 1);
  });

  test("nothing starts for a track no longer in the list, or an empty list", () => {
    const gone = { type: "track", list: album, index: 0, trackId: "99" } as const;
    assert.equal(autoQueueStart(gone, albumTracks), null);
    assert.equal(autoQueueStart({ type: "shuffle", list: album }, []), null);
  });

  test("browsable nodes don't play", () => {
    for (const node of [
      { type: "root" },
      { type: "tab", tab: "albums" },
      { type: "list", list: album },
    ] as const) {
      assert.equal(autoPlayList(node), null);
      assert.equal(autoQueueStart(node, albumTracks), null);
    }
  });
});

/** The titles on one page of [node], with its fetched tracks from `albumTracks`. */
const albumPageTitles = (node: AutoNode, n: number, size: number): string[] => {
  const children = autoChildren(node, n, size);
  const fetched =
    children?.fetch == null
      ? []
      : autoTrackItems(album, albumTracks, children.fetch.offset, children.fetch.limit);
  return [...(children?.items ?? []), ...fetched].map((item) => item.title);
};

describe("Auto album", () => {
  const open = { type: "list", list: album } as const;

  test("starts with a Shuffle item, then lists the album's tracks", () => {
    const children = autoChildren(open, 0, 100);
    assert.deepEqual(children?.items, [
      {
        mediaId: encodeAutoMediaId({ type: "shuffle", list: album }),
        title: "Shuffle",
        subtitle: null,
        browsable: false,
        playable: true,
      },
    ]);
    assert.deepEqual(children?.fetch, {
      source: { type: "tracks", list: album },
      offset: 0,
      limit: 99,
    });
  });

  test("tracks come in disc and track order, each playing the album from itself", () => {
    const items = autoTrackItems(album, albumTracks, 0, 99);
    assert.deepEqual(
      items.map((item) => decodeAutoMediaId(item.mediaId)),
      inAlbumOrder.map((trackId, index) => ({ type: "track", list: album, index, trackId })),
    );
    assert.deepEqual(items[0], {
      mediaId: items[0]?.mediaId,
      title: "Song 11",
      subtitle: "Radiohead",
      browsable: false,
      playable: true,
    });
  });

  test("pages count the Shuffle item, so no track is skipped or repeated", () => {
    assert.deepEqual(albumPageTitles(open, 0, 2), ["Shuffle", "Song 11"]);
    assert.deepEqual(albumPageTitles(open, 1, 2), ["Song 12", "Song 13"]);
    assert.deepEqual(albumPageTitles(open, 2, 2), ["Bonus", "Song 21"]);
    assert.deepEqual(albumPageTitles(open, 3, 2), []);
  });

  test("Shuffle and tracks have no children", () => {
    assert.equal(autoChildren({ type: "shuffle", list: album }, 0, 10), null);
    assert.equal(
      autoChildren({ type: "track", list: album, index: 0, trackId: "11" }, 0, 10),
      null,
    );
  });
});
