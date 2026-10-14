import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { YT_SECTION_HIDDEN, stepYtSection, ytSearchQuery, ytSectionView } from "./index.ts";
import type { YtSection, YtSong } from "./index.ts";

const song = (videoId: string): YtSong => ({
  videoId,
  title: videoId,
  artists: ["Artist"],
  album: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

/** Typing [query]; by default the Library has nothing for it, so YT Music is asked on its own. */
const typed = (
  state: YtSection,
  query: string,
  enabled = true,
  libraryHasResults = false,
): YtSection => stepYtSection(state, { type: "typed", query, enabled, libraryHasResults });

/** Typing [query] that the Library has results for. */
const typedFound = (state: YtSection, query: string): YtSection => typed(state, query, true, true);

const inLibrary = (s: YtSong): boolean => s.videoId === "mine";
const results = (songs: YtSong[]): YtSection => ({
  status: "results",
  query: "q",
  songs,
  by: "user",
});

describe("ytSectionView", () => {
  test("shows the songs that aren't in the Library, in YT Music's order", () => {
    const view = ytSectionView(results([song("b"), song("mine"), song("a")]), inLibrary);
    assert.deepEqual(view, { songs: [song("b"), song("a")], note: null, offer: false });
  });

  test("says when YT Music has nothing, or nothing the Library lacks", () => {
    assert.deepEqual(ytSectionView(results([]), inLibrary), {
      songs: [],
      note: "noMatches",
      offer: false,
    });
    assert.deepEqual(ytSectionView(results([song("mine")]), inLibrary), {
      songs: [],
      note: "allInLibrary",
      offer: false,
    });
  });

  test("says it's searching until the first songs arrive, then keeps them up", () => {
    const first: YtSection = { status: "loading", query: "q", songs: [], by: "user", delayMs: 0 };
    assert.deepEqual(ytSectionView(first, inLibrary), {
      songs: [],
      note: "searching",
      offer: false,
    });
    const next: YtSection = { ...first, songs: [song("a")] };
    assert.deepEqual(ytSectionView(next, inLibrary), {
      songs: [song("a")],
      note: null,
      offer: false,
    });
  });

  test("a failure is a quiet note", () => {
    const quiet: YtSection = { status: "quiet", query: "q", reason: "offline", by: "user" };
    assert.deepEqual(ytSectionView(quiet, inLibrary), { songs: [], note: "offline", offer: false });
  });

  test("offers Search YouTube Music while nothing is asked", () => {
    assert.deepEqual(ytSectionView({ status: "offered", query: "q" }, inLibrary), {
      songs: [],
      note: null,
      offer: true,
    });
  });

  test("a hidden section shows nothing", () => {
    assert.equal(ytSectionView(YT_SECTION_HIDDEN, inLibrary), null);
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
  test("typing a query the Library has results for asks nothing and offers to ask", () => {
    assert.deepEqual(typedFound(YT_SECTION_HIDDEN, "daft"), { status: "offered", query: "daft" });
  });

  test("Search YouTube Music asks for the offered query at once", () => {
    const asked = stepYtSection(typedFound(YT_SECTION_HIDDEN, "daft"), { type: "asked" });
    assert.deepEqual(asked, {
      status: "loading",
      query: "daft",
      songs: [],
      by: "user",
      delayMs: 0,
    });
  });

  test("once asked, refining the query keeps YT Music's songs up and asks for the new one", () => {
    const asked = stepYtSection(typedFound(YT_SECTION_HIDDEN, "daft"), { type: "asked" });
    const shown = stepYtSection(asked, { type: "found", query: "daft", songs: [song("a")] });
    assert.deepEqual(typedFound(shown, "daft punk"), {
      status: "loading",
      query: "daft punk",
      songs: [song("a")],
      by: "user",
      delayMs: 300,
    });
  });

  test("asked on its own, YT Music is let go once the Library has results again", () => {
    const shown = stepYtSection(typed(YT_SECTION_HIDDEN, "dafy"), {
      type: "found",
      query: "dafy",
      songs: [song("a")],
    });
    assert.deepEqual(typedFound(shown, "daf"), { status: "offered", query: "daf" });
  });

  test("clearing the field ends what the user asked for", () => {
    const asked = stepYtSection(typedFound(YT_SECTION_HIDDEN, "daft"), { type: "asked" });
    assert.equal(typedFound(asked, ""), YT_SECTION_HIDDEN);
    assert.deepEqual(typedFound(typedFound(asked, ""), "daft"), {
      status: "offered",
      query: "daft",
    });
  });

  test("with YT Music off nothing is offered, and asking does nothing", () => {
    const off = typed(YT_SECTION_HIDDEN, "daft", false, true);
    assert.equal(off, YT_SECTION_HIDDEN);
    assert.equal(stepYtSection(off, { type: "asked" }), YT_SECTION_HIDDEN);
    const asked = stepYtSection(typedFound(YT_SECTION_HIDDEN, "daft"), { type: "asked" });
    assert.equal(typed(asked, "daft", false, true), YT_SECTION_HIDDEN);
  });

  test("typing a query the Library has nothing for asks YT Music on its own, once typing pauses", () => {
    assert.deepEqual(typed(YT_SECTION_HIDDEN, "daft"), {
      status: "loading",
      query: "daft",
      songs: [],
      by: "auto",
      delayMs: 300,
    });
  });

  test("the results for the query being loaded are shown", () => {
    const loading = typed(YT_SECTION_HIDDEN, "daft");
    const found = stepYtSection(loading, { type: "found", query: "daft", songs: [song("a")] });
    assert.deepEqual(found, { status: "results", query: "daft", songs: [song("a")], by: "auto" });
  });

  test("results that arrive after the query changed are dropped", () => {
    const loading = typed(typed(YT_SECTION_HIDDEN, "daft"), "daft punk");
    const stale = stepYtSection(loading, { type: "found", query: "daft", songs: [song("a")] });
    assert.equal(stale, loading);
    const staleFailure = stepYtSection(loading, {
      type: "failed",
      query: "daft",
      reason: "offline",
    });
    assert.equal(staleFailure, loading);
  });

  test("while the next query loads, the last results stay", () => {
    const shown = stepYtSection(typed(YT_SECTION_HIDDEN, "daft"), {
      type: "found",
      query: "daft",
      songs: [song("a")],
    });
    assert.deepEqual(typed(shown, "daft punk"), {
      status: "loading",
      query: "daft punk",
      songs: [song("a")],
      by: "auto",
      delayMs: 300,
    });
  });

  test("the same query, however it's spaced, isn't loaded again", () => {
    const shown = stepYtSection(typed(YT_SECTION_HIDDEN, "daft"), {
      type: "found",
      query: "daft",
      songs: [song("a")],
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
      songs: [],
      by: "auto",
      delayMs: 300,
    });
  });

  test("the section hides with nothing to search for", () => {
    const loading = typed(YT_SECTION_HIDDEN, "daft");
    assert.equal(typed(loading, "d"), YT_SECTION_HIDDEN);
    assert.equal(typed(loading, ""), YT_SECTION_HIDDEN);
  });

  test("with YT Music off the section stays hidden and nothing loads", () => {
    assert.equal(typed(YT_SECTION_HIDDEN, "daft", false), YT_SECTION_HIDDEN);
    const shown = stepYtSection(typed(YT_SECTION_HIDDEN, "daft"), {
      type: "found",
      query: "daft",
      songs: [song("a")],
    });
    assert.equal(typed(shown, "daft", false), YT_SECTION_HIDDEN);
  });
});
