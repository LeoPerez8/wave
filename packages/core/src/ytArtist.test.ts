import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  YT_ARTIST_SECTION_START,
  libraryAlbumFinder,
  pickYtArtist,
  stepYtArtistSection,
  ytArtistLookup,
  ytArtistQuery,
  ytArtistSectionView,
  ytArtistShelves,
} from "./index.ts";
import type {
  YtArtistAlbum,
  YtArtistCandidate,
  YtArtistPage,
  YtArtistSaved,
  YtArtistSection,
  YtArtistSectionEvent,
  YtArtistShelf,
  YtSong,
} from "./index.ts";

describe("ytArtistQuery", () => {
  test("is the artist's name to search YouTube Music for, tidied", () => {
    assert.equal(ytArtistQuery("  Daft   Punk "), "Daft Punk");
  });

  test("is null for names that aren't an artist: they get no button", () => {
    for (const name of ["Various Artists", "Unknown Artist", "V/A", "!!!", ""])
      assert.equal(ytArtistQuery(name), null, name);
  });
});

const candidate = (name: string, browseId: string, audience: number | null): YtArtistCandidate => ({
  name,
  browseId,
  audience,
});

describe("pickYtArtist", () => {
  test("is the artist whose name matches as artist photos compare names", () => {
    const candidates = [
      candidate("The Weeknd", "UCweeknd", 238_000_000),
      candidate("Beatles", "UCbeatles", 1_000),
    ];
    assert.equal(pickYtArtist("The Beatles", candidates), "UCbeatles");
    assert.equal(
      pickYtArtist("Simon and Garfunkel", [candidate("Simon & Garfunkel", "UCsg", 5)]),
      "UCsg",
    );
    assert.equal(pickYtArtist("Bjork", [candidate("Björk", "UCbjork", null)]), "UCbjork");
  });

  test("only an exact match counts", () => {
    const candidates = [
      candidate("Daft Punk's Karaoke Band", "UCkaraoke", 3),
      candidate("Daft Punk Experience", "UCexperience", 22),
    ];
    assert.equal(pickYtArtist("Daft Punk", candidates), null);
    assert.equal(pickYtArtist("Daft Punk", []), null);
  });

  test("among namesakes the most followed wins, whatever YouTube's order", () => {
    const candidates = [
      candidate("Nirvana", "UCsmall", 2_400),
      candidate("Kurt Cobain", "UCkurt", 505_000),
      candidate("nirvana", "UCunknown", null),
      candidate("Nirvana", "UCbig", 55_500_000),
    ];
    assert.equal(pickYtArtist("Nirvana", candidates), "UCbig");
  });

  test("names that aren't an artist never match", () => {
    assert.equal(pickYtArtist("Various Artists", [candidate("Various Artists", "UCva", 9)]), null);
  });
});

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

const page = (songs: YtSong[]): YtArtistPage => ({
  name: "Daft Punk",
  songs,
  albums: [
    {
      kind: "album",
      browseId: "MPREb_ram",
      title: "Random Access Memories",
      artists: ["Daft Punk"],
      year: 2013,
      artworkUrl: null,
    },
  ],
  singles: [],
});

const found = (checkedAt: number, songs: YtSong[] = [song("a")]): YtArtistSaved => ({
  outcome: "found",
  checkedAt,
  browseId: "UCdaftpunk",
  page: page(songs),
});

const unmatched = (checkedAt: number): YtArtistSaved => ({ outcome: "unmatched", checkedAt });

describe("ytArtistLookup", () => {
  test("first time, the artist is searched for by name", () => {
    assert.deepEqual(ytArtistLookup(" Daft  Punk", null), { kind: "search", query: "Daft Punk" });
  });

  test("a saved match skips the search and reads the artist's page again", () => {
    assert.deepEqual(ytArtistLookup("Daft Punk", found(NOW - 8 * DAY)), {
      kind: "page",
      browseId: "UCdaftpunk",
    });
  });

  test("a saved 'no match' searches again", () => {
    assert.deepEqual(ytArtistLookup("Daft Punk", unmatched(NOW - 8 * DAY)), {
      kind: "search",
      query: "Daft Punk",
    });
  });

  test("a name that isn't an artist asks nothing", () => {
    assert.equal(ytArtistLookup("Unknown Artist", null), null);
  });
});

type Section = YtArtistSection;

const step = (state: Section, ...events: YtArtistSectionEvent[]): Section =>
  events.reduce(stepYtArtistSection<YtSong>, state);

const restored = (saved: YtArtistSaved | null): Section =>
  step(YT_ARTIST_SECTION_START, { type: "restored", saved });

const inLibrary = (s: YtSong): boolean => s.videoId.startsWith("mine");

const view = (state: Section, context: { name?: string; enabled?: boolean; now?: number } = {}) =>
  ytArtistSectionView(state, {
    name: context.name ?? "Daft Punk",
    enabled: context.enabled ?? true,
    now: context.now ?? NOW,
    inLibrary,
  });

