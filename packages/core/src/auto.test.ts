import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  AUTO_ROOT,
  autoAlbumItem,
  autoArtistItem,
  autoChildren,
  autoItem,
  autoPageItems,
  autoPlayList,
  autoPlaylistItem,
  autoListPlay,
  autoQueueAdd,
  autoQueueStart,
  autoTrackItems,
  decodeAutoMediaId,
  encodeAutoMediaId,
  unsearchedTrackId,
  type AutoNode,
  type AutoTrack,
  type MixedSong,
  type YtSong,
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

/** A track of a list. */
const track = (id: string, title = `Song ${id}`): AutoTrack => ({ id, title, artist: "Radiohead" });

// In album order, as the app loads an album (disc, then track number).
const albumTracks = [track("11"), track("12"), track("13"), track("1x", "Bonus"), track("21")];
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

describe("Auto queue add", () => {
  test("adding a track adds that track", () => {
    const node = { type: "track", list: album, index: 2, trackId: "13" } as const;
    assert.deepEqual(autoQueueAdd(node, albumTracks), ["13"]);
  });

  test("a track that moved within the list is still found", () => {
    const node = { type: "track", list: album, index: 0, trackId: "12" } as const;
    assert.deepEqual(autoQueueAdd(node, albumTracks), ["12"]);
  });

  test("adding Shuffle adds the whole list, in list order", () => {
    assert.deepEqual(autoQueueAdd({ type: "shuffle", list: album }, albumTracks), inAlbumOrder);
  });

  test("nothing is added for a track gone from the list, an empty list or a browsable node", () => {
    const gone = { type: "track", list: album, index: 0, trackId: "99" } as const;
    assert.equal(autoQueueAdd(gone, albumTracks), null);
    assert.equal(autoQueueAdd({ type: "shuffle", list: album }, []), null);
    assert.equal(autoQueueAdd({ type: "list", list: album }, albumTracks), null);
  });
});

