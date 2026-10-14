import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  YT_ARTIST_SECTION_START,
  libraryAlbumFinder,
  pickYtArtist,
  stepYtArtistSection,
  ytArtistLookup,
  ytArtistQuery,
  ytArtistRelease,
  ytArtistIntegrated,
  ytArtistSectionView,
  ytAlbumTracklist,
  ytArtistShelves,
  ytLibraryAlbumView,
} from "./index.ts";
import type {
  YtArtistAlbum,
  YtArtistCandidate,
  YtArtistPage,
  YtArtistSaved,
  YtArtistSection,
  YtArtistSectionEvent,
  YtArtistShelf,
  YtReleaseLoad,
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

const integrated = (state: Section, context: { enabled?: boolean; now?: number } = {}) =>
  ytArtistIntegrated(state, {
    name: "Daft Punk",
    enabled: context.enabled ?? true,
    now: context.now ?? NOW,
  });

describe("ytArtistIntegrated", () => {
  test("the artist page is integrated while its YouTube Music answer shows", () => {
    assert.equal(integrated(restored(found(NOW - 6 * DAY))), true);
    const answered = step(
      restored(null),
      { type: "requested" },
      { type: "answered", saved: found(NOW) },
    );
    assert.equal(integrated(answered), true);
  });

  test("not with the button, while asking, after 'no match', a week on or with YT Music off", () => {
    assert.equal(integrated(YT_ARTIST_SECTION_START), false);
    assert.equal(integrated(restored(null)), false);
    assert.equal(integrated(step(restored(found(NOW - 8 * DAY)), { type: "requested" })), false);
    assert.equal(integrated(restored(unmatched(NOW))), false);
    assert.equal(integrated(restored(found(NOW - 8 * DAY))), false);
    assert.equal(integrated(restored(found(NOW)), { enabled: false }), false);
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

const titled = (title: string, browseId = title): YtArtistAlbum => ({
  ...release(browseId, 2013),
  title,
});

describe("ytArtistRelease", () => {
  const sempiternal = { title: "Sempiternal", albumArtistIds: [3] };
  const saved = (albums: YtArtistAlbum[], singles: YtArtistAlbum[] = []) =>
    ({ name: "Bring Me The Horizon", songs: [], albums, singles }) satisfies YtArtistPage;

  test("is the artist's release with the Library album's title, version notes aside", () => {
    const page = saved([
      titled("That's the Spirit"),
      titled("Sempiternal (Deluxe Edition)", "MPREb_semp"),
    ]);
    assert.equal(ytArtistRelease(page, 3, sempiternal)?.browseId, "MPREb_semp");
  });

  test("looks among the singles and EPs too, albums first", () => {
    const page = saved([titled("Sempiternal", "album")], [titled("Sempiternal", "single")]);
    assert.equal(ytArtistRelease(page, 3, sempiternal)?.browseId, "album");
    assert.equal(
      ytArtistRelease(saved([], [titled("Sempiternal", "ep")]), 3, sempiternal)?.browseId,
      "ep",
    );
  });

  test("is null when the page has no such release, or the album isn't the artist's", () => {
    assert.equal(ytArtistRelease(saved([titled("Sempiternal (Live)")]), 3, sempiternal), null);
    assert.equal(ytArtistRelease(saved([titled("Sempiternal")]), 4, sempiternal), null);
  });
});

interface Track {
  readonly id: number;
  readonly title: string;
  readonly artist: string;
  readonly durationMs: number;
  readonly trackNumber: number | null;
}

const track = (id: number, title: string, trackNumber: number | null): Track => ({
  id,
  title,
  artist: "Daft Punk",
  durationMs: 0,
  trackNumber,
});

const titledSong = (title: string): YtSong => ({ ...song(title), title });

const shape = (entries: readonly { source: string; number: number | null }[]) =>
  entries.map((entry) =>
    entry.source === "library"
      ? `${entry.number}:#${(entry as { track: Track }).track.id}`
      : `${entry.number}:${(entry as { song: YtSong }).song.title}`,
  );

describe("ytAlbumTracklist", () => {
  const release = ["Give Life Back", "The Game of Love", "Giorgio", "Within"].map(titledSong);
  const nowhere = () => null;

  test("the release's order: the album's own tracks where it has them, the rest streamed", () => {
    const tracks = [track(1, "Give Life Back", 1), track(3, "Giorgio", 3)];
    assert.deepEqual(shape(ytAlbumTracklist(release, tracks, nowhere)), [
      "1:#1",
      "2:The Game of Love",
      "3:#3",
      "4:Within",
    ]);
  });

  test("a song the album lacks but the Library has elsewhere is the Library's file", () => {
    const elsewhere = (s: YtSong) => (s.title === "Within" ? track(40, "Within", 9) : null);
    assert.deepEqual(shape(ytAlbumTracklist(release, [track(1, "Give Life Back", 1)], elsewhere)), [
      "1:#1",
      "2:The Game of Love",
      "3:Giorgio",
      "4:#40",
    ]);
  });

  test("the album's tracks the release doesn't list keep their place by number, or go last", () => {
    const tracks = [
      track(1, "Give Life Back", 1),
      track(7, "Hidden Track", 2),
      track(8, "Bonus", null),
    ];
    assert.deepEqual(shape(ytAlbumTracklist(release, tracks, nowhere)), [
      "1:#1",
      "2:The Game of Love",
      "2:#7",
      "3:Giorgio",
      "4:Within",
      "null:#8",
    ]);
  });

  test("a Library track stands for one song of the release only", () => {
    const twice = [titledSong("Giorgio"), titledSong("Giorgio")];
    assert.deepEqual(shape(ytAlbumTracklist(twice, [track(3, "Giorgio", 1)], nowhere)), [
      "1:#3",
      "2:Giorgio",
    ]);
  });
});

describe("a Library album's YT Music songs", () => {
  const RAM = { title: "Random Access Memories", albumArtistIds: [1] };
  const tracks = [track(1, "mine-1", 1), track(3, "mine-3", 3)];
  const songs = [song("mine-1"), song("give-life-back"), song("mine-3"), song("touch")];

  const albumView = (
    state: Section,
    context: {
      enabled?: boolean;
      now?: number;
      name?: string;
      artistId?: number;
      integrated?: boolean;
      releasePage?: YtReleaseLoad | undefined;
    } = {},
  ) => {
    const asked: string[] = [];
    const shown = ytLibraryAlbumView(state, {
      name: context.name ?? "Daft Punk",
      artistId: context.artistId ?? 1,
      album: RAM,
      tracks,
      elsewhere: () => null,
      enabled: context.enabled ?? true,
      now: context.now ?? NOW,
      integrated: context.integrated ?? true,
      releasePage: (release) => {
        asked.push(release.browseId);
        return "releasePage" in context ? context.releasePage : { status: "loaded", songs };
      },
    });
    return { shown, asked };
  };

  test("opened from a view that isn't integrated, it's the button, even with the artist's answer saved", () => {
    for (const state of [restored(found(NOW - DAY)), restored(null), restored(unmatched(NOW))]) {
      const { shown, asked } = albumView(state, { integrated: false });
      assert.deepEqual(shown, {
        tracks: null,
        songs: null,
        note: null,
        button: true,
        release: null,
        askArtist: false,
      });
      assert.deepEqual(asked, []);
    }
  });

  test("with the artist's answer saved, it reads the release's page and joins its songs to the tracks", () => {
    const { shown, asked } = albumView(restored(found(NOW - DAY)));
    assert.deepEqual(asked, ["MPREb_ram"]);
    assert.deepEqual(shape(shown?.tracks ?? []), ["1:#1", "2:give-life-back", "3:#3", "4:touch"]);
    assert.deepEqual(shown?.songs, songs);
    assert.equal(shown?.note, null);
    assert.equal(shown?.button, false);
    assert.equal(shown?.release?.browseId, "MPREb_ram");
  });

  test("loads quietly while the release's page is read, the album shown as it is", () => {
    for (const releasePage of [undefined, { status: "loading" } as const]) {
      const { shown } = albumView(restored(found(NOW)), { releasePage });
      assert.equal(shown?.tracks, null);
      assert.equal(shown?.note, "loading");
      assert.equal(shown?.button, false);
    }
  });

  test("with every song of the release in the Library, the album shows as it is", () => {
    const { shown } = albumView(restored(found(NOW)), {
      releasePage: { status: "loaded", songs: [song("mine-1"), song("mine-3")] },
    });
    assert.equal(shown?.tracks, null);
    assert.equal(shown?.note, null);
    assert.equal(shown?.button, false);
  });

  test("a release page that can't be read is a quiet line with the button to read it again", () => {
    const { shown } = albumView(restored(found(NOW)), {
      releasePage: { status: "quiet", reason: "offline" },
    });
    assert.equal(shown?.note, "offline");
    assert.equal(shown?.button, true);
    assert.equal(shown?.release?.browseId, "MPREb_ram");
  });

  test("not on the artist's page, or no artist matched: not found, and nothing is read", () => {
    const elsewhere = albumView(restored(withReleases([release("tron", 2010)], [])));
    assert.equal(elsewhere.shown?.note, "notFound");
    assert.equal(elsewhere.shown?.button, false);
    assert.deepEqual(elsewhere.asked, []);
    const nobody = albumView(restored(unmatched(NOW)));
    assert.equal(nobody.shown?.note, "notFound");
    assert.deepEqual(nobody.asked, []);
  });

  test("integrated with nothing saved, or a week on, it asks for the artist on its own", () => {
    for (const state of [restored(null), restored(found(NOW - 8 * DAY))]) {
      const { shown, asked } = albumView(state);
      assert.deepEqual(shown, {
        tracks: null,
        songs: null,
        note: "loading",
        button: false,
        release: null,
        askArtist: true,
      });
      assert.deepEqual(asked, []);
    }
  });

  test("asking for the artist loads, and a failure is a quiet line with the button", () => {
    const asking = step(restored(null), { type: "requested" });
    assert.equal(albumView(asking).shown?.note, "loading");
    assert.equal(albumView(asking).shown?.button, false);
    assert.equal(albumView(asking).shown?.askArtist, false);
    const failed = step(asking, { type: "failed", reason: "failed" });
    assert.equal(albumView(failed).shown?.note, "failed");
    assert.equal(albumView(failed).shown?.button, true);
    // Asked once: a failure waits for the button.
    assert.equal(albumView(failed).shown?.askArtist, false);
  });

  test("the artist's answer, once it comes, reads the release's page", () => {
    const answered = step(
      restored(null),
      { type: "requested" },
      { type: "answered", saved: found(NOW) },
    );
    const { shown, asked } = albumView(answered);
    assert.deepEqual(asked, ["MPREb_ram"]);
    assert.equal(shown?.askArtist, false);
    assert.deepEqual(shape(shown?.tracks ?? []), ["1:#1", "2:give-life-back", "3:#3", "4:touch"]);
  });

  test("nothing with YT Music off, for names that aren't an artist, and until what was saved is read", () => {
    assert.equal(albumView(restored(found(NOW)), { enabled: false }).shown, null);
    assert.equal(albumView(restored(found(NOW)), { name: "Various Artists" }).shown, null);
    assert.equal(albumView(YT_ARTIST_SECTION_START).shown, null);
  });
});