const BUTTON = { songs: [], note: null, button: true };

describe("the artist page's YT Music section", () => {
  test("shows nothing until what was saved has been read", () => {
    assert.equal(view(YT_ARTIST_SECTION_START), null);
  });

  test("with nothing saved it's the button, and nothing is asked", () => {
    assert.deepEqual(view(restored(null)), BUTTON);
  });

  test("tapping loads, without the button meanwhile", () => {
    assert.deepEqual(view(step(restored(null), { type: "requested" })), {
      songs: [],
      note: "loading",
      button: false,
    });
  });

  test("the answer shows the top songs the Library doesn't have, in YouTube's order", () => {
    const answered = step(
      restored(null),
      { type: "requested" },
      { type: "answered", saved: found(NOW, [song("b"), song("mine1"), song("a")]) },
    );
    assert.deepEqual(view(answered), { songs: [song("b"), song("a")], note: null, button: false });
  });

  test("says so quietly when the Library has every top song, or there are none", () => {
    assert.deepEqual(view(restored(found(NOW, [song("mine1"), song("mine2")]))), {
      songs: [],
      note: "allInLibrary",
      button: false,
    });
    assert.deepEqual(view(restored(found(NOW, []))), { songs: [], note: "noSongs", button: false });
  });

  test("a saved section shows straight away for a week, then the button comes back", () => {
    const saved = restored(found(NOW - 6 * DAY, [song("a")]));
    assert.deepEqual(view(saved), { songs: [song("a")], note: null, button: false });
    assert.deepEqual(view(saved, { now: NOW + DAY }), BUTTON);
  });

  test("'no match' is a quiet line for a week, then the button comes back", () => {
    const saved = restored(unmatched(NOW - DAY));
    assert.deepEqual(view(saved), { songs: [], note: "notFound", button: false });
    assert.deepEqual(view(saved, { now: NOW + 6 * DAY }), BUTTON);
  });

  test("offline or failing, a quiet line with the button to try again", () => {
    const failed = step(
      restored(null),
      { type: "requested" },
      { type: "failed", reason: "offline" },
    );
    assert.deepEqual(view(failed), { songs: [], note: "offline", button: true });
    const again = step(failed, { type: "requested" }, { type: "failed", reason: "failed" });
    assert.deepEqual(view(again), { songs: [], note: "failed", button: true });
  });

  test("a failure keeps what was saved before", () => {
    const expired = found(NOW - 8 * DAY);
    const failed = step(
      restored(expired),
      { type: "requested" },
      { type: "failed", reason: "failed" },
    );
    assert.deepEqual(failed, { status: "ready", saved: expired, failure: "failed" });
  });

  test("turned off meanwhile, it goes back to the button without a line", () => {
    const off = step(restored(null), { type: "requested" }, { type: "failed", reason: "disabled" });
    assert.deepEqual(view(off), BUTTON);
  });

  test("YT Music off hides it all, saved section included", () => {
    assert.equal(view(restored(found(NOW)), { enabled: false }), null);
    assert.equal(view(restored(null), { enabled: false }), null);
  });

  test("Unknown Artist and Various Artists get no section", () => {
    assert.equal(view(restored(null), { name: "Unknown Artist" }), null);
    assert.equal(view(restored(null), { name: "Various Artists" }), null);
  });

  test("what was saved is read once: a late read doesn't undo an answer", () => {
    const answered = step(
      restored(null),
      { type: "requested" },
      { type: "answered", saved: found(NOW) },
    );
    assert.deepEqual(step(answered, { type: "restored", saved: null }), answered);
  });
});

const DAFT_PUNK = 1;
const PHARRELL = 2;
const JUSTICE = 3;

const libraryAlbum = (id: number, title: string, albumArtistIds: number[] = [DAFT_PUNK]) => ({
  id,
  title,
  albumArtistIds,
});