/** The titles on one page of [node], with its fetched tracks from `albumTracks`. */
const albumPageTitles = (node: AutoNode, n: number, size: number): string[] => {
  const children = autoChildren(node, n, size);
  const fetched =
    children?.fetch == null
      ? []
      : autoTrackItems(
          album,
          albumTracks.slice(children.fetch.offset, children.fetch.offset + children.fetch.limit),
          children.fetch.offset,
        );
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

  test("tracks come in the order the app lists them, each playing the album from itself", () => {
    const items = autoTrackItems(album, albumTracks, 0);
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

describe("Auto artwork", () => {
  const cover = "/data/artwork/0123456789abcdef0123456789abcdef01234567.jpg";

  test("an album shows its cover", () => {
    const item = autoAlbumItem({
      id: 12,
      title: "OK Computer",
      albumArtist: "Radiohead",
      artworkPath: cover,
    });
    assert.deepEqual(item.artwork, [cover]);
  });

  test("an album without a cover has no artwork, so Auto shows its placeholder", () => {
    const item = autoAlbumItem({
      id: 12,
      title: "OK Computer",
      albumArtist: "Radiohead",
      artworkPath: null,
    });
    assert.equal("artwork" in item, false);
  });

  test("tracks show their own artwork, and none when they have none", () => {
    const tracks = [
      { ...track("11"), artworkPath: cover },
      { ...track("12"), artworkPath: null },
    ];
    const [first, second] = autoTrackItems(album, tracks, 0);
    assert.deepEqual(first?.artwork, [cover]);
    assert.equal(second !== undefined && "artwork" in second, false);
  });

  test("Shuffle, tabs and the root have no artwork", () => {
    const items = [
      AUTO_ROOT,
      ...(autoChildren({ type: "root" }, 0, 10)?.items ?? []),
      ...(autoChildren({ type: "list", list: album }, 0, 10)?.items ?? []),
    ];
    for (const item of items) assert.equal("artwork" in item, false);
  });

  test("a playlist shows its mosaic, or its single cover", () => {
    const tiles = ["/a_thumb.jpg", "/b_thumb.jpg", "/c_thumb.jpg", "/d_thumb.jpg"];
    const mosaic = autoPlaylistItem({ id: 7, name: "Drive", trackCount: 9, thumbPaths: tiles });
    assert.deepEqual(mosaic.artwork, tiles);
    const single = autoPlaylistItem({ id: 7, name: "Drive", trackCount: 1, thumbPaths: [cover] });
    assert.deepEqual(single.artwork, [cover]);
    const empty = autoPlaylistItem({ id: 7, name: "Drive", trackCount: 0, thumbPaths: [] });
    assert.equal("artwork" in empty, false);
  });

  test("an artist shows a cover of theirs when there is one", () => {
    const shown = autoArtistItem({ id: 3, name: "Radiohead", artworkPath: cover });
    assert.deepEqual(shown.artwork, [cover]);
    assert.equal("artwork" in autoArtistItem({ id: 3, name: "Radiohead" }), false);
  });
});

describe("Auto Playlists tab", () => {
  const playlists = { type: "tab", tab: "playlists" } as const;
  const playlist = { kind: "playlist", id: "7" } as const;

  test("lists every playlist, fetched a page at a time", () => {
    assert.deepEqual(autoChildren(playlists, 0, 50), {
      items: [],
      fetch: { source: { type: "playlists" }, offset: 0, limit: 50 },
    });
    assert.deepEqual(autoChildren(playlists, 2, 50)?.fetch, {
      source: { type: "playlists" },
      offset: 100,
      limit: 50,
    });
  });

  test("a playlist opens with its name and song count", () => {
    assert.deepEqual(autoPlaylistItem({ id: 7, name: "Road trip", trackCount: 12 }), {
      mediaId: "playlist/7",
      title: "Road trip",
      subtitle: "12 songs",
      browsable: true,
      playable: false,
    });
    assert.equal(autoPlaylistItem({ id: 7, name: "Solo", trackCount: 1 }).subtitle, "1 song");
    assert.deepEqual(decodeAutoMediaId("playlist/7"), { type: "list", list: playlist });
  });

  test("no playlists shows a short explicit item instead of nothing", () => {
    assert.deepEqual(autoPageItems(playlists, 0, []), [
      {
        mediaId: "tab/playlists/empty",
        title: "No playlists yet",
        subtitle: "Create one in Wave on your phone",
        browsable: false,
        playable: false,
      },
    ]);
    // Later pages of a list that ran out stay empty; a page with rows keeps them.
    assert.deepEqual(autoPageItems(playlists, 1, []), []);
    const row = autoPlaylistItem({ id: 7, name: "Road trip", trackCount: 12 });
    assert.deepEqual(autoPageItems(playlists, 0, [row]), [row]);
  });

  test("the empty item's media ID names it", () => {
    const node = decodeAutoMediaId("tab/playlists/empty");
    assert.deepEqual(node, { type: "empty", parent: playlists });
    assert.ok(node !== null);
    assert.deepEqual(autoItem(node), autoPageItems(playlists, 0, [])[0]);
    assert.equal(encodeAutoMediaId(node), "tab/playlists/empty");
    assert.equal(autoChildren(node, 0, 10), null);
    assert.equal(autoPlayList(node), null);
    // Only lists that say what "empty" means have one.
    assert.equal(decodeAutoMediaId("tab/albums/empty"), null);
    assert.equal(decodeAutoMediaId("root/empty"), null);
    assert.equal(decodeAutoMediaId("tab/playlists/empty/empty"), null);
  });

  const playlistTracks = [track("30"), track("10"), track("20")];

  test("a playlist starts with Shuffle, then its tracks in playlist order", () => {
    const open = { type: "list", list: playlist } as const;
    const children = autoChildren(open, 0, 10);
    assert.deepEqual(
      children?.items.map((item) => [item.title, decodeAutoMediaId(item.mediaId)]),
      [["Shuffle", { type: "shuffle", list: playlist }]],
    );
    assert.deepEqual(children?.fetch, {
      source: { type: "tracks", list: playlist },
      offset: 0,
      limit: 9,
    });
    assert.deepEqual(
      autoTrackItems(playlist, playlistTracks, 0).map((item) => decodeAutoMediaId(item.mediaId)),
      [
        { type: "track", list: playlist, index: 0, trackId: "30" },
        { type: "track", list: playlist, index: 1, trackId: "10" },
        { type: "track", list: playlist, index: 2, trackId: "20" },
      ],
    );
  });

  test("a track plays the playlist from that track; Shuffle plays it shuffled", () => {
    const context = { kind: "playlist", id: "7" };
    const trackIds = ["30", "10", "20"];
    assert.deepEqual(
      autoQueueStart({ type: "track", list: playlist, index: 1, trackId: "10" }, playlistTracks),
      { context, trackIds, startIndex: 1, shuffle: undefined },
    );
    assert.deepEqual(autoQueueStart({ type: "shuffle", list: playlist }, playlistTracks), {
      context,
      trackIds,
      startIndex: undefined,
      shuffle: true,
    });
  });
});

describe("Auto Artists tab", () => {
  const artists = { type: "tab", tab: "artists" } as const;

  test("lists every artist, fetched a page at a time in Library order", () => {
    assert.deepEqual(autoChildren(artists, 0, 50), {
      items: [],
      fetch: { source: { type: "artists" }, offset: 0, limit: 50 },
    });
    assert.deepEqual(autoChildren(artists, 2, 50)?.fetch, {
      source: { type: "artists" },
      offset: 100,
      limit: 50,
    });
  });

  test("an artist opens by name", () => {
    assert.deepEqual(autoArtistItem({ id: 7, name: "Radiohead" }), {
      mediaId: "artist/7",
      title: "Radiohead",
      subtitle: null,
      browsable: true,
      playable: false,
    });
    assert.deepEqual(decodeAutoMediaId("artist/7"), { type: "artist", id: "7" });
  });

  test("artist media IDs round-trip and stay distinct from the artist's songs", () => {
    const nodes: AutoNode[] = [
      { type: "artist", id: "7" },
      { type: "artist", id: "a/b c" },
      { type: "shuffle", list: { kind: "artistSongs", id: "7" } },
    ];
    for (const node of nodes) assert.deepEqual(decodeAutoMediaId(encodeAutoMediaId(node)), node);
    assert.notEqual(encodeAutoMediaId(nodes[0]!), encodeAutoMediaId(nodes[2]!));
    for (const id of ["artist", "artist/", "artist/7/shuffle", "artist/7/albums"]) {
      assert.equal(decodeAutoMediaId(id), null, id);
    }
  });
});

describe("Auto artist", () => {
  const artist = { type: "artist", id: "7" } as const;
  const shuffleAll = {
    mediaId: encodeAutoMediaId({ type: "shuffle", list: { kind: "artistSongs", id: "7" } }),
    title: "Shuffle all",
    subtitle: null,
    browsable: false,
    playable: true,
  };

  test("starts with Shuffle all, then the artist's albums", () => {
    assert.deepEqual(autoChildren(artist, 0, 50), {
      items: [shuffleAll],
      fetch: { source: { type: "artistAlbums", id: "7" }, offset: 0, limit: 49 },
    });
  });

  test("pages count Shuffle all, so no album is skipped or repeated", () => {
    assert.deepEqual(autoChildren(artist, 1, 50), {
      items: [],
      fetch: { source: { type: "artistAlbums", id: "7" }, offset: 49, limit: 50 },
    });
  });

  test("Shuffle all is known without the library; the artist needs its row", () => {
    assert.deepEqual(
      autoItem({ type: "shuffle", list: { kind: "artistSongs", id: "7" } }),
      shuffleAll,
    );
    assert.equal(autoItem(artist), null);
  });

  test("Shuffle all plays every song of the artist shuffled, with the artist as context", () => {
    const node = decodeAutoMediaId(shuffleAll.mediaId);
    assert.ok(node !== null);
    assert.deepEqual(autoPlayList(node), { kind: "artistSongs", id: "7" });
    // By title, as the app lists an artist's songs.
    const songs = [track("1", "Airbag"), track("2", "Bloom"), track("3", "Creep")];
    assert.deepEqual(autoQueueStart(node, songs), {
      context: { kind: "artist", id: "7" },
      trackIds: ["1", "2", "3"],
      startIndex: undefined,
      shuffle: true,
    });
    assert.equal(autoQueueStart(node, []), null);
  });

  test("an artist doesn't play by itself", () => {
    assert.equal(autoPlayList(artist), null);
    assert.equal(autoQueueStart(artist, albumTracks), null);
  });
});

describe("Auto playlist playback", () => {
  const playlist = { kind: "playlist", id: "4" } as const;
  const context = { kind: "playlist", id: "4" };
  type Track = { readonly id: number };
  const own = (id: number): MixedSong<YtSong, Track> => ({ source: "library", track: { id } });
  const streamed = (videoId: string): MixedSong<YtSong, Track> => ({
    source: "stream",
    song: {
      videoId,
      title: videoId,
      artists: ["Justice"],
      album: null,
      durationMs: null,
      artworkUrl: null,
      explicit: false,
    },
  });
  const entries = [own(1), streamed("a"), own(2)];
  const shuffle = { type: "shuffle", list: playlist } as const;

  test("with YT Music on, Shuffle plays the whole list, the YT Music entries streamed", () => {
    assert.deepEqual(autoListPlay(shuffle, entries, true), {
      kind: "play",
      start: { context, trackIds: ["1", "yt:a", "2"], startIndex: undefined, shuffle: true },
      added: ["1", "yt:a", "2"],
      songs: entries,
    });
  });

  test("with YT Music off, Shuffle plays the Library's songs", () => {
    const play = autoListPlay(shuffle, entries, false);
    assert.equal(play.kind, "play");
    assert.deepEqual(play.kind === "play" && play.start.trackIds, ["1", "2"]);
  });

  test("with YT Music off, a tapped Library song plays the Library's songs from it, and adds itself", () => {
    const tapped = { type: "track", list: playlist, index: 2, trackId: "2" } as const;
    const play = autoListPlay(tapped, entries, false);
    assert.deepEqual(play.kind === "play" && play.start, {
      context,
      trackIds: ["1", "2"],
      startIndex: 1,
      shuffle: undefined,
    });
    assert.deepEqual(play.kind === "play" && play.added, ["2"]);
  });

  test("with YT Music off, a tapped YT Music entry, or Shuffle on a playlist of them alone, says YT Music is off", () => {
    const tapped = { type: "track", list: playlist, index: 1, trackId: "yt:a" } as const;
    assert.deepEqual(autoListPlay(tapped, entries, false), { kind: "ytMusicOff" });
    assert.deepEqual(autoListPlay(shuffle, [streamed("a"), streamed("b")], false), {
      kind: "ytMusicOff",
    });
  });

  test("an unsearched entry plays in its place as a YT Music entry does, by its own id", () => {
    const song = {
      title: "Touch",
      artists: ["Daft Punk"],
      album: null,
      durationMs: 498_000,
      artworkUrl: null,
    };
    const listed = [own(1), { source: "unsearched", song } as const, own(2)];
    const id = unsearchedTrackId(song);
    const tapped = { type: "track", list: playlist, index: 1, trackId: id } as const;
    const play = autoListPlay(tapped, listed, true);
    assert.deepEqual(play.kind === "play" && play.start.trackIds, ["1", id, "2"]);
    assert.deepEqual(play.kind === "play" && play.added, [id]);
    assert.deepEqual(autoListPlay(tapped, listed, false), { kind: "ytMusicOff" });
  });

  test("a song no longer in the list, or an empty list, isn't found", () => {
    const gone = { type: "track", list: playlist, index: 0, trackId: "9" } as const;
    assert.deepEqual(autoListPlay(gone, entries, true), { kind: "notFound" });
    assert.deepEqual(autoListPlay(shuffle, [], false), { kind: "notFound" });
  });
});
