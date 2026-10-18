import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  YT_SEARCH_DEBOUNCE_MS,
  YT_SECTION_HIDDEN,
  libraryArtistFinder,
  libraryReleaseFinder,
  stepYtSection,
  ytSearchQuery,
  ytSectionToggle,
  ytSectionView,
  ytSearchArtistReads,
  ytSearchArtistSongs,
  YT_SEARCH_ARTISTS_UNKNOWN,
  ytArtistSavedStands,
  ytSearchArtistToRead,
  ytSearchArtistsKnownAfter,
  ytSearchTopArtistSongs,
} from "./index.ts";
import type {
  YtArtistAlbum,
  YtArtistCandidate,
  YtArtistSaved,
  YtSection,
  YtSong,
} from "./index.ts";

const song = (videoId: string): YtSong => ({
  videoId,
  title: videoId,
  artists: ["Artist"],
  album: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

const artist = (name: string): YtArtistCandidate => ({
  name,
  browseId: `UC${name}`,
  audience: null,
  artworkUrl: null,
});

const album = (title: string, ...artists: string[]): YtArtistAlbum => ({
  kind: "album",
  browseId: `MPREb_${title}`,
  title,
  artists,
  year: null,
  artworkUrl: null,
});

/** No artists or albums: what YT Music found is only songs. */
const NONE = { artists: [], albums: [] } as const;

/** Typing [query]; by default the Library has nothing for it, so YT Music is asked on its own. */
const typed = (
  state: YtSection,
  query: string,
  enabled = true,
  libraryHasResults = false,
): YtSection => stepYtSection(state, { type: "typed", query, enabled, libraryHasResults });

/** Online picked on the toggle. */
const ONLINE = { type: "picked", pick: "online" } as const;

/** Typing [query] that the Library has results for. */
const typedFound = (state: YtSection, query: string): YtSection => typed(state, query, true, true);

/** The Library has the song "mine", the artist "Mine" and the album "Mine". */
const library = {
  hasSong: (s: YtSong): boolean => s.videoId === "mine",
  hasArtist: (a: YtArtistCandidate): boolean => a.name === "Mine",
  hasAlbum: (a: YtArtistAlbum): boolean => a.title === "Mine",
};

const results = (
  songs: YtSong[],
  artists: YtArtistCandidate[] = [],
  albums: YtArtistAlbum[] = [],
  query = "q",
): YtSection => ({ status: "results", query, songs, artists, albums, by: "user" });

/** Nothing shown: what a section with no results of its own shows. */
const EMPTY = { songs: [], artists: [], albums: [], top: null };

describe("ytSectionView", () => {
  test("shows the songs that aren't in the Library, in YT Music's order", () => {
    const view = ytSectionView(results([song("b"), song("mine"), song("a")]), library);
    assert.deepEqual(view?.songs, [song("b"), song("a")]);
    assert.equal(view?.note, null);
  });

  test("shows the artists and albums the Library lacks, in YT Music's order", () => {
    const view = ytSectionView(
      results(
        [],
        [artist("Daft Punk"), artist("Mine"), artist("Justice")],
        [album("Mine", "Me"), album("Discovery", "Daft Punk"), album("Cross", "Justice")],
      ),
      library,
    );
    assert.deepEqual(view?.artists, [artist("Daft Punk"), artist("Justice")]);
    assert.deepEqual(view?.albums, [album("Discovery", "Daft Punk"), album("Cross", "Justice")]);
    assert.equal(view?.note, null);
  });

  test("says when YT Music has nothing, or nothing the Library lacks", () => {
    assert.deepEqual(ytSectionView(results([]), library), {
      ...EMPTY,
      note: "noMatches",
      loading: false,
      integrated: true,
    });
    const mine = results([song("mine")], [artist("Mine")], [album("Mine", "Me")]);
    assert.deepEqual(ytSectionView(mine, library), {
      ...EMPTY,
      note: "allInLibrary",
      loading: false,
      integrated: true,
    });
  });

  test("while the query loads, it shows a skeleton and no line", () => {
    const first: YtSection = { status: "loading", query: "q", by: "user", delayMs: 0 };
    assert.deepEqual(ytSectionView(first, library), {
      ...EMPTY,
      note: null,
      loading: true,
      integrated: true,
    });
  });

  test("results and outcomes show no skeleton", () => {
    assert.equal(ytSectionView(results([song("a")]), library)?.loading, false);
    assert.equal(ytSectionView(results([]), library)?.loading, false);
    const quiet: YtSection = { status: "quiet", query: "q", reason: "failed", by: "user" };
    assert.equal(ytSectionView(quiet, library)?.loading, false);
  });

  test("a failure is a quiet note, and Search isn't integrated", () => {
    const quiet: YtSection = { status: "quiet", query: "q", reason: "offline", by: "user" };
    assert.deepEqual(ytSectionView(quiet, library), {
      ...EMPTY,
      note: "offline",
      loading: false,
      integrated: false,
    });
  });

  test("shows nothing while nothing is asked, and isn't integrated", () => {
    const offered: YtSection = { status: "offered", query: "q", picked: false, kept: null };
    assert.deepEqual(ytSectionView(offered, library), {
      ...EMPTY,
      note: null,
      loading: false,
      integrated: false,
    });
  });

  test("a hidden section, or one with too little typed, shows nothing", () => {
    assert.equal(ytSectionView(YT_SECTION_HIDDEN, library), null);
    assert.equal(ytSectionView({ status: "idle", pick: "online" }, library), null);
  });

  test("YT Music's best is the result shown that matches the query best, artists first", () => {
    const lucky = { ...song("lucky"), title: "Get Lucky", artists: ["Daft Punk"] };
    const answer = (query: string) =>
      results(
        [lucky],
        [artist("Daft Punk")],
        [album("Random Access Memories", "Daft Punk")],
        query,
      );
    assert.deepEqual(ytSectionView(answer("daft punk"), library)?.top, {
      kind: "artist",
      artist: artist("Daft Punk"),
    });
    assert.deepEqual(ytSectionView(answer("get lucky"), library)?.top, {
      kind: "song",
      song: lucky,
    });
    assert.deepEqual(ytSectionView(answer("random access"), library)?.top, {
      kind: "album",
      album: album("Random Access Memories", "Daft Punk"),
    });
  });

  test("with nothing matching the query word for word, YT Music's best is its first song", () => {
    const halo = { ...song("halo"), title: "Halo", artists: ["Beyoncé"] };
    const view = ytSectionView(results([halo], [artist("Beyoncé")], [], "beyonse"), library);
    assert.deepEqual(view?.top, { kind: "song", song: halo });
    const noSongs = ytSectionView(results([], [artist("Beyoncé")], [], "beyonse"), library);
    assert.deepEqual(noSongs?.top, { kind: "artist", artist: artist("Beyoncé") });
  });

  test("YT Music's best is never something the Library has", () => {
    const view = ytSectionView(
      results([], [artist("Mine"), artist("Minnie")], [], "mine"),
      library,
    );
    assert.deepEqual(view?.top, { kind: "artist", artist: artist("Minnie") });
  });

  test("a changed query swaps the last query's results for a skeleton at once", () => {
    const dafto = { ...song("dafto"), title: "Dafto" };
    const shown = stepYtSection(typed(YT_SECTION_HIDDEN, "dafto"), {
      type: "found",
      query: "dafto",
      songs: [dafto],
      artists: [artist("Dafto")],
      albums: [album("Dafto", "Dafto")],
    });
    assert.deepEqual(ytSectionView(shown, library)?.top, {
      kind: "artist",
      artist: artist("Dafto"),
    });
    assert.deepEqual(ytSectionView(typed(shown, "daft punk"), library), {
      ...EMPTY,
      note: null,
      loading: true,
      integrated: true,
    });
  });
});

describe("ytSearchQuery", () => {
  test("is what's typed, tidied", () => {
    assert.equal(ytSearchQuery("  daft   punk "), "daft punk");
  });

  test("is null until there's enough to search for", () => {
    for (const text of ["", "   ", "d"]) assert.equal(ytSearchQuery(text), null, text);
  });
});

describe("stepYtSection", () => {
  test("typing a query the Library has results for asks nothing", () => {
    assert.deepEqual(typedFound(YT_SECTION_HIDDEN, "daft"), {
      status: "offered",
      query: "daft",
      picked: false,
      kept: null,
    });
  });

  test("Online asks for the typed query at once", () => {
    const asked = stepYtSection(typedFound(YT_SECTION_HIDDEN, "daft"), ONLINE);
    assert.deepEqual(asked, {
      status: "loading",
      query: "daft",
      by: "user",
      delayMs: 0,
    });
  });

  test("once asked, refining the query drops YT Music's songs and asks for the new one", () => {
    const asked = stepYtSection(typedFound(YT_SECTION_HIDDEN, "daft"), ONLINE);
    const shown = stepYtSection(asked, {
      type: "found",
      query: "daft",
      songs: [song("a")],
      ...NONE,
    });
    assert.deepEqual(typedFound(shown, "daft punk"), {
      status: "loading",
      query: "daft punk",
      by: "user",
      delayMs: 300,
    });
  });

  test("asked on its own, YT Music is let go once the Library has results again", () => {
    const shown = stepYtSection(typed(YT_SECTION_HIDDEN, "dafy"), {
      type: "found",
      query: "dafy",
      songs: [song("a")],
      ...NONE,
    });
    assert.deepEqual(typedFound(shown, "daf"), {
      status: "offered",
      query: "daf",
      picked: false,
      kept: { query: "dafy", songs: [song("a")], ...NONE },
    });
  });

  test("clearing the field ends what the user asked for", () => {
    const asked = stepYtSection(typedFound(YT_SECTION_HIDDEN, "daft"), ONLINE);
    assert.deepEqual(typedFound(asked, ""), { status: "idle", pick: null });
    assert.deepEqual(typedFound(typedFound(asked, ""), "daft"), {
      status: "offered",
      query: "daft",
      picked: false,
      kept: null,
    });
  });

  test("with YT Music off nothing is shown, and asking does nothing", () => {
    const off = typed(YT_SECTION_HIDDEN, "daft", false, true);
    assert.equal(off, YT_SECTION_HIDDEN);
    assert.equal(stepYtSection(off, ONLINE), YT_SECTION_HIDDEN);
    const asked = stepYtSection(typedFound(YT_SECTION_HIDDEN, "daft"), ONLINE);
    assert.equal(typed(asked, "daft", false, true), YT_SECTION_HIDDEN);
  });

  test("typing a query the Library has nothing for asks YT Music on its own, once typing pauses", () => {
    assert.deepEqual(typed(YT_SECTION_HIDDEN, "daft"), {
      status: "loading",
      query: "daft",
      by: "auto",
      delayMs: 300,
    });
  });

  test("the results for the query being loaded are shown", () => {
    const loading = typed(YT_SECTION_HIDDEN, "daft");
    const found = stepYtSection(loading, {
      type: "found",
      query: "daft",
      songs: [song("a")],
      ...NONE,
    });
    assert.deepEqual(found, {
      status: "results",
      query: "daft",
      songs: [song("a")],
      ...NONE,
      by: "auto",
    });
  });

  test("the artists and albums found for the query join its songs", () => {
    const found = stepYtSection(typed(YT_SECTION_HIDDEN, "daft"), {
      type: "found",
      query: "daft",
      songs: [song("a")],
      artists: [artist("Daft Punk")],
      albums: [album("Discovery", "Daft Punk")],
    });
    assert.deepEqual(found, {
      status: "results",
      query: "daft",
      songs: [song("a")],
      artists: [artist("Daft Punk")],
      albums: [album("Discovery", "Daft Punk")],
      by: "auto",
    });
    assert.deepEqual(typed(found, "daft p"), {
      status: "loading",
      query: "daft p",
      by: "auto",
      delayMs: 300,
    });
  });

  test("results that arrive after the query changed are dropped", () => {
    const loading = typed(typed(YT_SECTION_HIDDEN, "daft"), "daft punk");
    const stale = stepYtSection(loading, {
      type: "found",
      query: "daft",
      songs: [song("a")],
      ...NONE,
    });
    assert.equal(stale, loading);
    const staleFailure = stepYtSection(loading, {
      type: "failed",
      query: "daft",
      reason: "offline",
    });
    assert.equal(staleFailure, loading);
  });

  test("while the next query loads, the last results are gone", () => {
    const shown = stepYtSection(typed(YT_SECTION_HIDDEN, "daft"), {
      type: "found",
      query: "daft",
      songs: [song("a")],
      ...NONE,
    });
    assert.deepEqual(typed(shown, "daft punk"), {
      status: "loading",
      query: "daft punk",
      by: "auto",
      delayMs: 300,
    });
  });

  test("the same query, however it's spaced, isn't loaded again", () => {
    const shown = stepYtSection(typed(YT_SECTION_HIDDEN, "daft"), {
      type: "found",
      query: "daft",
      songs: [song("a")],
      ...NONE,
    });
    assert.equal(typed(shown, " daft "), shown);
  });

  test("a failed request leaves a quiet line saying why", () => {
    const loading = typed(YT_SECTION_HIDDEN, "daft");
    assert.deepEqual(stepYtSection(loading, { type: "failed", query: "daft", reason: "offline" }), {
      status: "quiet",
      query: "daft",
      reason: "offline",
      by: "auto",
    });
  });

  test("after a failure, typing more tries again", () => {
    const quiet = stepYtSection(typed(YT_SECTION_HIDDEN, "daft"), {
      type: "failed",
      query: "daft",
      reason: "failed",
    });
    assert.deepEqual(typed(quiet, "daft p"), {
      status: "loading",
      query: "daft p",
      by: "auto",
      delayMs: 300,
    });
  });

  test("the section shows nothing with nothing to search for", () => {
    const loading = typed(YT_SECTION_HIDDEN, "daft");
    assert.deepEqual(typed(loading, "d"), { status: "idle", pick: null });
    assert.deepEqual(typed(loading, ""), { status: "idle", pick: null });
  });

  test("with YT Music off the section stays hidden and nothing loads", () => {
    assert.equal(typed(YT_SECTION_HIDDEN, "daft", false), YT_SECTION_HIDDEN);
    const shown = stepYtSection(typed(YT_SECTION_HIDDEN, "daft"), {
      type: "found",
      query: "daft",
      songs: [song("a")],
      ...NONE,
    });
    assert.equal(typed(shown, "daft", false), YT_SECTION_HIDDEN);
  });
});

/** A release found on YouTube Music, as matching it sees it. */
const release = (title: string, ...credited: string[]) => ({ title, artists: credited });

describe("libraryReleaseFinder", () => {
  const artists = [
    { id: 1, name: "JAY-Z" },
    { id: 2, name: "Kanye West" },
    { id: 3, name: "Daft Punk" },
  ];
  const albums = [
    { id: 10, title: "Watch the Throne", albumArtistIds: [1, 2] },
    { id: 11, title: "Random Access Memories", albumArtistIds: [3] },
    { id: 12, title: "Discovery", albumArtistIds: [3] },
  ];
  const find = libraryReleaseFinder(libraryArtistFinder(artists), albums);

  test("is the Library album with the release's title, filed under an artist it credits", () => {
    assert.equal(find(release("Random Access Memories", "Daft Punk"))?.id, 11);
    assert.equal(find(release("Watch The Throne (Deluxe)", "JAŸ-Z", "Kanye West"))?.id, 10);
    assert.equal(find(release("Watch the Throne", "Kanye West"))?.id, 10);
  });

  test("is null for a release of an artist the Library lacks, or one of theirs it lacks", () => {
    assert.equal(find(release("Random Access Memories", "Daft Punk's Karaoke Band")), null);
    assert.equal(find(release("Homework", "Daft Punk")), null);
    assert.equal(find(release("Alive 2007 (Live)", "Daft Punk")), null);
  });
});

describe("libraryArtistFinder", () => {
  const find = libraryArtistFinder([
    { id: 1, name: "Beatles" },
    { id: 2, name: "Björk" },
    { id: 3, name: "Unknown Artist" },
  ]);

  test("is the Library artist a YouTube Music name is, as artist photos compare names", () => {
    assert.equal(find("The Beatles")?.id, 1);
    assert.equal(find("bjork")?.id, 2);
  });

  test("is null for anyone else, and for names that aren't an artist", () => {
    assert.equal(find("Daft Punk"), null);
    assert.equal(find("Unknown Artist"), null);
  });
});

/** The Library has nothing of what YT Music finds. */
const NOTHING_HELD = {
  hasSong: (): boolean => false,
  hasArtist: (): boolean => false,
  hasAlbum: (): boolean => false,
};

/** YT Music answers [query] with [songs]. */
const found = (state: YtSection, query: string, songs: YtSong[]): YtSection =>
  stepYtSection(state, { type: "found", query, songs, ...NONE });

/** A segment of the toggle is tapped. */
const pick = (state: YtSection, picked: "library" | "online"): YtSection =>
  stepYtSection(state, { type: "picked", pick: picked });

describe("the Library | Online toggle in Search", () => {
  test("Online asks YT Music for the typed query at once", () => {
    const online = pick(typedFound(YT_SECTION_HIDDEN, "daft"), "online");
    assert.equal(online.status, "loading");
    assert.equal(online.status === "loading" && online.query, "daft");
    assert.equal(online.status === "loading" && online.delayMs, 0);
    assert.equal(ytSectionToggle(online), "online");
  });

  test("Library hides YT Music's results without asking; Online shows them again with no request", () => {
    const shown = found(pick(typedFound(YT_SECTION_HIDDEN, "daft"), "online"), "daft", [song("a")]);
    const libraryOnly = pick(shown, "library");
    assert.equal(ytSectionToggle(libraryOnly), "library");
    assert.equal(ytSectionView(libraryOnly, NOTHING_HELD)?.songs.length, 0);
    assert.equal(ytSectionView(libraryOnly, NOTHING_HELD)?.integrated, false);
    const again = pick(libraryOnly, "online");
    assert.equal(again.status, "results");
    assert.deepEqual(ytSectionView(again, NOTHING_HELD)?.songs, [song("a")]);
  });

  test("a query changed while Library showed is asked once Online is picked", () => {
    const shown = found(pick(typedFound(YT_SECTION_HIDDEN, "daft"), "online"), "daft", [song("a")]);
    const refined = typedFound(pick(shown, "library"), "daft punk");
    assert.equal(refined.status, "offered");
    const again = pick(refined, "online");
    assert.equal(again.status === "loading" && again.query, "daft punk");
    assert.equal(again.status === "loading" && again.delayMs, 0);
  });

  test("going back to the query Online answered while Library shows reuses its answer", () => {
    const shown = found(pick(typedFound(YT_SECTION_HIDDEN, "daft"), "online"), "daft", [song("a")]);
    const back = typedFound(typedFound(pick(shown, "library"), "daft punk"), "daft");
    assert.equal(pick(back, "online").status, "results");
  });

  test("with Library picked, a query the Library has nothing for isn't asked on its own", () => {
    const libraryOnly = pick(typedFound(YT_SECTION_HIDDEN, "daft"), "library");
    const nothing = typed(libraryOnly, "dafty");
    assert.equal(nothing.status, "offered");
    assert.equal(ytSectionToggle(nothing), "library");
  });

  test("asked on its own, the toggle shows Online; picking it keeps YT Music once the Library has results", () => {
    const auto = typed(YT_SECTION_HIDDEN, "dafy");
    assert.equal(ytSectionToggle(auto), "online");
    const kept = typedFound(pick(found(auto, "dafy", [song("a")]), "online"), "daft");
    assert.equal(kept.status, "loading");
    assert.equal(ytSectionToggle(kept), "online");
  });

  test("Online picked with nothing typed asks for the first query worth asking", () => {
    const empty = typedFound(YT_SECTION_HIDDEN, "");
    assert.equal(ytSectionToggle(empty), "library");
    const online = pick(empty, "online");
    assert.equal(ytSectionToggle(online), "online");
    assert.equal(ytSectionView(online, NOTHING_HELD), null);
    const one = typedFound(online, "d");
    assert.equal(ytSectionToggle(one), "online");
    const asked = typedFound(one, "da");
    assert.equal(asked.status === "loading" && asked.query, "da");
  });

  test("clearing the field puts the toggle back to Library", () => {
    const online = pick(typedFound(YT_SECTION_HIDDEN, "daft"), "online");
    const cleared = typedFound(online, "");
    assert.equal(ytSectionToggle(cleared), "library");
    assert.equal(typedFound(cleared, "daft").status, "offered");
    const libraryOnly = pick(typed(YT_SECTION_HIDDEN, "dafy"), "library");
    assert.equal(typed(typed(libraryOnly, ""), "dafy").status, "loading");
  });

  test("Online on a failure asks again at once", () => {
    const quiet = stepYtSection(pick(typedFound(YT_SECTION_HIDDEN, "daft"), "online"), {
      type: "failed",
      query: "daft",
      reason: "offline",
    });
    const retry = pick(quiet, "online");
    assert.equal(retry.status === "loading" && retry.delayMs, 0);
  });

  test("with YT Music off there's no toggle, and picking does nothing", () => {
    const off = typed(YT_SECTION_HIDDEN, "daft", false, true);
    assert.equal(ytSectionToggle(off), null);
    assert.equal(pick(off, "online"), off);
  });
});

/** Typing [query] the Library has results for, with Search online set to Always. */
const typedAlways = (state: YtSection, query: string): YtSection =>
  stepYtSection(state, {
    type: "typed",
    query,
    enabled: true,
    libraryHasResults: true,
    always: true,
  });

describe("Search with Search online set to Always", () => {
  test("typing asks YT Music once typing pauses, without a tap, even when the Library has results", () => {
    const asked = typedAlways(typedAlways(YT_SECTION_HIDDEN, ""), "daft");
    assert.equal(asked.status, "loading");
    assert.equal(asked.status === "loading" && asked.query, "daft");
    assert.equal(asked.status === "loading" && asked.delayMs, YT_SEARCH_DEBOUNCE_MS);
    assert.equal(ytSectionToggle(asked), "online");
  });

  test("the empty field shows Online; Library tapped holds until the field is cleared", () => {
    const empty = typedAlways(YT_SECTION_HIDDEN, "");
    assert.equal(ytSectionToggle(empty), "online");
    const libraryOnly = typedAlways(pick(typedAlways(empty, "daft"), "library"), "daft punk");
    assert.equal(libraryOnly.status, "offered");
    assert.equal(ytSectionToggle(libraryOnly), "library");
    const cleared = typedAlways(libraryOnly, "");
    assert.equal(ytSectionToggle(cleared), "online");
    assert.equal(typedAlways(cleared, "daft").status, "loading");
  });
});

describe("the top-hit Library artist's song count in Search", () => {
  const NOW = 1_000 * 24 * 60 * 60 * 1000;
  /** The Library has the song "mine"; the artist's online page lists it among theirs. */
  const answer = (allSongs: YtSong[], checkedAt = NOW): YtArtistSaved => ({
    outcome: "found",
    checkedAt,
    browseId: "UCbluestones",
    page: { name: "Blue Stones", songs: [], allSongs, albums: [], singles: [] },
  });
  const ANSWER = answer([song("mine"), song("a"), song("b"), song("a")]);
  const online = (): YtSection =>
    found(pick(typedFound(YT_SECTION_HIDDEN, "blue"), "online"), "blue", []);
  const count = (section: YtSection, saved: YtArtistSaved | null, now = NOW) =>
    ytSearchArtistSongs(section, 2, saved, { now, inLibrary: library.hasSong });

  test("with Online and the artist's answer, the Library's songs plus those it lacks, each once", () => {
    assert.equal(count(online(), ANSWER), 4);
  });

  test("the Library's count until the answer comes, on no match or failure, and with Library", () => {
    assert.equal(count(online(), null), 2);
    assert.equal(count(online(), { outcome: "unmatched", checkedAt: NOW }), 2);
    assert.equal(count(pick(online(), "library"), ANSWER), 2);
    assert.equal(count(typedFound(YT_SECTION_HIDDEN, "blue"), ANSWER), 2);
    assert.equal(count(YT_SECTION_HIDDEN, ANSWER), 2);
  });

  test("a saved answer a week old doesn't count", () => {
    assert.equal(count(online(), answer([song("a")], NOW - 8 * 24 * 60 * 60 * 1000)), 2);
  });

  test("the artist's page is read once Search shows YouTube Music's answer to the query", () => {
    assert.equal(ytSearchArtistReads(online(), "Blue Stones"), true);
    // Asked and not answered yet: the top hit may still change as the query does.
    assert.equal(
      ytSearchArtistReads(pick(typedFound(YT_SECTION_HIDDEN, "blue"), "online"), "Blue Stones"),
      false,
    );
    assert.equal(ytSearchArtistReads(pick(online(), "library"), "Blue Stones"), false);
    assert.equal(ytSearchArtistReads(YT_SECTION_HIDDEN, "Blue Stones"), false);
  });

  test("only a Library artist on top, and not one whose name isn't an artist's", () => {
    assert.equal(ytSearchArtistReads(online(), null), false);
    assert.equal(ytSearchArtistReads(online(), "Various Artists"), false);
  });
});

describe("what Search knows of its top-hit artists' online pages during a visit", () => {
  const NOW = 1_000 * 24 * 60 * 60 * 1000;
  const ANSWER: YtArtistSaved = {
    outcome: "found",
    checkedAt: NOW,
    browseId: "UCbluestones",
    page: { name: "Blue Stones", songs: [], allSongs: [song("mine"), song("a")], albums: [], singles: [] },
  };
  const online = (query = "blue"): YtSection =>
    found(pick(typedFound(YT_SECTION_HIDDEN, query), "online"), query, []);
  const after = (...events: Parameters<typeof ytSearchArtistsKnownAfter>[1][]) =>
    events.reduce(ytSearchArtistsKnownAfter, YT_SEARCH_ARTISTS_UNKNOWN);

  test("reads a Library artist on top once YouTube Music's answer shows, once a visit", () => {
    assert.equal(ytSearchArtistToRead(online(), "Blue Stones", YT_SEARCH_ARTISTS_UNKNOWN), "blue stones");
    const read = after({ kind: "read", key: "blue stones", saved: ANSWER, at: NOW });
    assert.equal(ytSearchArtistToRead(online("blue st"), "Blue Stones", read), null);
  });

  test("a failed read isn't tried again for a refined query, only once Online is tapped", () => {
    const failed = after({ kind: "failed", key: "blue stones" });
    assert.equal(ytSearchArtistToRead(online("blue st"), "Blue Stones", failed), null);
    assert.equal(ytSearchArtistToRead(online("blue stones"), "Blue Stones", failed), null);
    // Another artist on top is read all the same.
    assert.equal(ytSearchArtistToRead(online("daft"), "Daft Punk", failed), "daft punk");
    const tapped = ytSearchArtistsKnownAfter(failed, { kind: "onlineTapped" });
    assert.equal(ytSearchArtistToRead(online("blue st"), "Blue Stones", tapped), "blue stones");
  });

  test("the row's count: the merged one, or null while the Library's stands", () => {
    const local = { artistKey: "blue stones", songs: 1 };
    const context = { inLibrary: library.hasSong };
    const read = after({ kind: "read", key: "blue stones", saved: ANSWER, at: NOW });
    assert.equal(ytSearchTopArtistSongs(online(), local, read, context), 2);
    assert.equal(ytSearchTopArtistSongs(online(), local, YT_SEARCH_ARTISTS_UNKNOWN, context), null);
    assert.equal(ytSearchTopArtistSongs(pick(online(), "library"), local, read, context), null);
    // The online page adds nothing the Library lacks.
    assert.equal(ytSearchTopArtistSongs(online(), local, read, { inLibrary: () => true }), null);
  });

  test("a saved answer is reused while it stands on the artist's page", () => {
    assert.equal(ytArtistSavedStands(ANSWER, NOW), true);
    assert.equal(ytArtistSavedStands(ANSWER, NOW + 8 * 24 * 60 * 60 * 1000), false);
    // Read for a Library album: their page without every song isn't the artist page's answer.
    const { allSongs: _every, ...pageOnly } = ANSWER.page;
    assert.equal(ytArtistSavedStands({ ...ANSWER, page: pageOnly }, NOW), false);
    assert.equal(ytArtistSavedStands(null, NOW), false);
  });
});
