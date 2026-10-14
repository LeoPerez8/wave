import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  YT_ARTIST_SECTION_START,
  pickYtArtist,
  stepYtArtistSection,
  ytArtistLookup,
  ytArtistQuery,
  ytArtistSectionView,
} from "./index.ts";
import type {
  YtArtistCandidate,
  YtArtistPage,
  YtArtistSaved,
  YtArtistSection,
  YtArtistSectionEvent,
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
