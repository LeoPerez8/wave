import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  YT_ARTIST_SECTION_START,
  stepYtArtistSection,
  libraryArtistNamed,
  ytArtistPageAsks,
  ytArtistPageView,
} from "./index.ts";
import type {
  YtArtistAlbum,
  YtArtistSaved,
  YtArtistSection,
  YtArtistSectionEvent,
  YtSong,
} from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;

const song = (videoId: string): YtSong => ({
  videoId,
  title: videoId,
  artists: ["Daft Punk"],
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
});

const release = (browseId: string, year: number | null): YtArtistAlbum => ({
  kind: "album",
  browseId,
  title: browseId,
  artists: ["Daft Punk"],
  year,
  artworkUrl: null,
});

const found = (
  checkedAt: number,
  songs: YtSong[] = [song("a")],
  releases: { albums?: YtArtistAlbum[]; singles?: YtArtistAlbum[] } = {},
): YtArtistSaved => ({
  outcome: "found",
  checkedAt,
  browseId: "UCdaftpunk",
  page: {
    name: "Daft Punk",
    artworkUrl: "https://lh3.googleusercontent.com/daftpunk",
    songs,
    albums: releases.albums ?? [],
    singles: releases.singles ?? [],
  },
});

type Page = YtArtistSection;

const step = (state: Page, ...events: YtArtistSectionEvent[]): Page =>
  events.reduce(stepYtArtistSection<YtSong>, state);

const restored = (saved: YtArtistSaved | null): Page =>
  step(YT_ARTIST_SECTION_START, { type: "restored", saved });

const asks = (state: Page, context: { enabled?: boolean; now?: number } = {}) =>
  ytArtistPageAsks(state, { enabled: context.enabled ?? true, now: context.now ?? NOW });

describe("when a YouTube Music artist page asks YouTube Music", () => {
  test("opened with nothing saved, it asks at once, with no tap", () => {
    assert.equal(asks(restored(null)), true);
  });

  test("an answer saved less than a week ago is shown instead; an older one is asked again", () => {
    assert.equal(asks(restored(found(NOW - 6 * DAY))), false);
    assert.equal(asks(restored(found(NOW - 8 * DAY))), true);
  });

  test("after a failure it waits for Try Again; the tap asks, and a new failure waits again", () => {
    const failed = step(
      restored(null),
      { type: "requested" },
      { type: "failed", reason: "offline" },
    );
    assert.equal(asks(failed), false);
    const retried = step(failed, { type: "requested" });
    assert.equal(asks(retried), false);
    assert.equal(asks(step(retried, { type: "failed", reason: "failed" })), false);
  });

  test("never while what was saved is being read, or while it's already asking", () => {
    assert.equal(asks(YT_ARTIST_SECTION_START), false);
    assert.equal(asks(step(restored(null), { type: "requested" })), false);
  });

  test("never with YT Music off; turned back on, it asks", () => {
    assert.equal(asks(restored(null), { enabled: false }), false);
    const off = step(restored(null), { type: "requested" }, { type: "failed", reason: "disabled" });
    assert.equal(asks(off, { enabled: false }), false);
    assert.equal(asks(off), true);
  });
});

/** The Library has the songs whose video id starts with "mine", as track "lib-<id>". */
const librarySong = (s: YtSong) => (s.videoId.startsWith("mine") ? `lib-${s.videoId}` : null);

/** The Library has the releases whose browse id starts with "mine", as album 7. */
const libraryAlbum = (album: YtArtistAlbum) =>
  album.browseId.startsWith("mine") ? { id: 7 } : null;

const view = (state: Page, context: { enabled?: boolean; now?: number } = {}) =>
  ytArtistPageView(state, {
    enabled: context.enabled ?? true,
    now: context.now ?? NOW,
    librarySong,
    libraryAlbum,
  });

describe("what a YouTube Music artist page shows", () => {
  test("the artist's image, name and top songs in YouTube's order; the Library's play its files", () => {
    const shown = view(restored(found(NOW, [song("b"), song("mine1"), song("a")])));
    assert.equal(shown.name, "Daft Punk");
    assert.equal(shown.artworkUrl, "https://lh3.googleusercontent.com/daftpunk");
    assert.deepEqual(shown.songs, [
      { source: "stream", song: song("b") },
      { source: "library", song: song("mine1"), track: "lib-mine1" },
      { source: "stream", song: song("a") },
    ]);
    assert.equal(shown.note, null);
    assert.equal(shown.retry, false);
  });

  test("their Albums then Singles & EPs, newest first; a release the Library has is its album", () => {
    const shown = view(
      restored(
        found(NOW, [], {
          albums: [release("homework", 1997), release("mine-ram", 2013), release("tron", null)],
          singles: [release("lucky", 2013)],
        }),
      ),
    );
    assert.deepEqual(
      shown.shelves.map((shelf) => [
        shelf.kind,
        shelf.releases.map((entry) => [entry.album.browseId, entry.library]),
      ]),
      [
        [
          "albums",
          [
            ["mine-ram", { id: 7 }],
            ["homework", null],
            ["tron", null],
          ],
        ],
        ["singles", [["lucky", null]]],
      ],
    );
  });

  test("while it asks, a quiet line says it's looking, also from opening until the ask goes out", () => {
    for (const state of [restored(null), step(restored(null), { type: "requested" })]) {
      const shown = view(state);
      assert.equal(shown.note, "loading");
      assert.equal(shown.retry, false);
      assert.deepEqual(shown.songs, []);
    }
  });

  test("offline or failing, a quiet line with Try Again, and nothing saved shows", () => {
    for (const reason of ["offline", "failed"] as const) {
      const failed = step(restored(null), { type: "requested" }, { type: "failed", reason });
      assert.deepEqual(view(failed), {
        name: null,
        artworkUrl: null,
        songs: [],
        shelves: [],
        note: reason,
        retry: true,
      });
    }
  });

  test("with YT Music off it says so instead of asking, saved answer or not", () => {
    for (const state of [restored(null), restored(found(NOW)), restored(found(NOW - 8 * DAY))]) {
      const shown = view(state, { enabled: false });
      assert.equal(shown.note, "off");
      assert.equal(shown.retry, false);
      assert.deepEqual(shown.songs, []);
      assert.deepEqual(shown.shelves, []);
    }
  });

  test("an answer a week old isn't shown: the page asks again, keeping the artist's name meanwhile", () => {
    const shown = view(restored(found(NOW - 8 * DAY)));
    assert.equal(shown.note, "loading");
    assert.deepEqual(shown.songs, []);
    assert.equal(shown.name, "Daft Punk");
  });
});

describe("libraryArtistNamed", () => {
  const artists = [
    { id: 1, name: "Beatles" },
    { id: 2, name: "Björk" },
    { id: 3, name: "Unknown Artist" },
  ];

  test("is the Library artist whose name matches as artist photos compare names", () => {
    assert.equal(libraryArtistNamed("The Beatles", artists)?.id, 1);
    assert.equal(libraryArtistNamed("bjork", artists)?.id, 2);
  });

  test("is null for anyone else, and for names that aren't an artist", () => {
    assert.equal(libraryArtistNamed("Daft Punk", artists), null);
    assert.equal(libraryArtistNamed("Unknown Artist", artists), null);
  });
});