describe("libraryAlbumFinder", () => {
  test("a release is the artist's Library album with its title, case, accents and punctuation aside", () => {
    const find = libraryAlbumFinder(DAFT_PUNK, [
      libraryAlbum(1, "Homework"),
      libraryAlbum(2, "Random Access Memories"),
      libraryAlbum(3, "Alive 1997"),
    ]);
    assert.equal(find({ title: "random access memories" })?.id, 2);
    assert.equal(find({ title: "Homéwork!" })?.id, 1);
    assert.equal(find({ title: "Discovery" }), null);
  });

  test("version notes aside: a deluxe or remastered edition is the album the Library has", () => {
    const find = libraryAlbumFinder(DAFT_PUNK, [
      libraryAlbum(1, "Discovery (Remastered 2021)"),
      libraryAlbum(2, "Random Access Memories"),
      libraryAlbum(3, "Get Lucky - Single"),
    ]);
    assert.equal(find({ title: "Discovery" })?.id, 1);
    assert.equal(find({ title: "Random Access Memories (10th Anniversary Edition)" })?.id, 2);
    assert.equal(find({ title: "Random Access Memories [Deluxe]" })?.id, 2);
    assert.equal(find({ title: "Random Access Memories - Expanded Version" })?.id, 2);
    assert.equal(find({ title: "Get Lucky" })?.id, 3);
  });

  test("a live album or a remix album is another release", () => {
    const find = libraryAlbumFinder(DAFT_PUNK, [libraryAlbum(1, "Human After All")]);
    assert.equal(find({ title: "Human After All (Remixes)" }), null);
    assert.equal(find({ title: "Human After All (Live)" }), null);
  });

  test("a collaboration is each credited artist's, and another artist's namesake album is not", () => {
    const albums = [
      libraryAlbum(1, "Get Lucky", [DAFT_PUNK, PHARRELL]),
      libraryAlbum(2, "Cross", [JUSTICE]),
    ];
    assert.equal(libraryAlbumFinder(PHARRELL, albums)({ title: "Get Lucky" })?.id, 1);
    assert.equal(libraryAlbumFinder(DAFT_PUNK, albums)({ title: "Get Lucky" })?.id, 1);
    assert.equal(libraryAlbumFinder(DAFT_PUNK, albums)({ title: "Cross" }), null);
  });

  test("a featured credit in the title is set aside like a version note", () => {
    const find = libraryAlbumFinder(DAFT_PUNK, [
      libraryAlbum(1, "Get Lucky (feat. Pharrell Williams)"),
    ]);
    assert.equal(find({ title: "Get Lucky" })?.id, 1);
    assert.equal(find({ title: "Get Lucky [with Pharrell Williams & Nile Rodgers]" })?.id, 1);
  });
});

const release = (browseId: string, year: number | null): YtArtistAlbum => ({
  kind: "album",
  browseId,
  title: browseId,
  artists: ["Daft Punk"],
  year,
  artworkUrl: null,
});

const withReleases = (
  albums: YtArtistAlbum[],
  singles: YtArtistAlbum[],
  checkedAt = NOW,
): YtArtistSaved => ({
  outcome: "found",
  checkedAt,
  browseId: "UCdaftpunk",
  page: { name: "Daft Punk", songs: [], albums, singles },
});

/** The Library has the releases whose id starts with "mine", as album 7. */
const inLibraryAlbum = (album: YtArtistAlbum) =>
  album.browseId.startsWith("mine") ? { id: 7 } : null;

const shelves = (state: Section, context: { enabled?: boolean; now?: number } = {}) =>
  ytArtistShelves(state, {
    name: "Daft Punk",
    enabled: context.enabled ?? true,
    now: context.now ?? NOW,
    libraryAlbum: inLibraryAlbum,
  });

const titlesOf = (shelf: YtArtistShelf<unknown> | undefined) =>
  shelf?.releases.map((entry) => entry.album.browseId);

describe("the YT Music section's albums and singles", () => {
  test("lists Albums then Singles & EPs, each newest first, undated last", () => {
    const state = restored(
      withReleases(
        [
          release("homework", 1997),
          release("ram", 2013),
          release("tron", null),
          release("discovery", 2001),
        ],
        [release("lucky", 2013), release("touch", 2023)],
      ),
    );
    const [albums, singles] = shelves(state);
    assert.equal(albums?.kind, "albums");
    assert.deepEqual(titlesOf(albums), ["ram", "discovery", "homework", "tron"]);
    assert.equal(singles?.kind, "singles");
    assert.deepEqual(titlesOf(singles), ["touch", "lucky"]);
  });

  test("a shelf with nothing on it is left out", () => {
    const albumsOnly = shelves(restored(withReleases([release("ram", 2013)], [])));
    assert.deepEqual(
      albumsOnly.map((shelf) => shelf.kind),
      ["albums"],
    );
    const singlesOnly = shelves(restored(withReleases([], [release("lucky", 2013)])));
    assert.deepEqual(
      singlesOnly.map((shelf) => shelf.kind),
      ["singles"],
    );
    assert.deepEqual(shelves(restored(withReleases([], []))), []);
  });

  test("a release the Library has carries its Library album; the others carry none", () => {
    const [albums] = shelves(
      restored(withReleases([release("mine-ram", 2013), release("tron", 2010)], [])),
    );
    assert.deepEqual(
      albums?.releases.map((entry) => entry.library),
      [{ id: 7 }, null],
    );
  });

  test("they show while the saved page does: a week, YT Music on, not while asking again", () => {
    const saved = restored(withReleases([release("ram", 2013)], [], NOW - 6 * DAY));
    assert.equal(shelves(saved).length, 1);
    assert.deepEqual(shelves(saved, { now: NOW + DAY }), []);
    assert.deepEqual(shelves(saved, { enabled: false }), []);
    assert.deepEqual(shelves(step(restored(null), { type: "requested" })), []);
    assert.deepEqual(shelves(restored(unmatched(NOW))), []);
  });
});
