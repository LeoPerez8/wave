import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DISCOVER_START,
  discoverItemAction,
  discoverShouldAsk,
  discoverTileCaption,
  discoverTrackId,
  discoverView,
  stepDiscover,
  ytAlbumSongs,
} from "./index.ts";
import type { DiscoverState, YtHome, YtShelf, YtShelfItem, YtSong } from "./index.ts";

const song = (videoId: string, title = videoId): YtSong => ({
  videoId,
  title,
  artists: ["Artist"],
  album: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

const songShelf = (title: string, ...songs: YtSong[]): YtShelf => ({
  title,
  items: songs.map((s) => ({ kind: "song", song: s })),
});

const home = (...shelves: YtShelf[]): YtHome => ({ shelves });

const nothingLocal = (): null => null;
const signedIn = { enabled: true, signedIn: true, find: nothingLocal };

const loaded = (answer: YtHome): DiscoverState => {
  const asked = stepDiscover(DISCOVER_START, { type: "requested" });
  return stepDiscover(asked, { type: "loaded", request: asked.request, home: answer });
};

/** The titles of the shelves [state] shows, or what shows instead. */
const titles = (state: DiscoverState): string[] => {
  const view = discoverView(state, signedIn);
  return view.kind === "shelves" ? view.shelves.map((shelf) => shelf.title) : [view.kind];
};

describe("stepDiscover", () => {
  const first = home(songShelf("Quick picks", song("a")));
  const fresh = home(songShelf("Mixed for you", song("b")));
  test("pulling to refresh keeps the shelves up until the new ones arrive", () => {
    const refreshing = stepDiscover(loaded(first), { type: "requested" });
    assert.equal(refreshing.loading, true);
    assert.deepEqual(titles(refreshing), ["Quick picks"]);
    const refreshed = stepDiscover(refreshing, {
      type: "loaded",
      request: refreshing.request,
      home: fresh,
    });
    assert.equal(refreshed.loading, false);
    assert.deepEqual(titles(refreshed), ["Mixed for you"]);
  });

  test("a refresh that gets no answer leaves the shelves as they were", () => {
    const refreshing = stepDiscover(loaded(first), { type: "requested" });
    const offline = stepDiscover(refreshing, {
      type: "failed",
      request: refreshing.request,
      reason: "offline",
    });
    assert.equal(offline.loading, false);
    assert.deepEqual(titles(offline), ["Quick picks"]);
  });

  test("an answer to an older question is dropped", () => {
    const asked = stepDiscover(DISCOVER_START, { type: "requested" });
    const askedAgain = stepDiscover(asked, { type: "requested" });
    const stale = stepDiscover(askedAgain, { type: "loaded", request: asked.request, home: first });
    assert.deepEqual(stale, askedAgain);
    const staleFailure = stepDiscover(askedAgain, {
      type: "failed",
      request: asked.request,
      reason: "failed",
    });
    assert.deepEqual(staleFailure, askedAgain);
  });

  test("signing out forgets the account's shelves and drops answers on their way", () => {
    const asking = stepDiscover(loaded(first), { type: "requested" });
    const signedOut = stepDiscover(asking, { type: "signedOut" });
    assert.equal(signedOut.home, null);
    assert.equal(signedOut.loading, false);
    const late = stepDiscover(signedOut, { type: "loaded", request: asking.request, home: fresh });
    assert.deepEqual(late, signedOut);
  });
});

describe("discoverShouldAsk", () => {
  test("asks once a signed-in account opens Discover, and not again until refreshed", () => {
    assert.equal(discoverShouldAsk(DISCOVER_START, signedIn), true);
    const asked = stepDiscover(DISCOVER_START, { type: "requested" });
    assert.equal(discoverShouldAsk(asked, signedIn), false);
    assert.equal(
      discoverShouldAsk(loaded(home(songShelf("Quick picks", song("a")))), signedIn),
      false,
    );
    const failed = stepDiscover(asked, {
      type: "failed",
      request: asked.request,
      reason: "offline",
    });
    assert.equal(discoverShouldAsk(failed, signedIn), false);
  });

  test("waits to know whether an account is signed in", () => {
    const unknown = { ...signedIn, signedIn: null };
    assert.equal(discoverShouldAsk(DISCOVER_START, unknown), false);
    assert.deepEqual(discoverView(DISCOVER_START, unknown), { kind: "loading" });
  });

  test("never asks YouTube signed out or with YT Music off", () => {
    assert.equal(discoverShouldAsk(DISCOVER_START, { ...signedIn, signedIn: false }), false);
    assert.equal(discoverShouldAsk(DISCOVER_START, { ...signedIn, enabled: false }), false);
  });

  test("asks again for the account that signs in after another signed out", () => {
    const signedOut = stepDiscover(loaded(home(songShelf("Quick picks", song("a")))), {
      type: "signedOut",
    });
    assert.equal(discoverShouldAsk(signedOut, signedIn), true);
  });
});

describe("Discover's shelves", () => {
  const mine = { id: 7, title: "Mine", artist: "Artist", durationMs: 200_000 };
  const find = (s: YtSong) => (s.title === "Mine" ? mine : null);
  const album: YtShelfItem = {
    kind: "album",
    browseId: "MPREb_1",
    title: "Album",
    artists: ["Artist"],
    year: 2024,
    artworkUrl: null,
  };
  const playlist: YtShelfItem = {
    kind: "playlist",
    playlistId: "PL1",
    title: "Playlist",
    credit: "YouTube Music",
    artworkUrl: null,
  };
  const shelvesOf = (...shelves: YtShelf[]) => {
    const view = discoverView(loaded(home(...shelves)), { ...signedIn, find });
    assert.equal(view.kind, "shelves");
    return view.kind === "shelves" ? view.shelves : [];
  };

  test("a song the Library has plays its file; the others stream", () => {
    const [shelf] = shelvesOf(songShelf("Quick picks", song("a"), song("m", "Mine")));
    assert.deepEqual(shelf?.items, [
      { kind: "song", song: { source: "stream", song: song("a") } },
      { kind: "song", song: { source: "library", song: song("m", "Mine"), track: mine } },
    ]);
  });

  test("a shelf of songs is laid out as song rows, any other as tiles", () => {
    const [songs, mixed] = shelvesOf(songShelf("Quick picks", song("a")), {
      title: "Listen again",
      items: [{ kind: "song", song: song("b") }, album, playlist],
    });
    assert.equal(songs?.layout, "songs");
    assert.equal(mixed?.layout, "tiles");
  });

  test("tapping a song plays the shelf's songs from it", () => {
    const [shelf] = shelvesOf({
      title: "Listen again",
      items: [
        { kind: "song", song: song("a") },
        album,
        { kind: "song", song: song("m", "Mine") },
        playlist,
      ],
    });
    assert.ok(shelf !== undefined);
    assert.deepEqual(discoverItemAction(shelf, 2), {
      type: "play",
      songs: [
        { source: "stream", song: song("a") },
        { source: "library", song: song("m", "Mine"), track: mine },
      ],
      startIndex: 1,
    });
  });

  test("tapping an album or a playlist opens its songs", () => {
    const [shelf] = shelvesOf({ title: "For you", items: [album, playlist] });
    assert.ok(shelf !== undefined);
    assert.deepEqual(discoverItemAction(shelf, 0), {
      type: "openAlbum",
      browseId: "MPREb_1",
      title: "Album",
    });
    assert.deepEqual(discoverItemAction(shelf, 1), {
      type: "openPlaylist",
      playlistId: "PL1",
      title: "Playlist",
    });
    assert.equal(discoverItemAction(shelf, 2), null);
  });

  test("a song queues as the Library track it is, or as a YT Music song", () => {
    assert.equal(discoverTrackId({ source: "library", track: mine }), "7");
    assert.equal(discoverTrackId({ source: "stream", song: song("a") }), "yt:a");
  });
});

describe("discoverTileCaption", () => {
  test("an album's cover is captioned with its artists, then its year", () => {
    const album: YtShelfItem = {
      kind: "album",
      browseId: "MPREb_1",
      title: "Album",
      artists: ["A", "B"],
      year: 2024,
      artworkUrl: null,
    };
    assert.deepEqual(discoverTileCaption(album), { line: "A & B", detail: "Album · 2024" });
    assert.deepEqual(discoverTileCaption({ ...album, artists: [], year: null }), {
      line: "",
      detail: "Album",
    });
  });

  test("a playlist's is who made it, without YouTube's view count", () => {
    const playlist: YtShelfItem = {
      kind: "playlist",
      playlistId: "PL1",
      title: "2000's",
      credit: "Casa de Rodapé • 15M views",
      artworkUrl: null,
    };
    assert.deepEqual(discoverTileCaption(playlist), { line: "Casa de Rodapé", detail: "Playlist" });
    assert.deepEqual(discoverTileCaption({ ...playlist, credit: null }), {
      line: "",
      detail: "Playlist",
    });
  });

  test("a song's is its artists", () => {
    assert.deepEqual(discoverTileCaption({ kind: "song", song: song("a") }), {
      line: "Artist",
      detail: "Song",
    });
  });
});

describe("ytAlbumSongs", () => {
  test("an album page's tracks are songs on that album, with its cover", () => {
    const songs = ytAlbumSongs("MPREb_1", {
      title: "Random Access Memories",
      artists: ["Daft Punk"],
      year: 2013,
      artworkUrl: "https://lh3.googleusercontent.com/cover=w544-h544",
      tracks: [
        {
          videoId: "v1",
          title: "Give Life Back to Music",
          artists: ["Daft Punk"],
          trackNumber: 1,
          durationMs: 274_000,
          explicit: false,
        },
        {
          videoId: "v8",
          title: "Get Lucky",
          artists: ["Daft Punk", "Pharrell Williams"],
          trackNumber: 8,
          durationMs: null,
          explicit: true,
        },
      ],
    });
    assert.deepEqual(songs, [
      {
        videoId: "v1",
        title: "Give Life Back to Music",
        artists: ["Daft Punk"],
        album: "Random Access Memories",
        albumId: "MPREb_1",
        durationMs: 274_000,
        artworkUrl: "https://lh3.googleusercontent.com/cover=w544-h544",
        explicit: false,
      },
      {
        videoId: "v8",
        title: "Get Lucky",
        artists: ["Daft Punk", "Pharrell Williams"],
        album: "Random Access Memories",
        albumId: "MPREb_1",
        durationMs: null,
        artworkUrl: "https://lh3.googleusercontent.com/cover=w544-h544",
        explicit: true,
      },
    ]);
  });
});

describe("discoverView", () => {
  test("with YT Music off, Discover is off", () => {
    assert.deepEqual(discoverView(DISCOVER_START, { ...signedIn, enabled: false }), {
      kind: "off",
    });
  });

  test("signed out, Discover points to Sign In instead of asking YouTube", () => {
    assert.deepEqual(discoverView(DISCOVER_START, { ...signedIn, signedIn: false }), {
      kind: "signedOut",
    });
  });

  test("signed in, it loads until the shelves arrive, then shows them", () => {
    assert.equal(discoverView(DISCOVER_START, signedIn).kind, "loading");
    const view = discoverView(loaded(home(songShelf("Quick picks", song("a")))), signedIn);
    assert.equal(view.kind, "shelves");
    assert.deepEqual(view.kind === "shelves" ? view.shelves.map((shelf) => shelf.title) : [], [
      "Quick picks",
    ]);
  });

  test("offline, or when YouTube fails, it's a quiet empty state", () => {
    const asked = stepDiscover(DISCOVER_START, { type: "requested" });
    const offline = stepDiscover(asked, {
      type: "failed",
      request: asked.request,
      reason: "offline",
    });
    assert.deepEqual(discoverView(offline, signedIn), { kind: "offline" });
    const failed = stepDiscover(asked, {
      type: "failed",
      request: asked.request,
      reason: "failed",
    });
    assert.deepEqual(discoverView(failed, signedIn), { kind: "failed" });
  });

  test("a home without anything Wave can show is empty", () => {
    assert.deepEqual(discoverView(loaded(home(songShelf("Nothing"))), signedIn), {
      kind: "empty",
    });
  });
});
