import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { YT_SECTION_HIDDEN, stepYtSection, ytSearchQuery } from "./index.ts";
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

const typed = (state: YtSection, query: string, enabled = true): YtSection =>
  stepYtSection(state, { type: "typed", query, enabled });

describe("ytSearchQuery", () => {
  test("is what's typed, tidied", () => {
    assert.equal(ytSearchQuery("  daft   punk "), "daft punk");
  });

  test("is null until there's enough to search for", () => {
    for (const text of ["", "   ", "d"]) assert.equal(ytSearchQuery(text), null, text);
  });
});

describe("stepYtSection", () => {
  test("typing a query starts loading it", () => {
    assert.deepEqual(typed(YT_SECTION_HIDDEN, "daft"), {
      status: "loading",
      query: "daft",
      songs: [],
    });
  });

  test("the results for the query being loaded are shown", () => {
    const loading = typed(YT_SECTION_HIDDEN, "daft");
    const found = stepYtSection(loading, { type: "found", query: "daft", songs: [song("a")] });
    assert.deepEqual(found, { status: "results", query: "daft", songs: [song("a")] });
  });

  test("results that arrive after the query changed are dropped", () => {
    const loading = typed(typed(YT_SECTION_HIDDEN, "daft"), "daft punk");
    const stale = stepYtSection(loading, { type: "found", query: "daft", songs: [song("a")] });
    assert.equal(stale, loading);
    const staleFailure = stepYtSection(loading, { type: "failed", query: "daft", reason: "offline" });
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
    });
  });

  test("after a failure, typing more tries again", () => {
    const quiet = stepYtSection(typed(YT_SECTION_HIDDEN, "daft"), {
      type: "failed",
      query: "daft",
      reason: "failed",
    });
    assert.deepEqual(typed(quiet, "daft p"), { status: "loading", query: "daft p", songs: [] });
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
