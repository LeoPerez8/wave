import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  tryAgainSearches,
  tryAgainNotice,
  tryAgainSettles,
  type PlaylistItem,
  type UnavailableSong,
  type YtAlbumSong,
} from "./index.ts";

type Entry = PlaylistItem<YtAlbumSong, { readonly id: number }> & { readonly itemId: number };

const missing = (
  itemId: number,
  title: string,
  fields: Partial<UnavailableSong> = {},
): Entry & { readonly source: "unavailable" } => ({
  itemId,
  source: "unavailable",
  song: {
    title,
    artists: ["Daft Punk"],
    album: "Random Access Memories",
    durationMs: 369_000,
    artworkUrl: null,
    reason: "notFound",
    ...fields,
  },
});

const yt = (videoId: string, title: string, fields: Partial<YtAlbumSong> = {}): YtAlbumSong => ({
  videoId,
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  albumId: null,
  durationMs: 369_000,
  artworkUrl: `https://lh3.googleusercontent.com/${videoId}`,
  explicit: false,
  ...fields,
});

const own = (itemId: number, id: number): Entry => ({ itemId, source: "library", track: { id } });
const streamed = (itemId: number, song: YtAlbumSong): Entry => ({
  itemId,
  source: "stream",
  song,
});

describe("tryAgainSearches", () => {
  test("searches each song not found, in playlist order, for its title and artists", () => {
    const entries = [
      own(1, 10),
      missing(2, "Giorgio by Moroder", { artists: ["Daft Punk", "Giorgio Moroder"] }),
      streamed(3, yt("a", "Instant Crush")),
      missing(4, "Fragments of Time"),
    ];
    assert.deepEqual(
      tryAgainSearches(entries).map(({ itemId, query }) => ({ itemId, query })),
      [
        { itemId: 2, query: "Giorgio by Moroder Daft Punk Giorgio Moroder" },
        { itemId: 4, query: "Fragments of Time Daft Punk" },
      ],
    );
  });

  test("a local file on Spotify with no artist is never searched", () => {
    const entries = [
      missing(1, "voice memo", { artists: [], reason: "localFile" }),
      missing(2, "Within"),
    ];
    assert.deepEqual(
      tryAgainSearches(entries).map(({ itemId }) => itemId),
      [2],
    );
  });

  test("a playlist with nothing unavailable, or only local files, has nothing to search", () => {
    assert.deepEqual(tryAgainSearches([own(1, 10), streamed(2, yt("a", "Instant Crush"))]), []);
    assert.deepEqual(
      tryAgainSearches([missing(1, "voice memo", { artists: [], reason: "localFile" })]),
      [],
    );
  });
});

describe("tryAgainSettles", () => {
  const [giorgio, fragments, within] = tryAgainSearches([
    missing(2, "Giorgio by Moroder", { durationMs: 544_626 }),
    missing(4, "Fragments of Time", { durationMs: 279_000 }),
    missing(5, "Within", { durationMs: 228_000 }),
  ]);
  if (giorgio === undefined || fragments === undefined || within === undefined)
    throw new Error("three searches");

  test("found, the entry becomes the YT Music song that is the recording, in its place", () => {
    const original = yt("orig", "Giorgio by Moroder", { durationMs: 544_000 });
    const settled = tryAgainSettles(
      [
        {
          search: giorgio,
          answer: {
            ok: true,
            songs: [yt("live", "Giorgio by Moroder (Live)", { durationMs: 544_000 }), original],
          },
        },
      ],
      [],
    );
    assert.deepEqual(settled, {
      replace: [{ itemId: 2, song: original }],
      drops: [],
      found: 1,
      failed: 0,
    });
  });

  test("not found, the entry stays unavailable; failed, it stays and counts as failed", () => {
    const settled = tryAgainSettles(
      [
        { search: giorgio, answer: { ok: true, songs: [yt("other", "Instant Crush")] } },
        { search: fragments, answer: { ok: false, reason: "failed" } },
        { search: within, answer: { ok: false, reason: "offline" } },
      ],
      [],
    );
    assert.deepEqual(settled, { replace: [], drops: [], found: 0, failed: 2 });
  });

  test("found as a song the playlist holds, or that an earlier entry just became, it's removed", () => {
    const original = yt("orig", "Giorgio by Moroder", { durationMs: 544_000 });
    const fragment = yt("frag", "Fragments of Time", { durationMs: 279_000 });
    const [again] = tryAgainSearches([missing(9, "Fragments of Time", { durationMs: 279_500 })]);
    if (again === undefined) throw new Error("a search");
    const settled = tryAgainSettles(
      [
        { search: giorgio, answer: { ok: true, songs: [original] } },
        { search: fragments, answer: { ok: true, songs: [fragment] } },
        { search: again, answer: { ok: true, songs: [fragment] } },
      ],
      [{ source: "stream", song: original }],
    );
    assert.deepEqual(settled, {
      replace: [{ itemId: 4, song: fragment }],
      drops: [2, 9],
      found: 3,
      failed: 0,
    });
  });
});

describe("tryAgainNotice", () => {
  test("says how many of the songs searched were found", () => {
    assert.equal(tryAgainNotice({ searched: 3, found: 2, failed: 0 }), "Found 2 of 3");
    assert.equal(tryAgainNotice({ searched: 1, found: 0, failed: 0 }), "Found 0 of 1");
    assert.equal(tryAgainNotice({ searched: 1204, found: 12, failed: 0 }), "Found 12 of 1,204");
  });

  test("and how many searches failed, if any", () => {
    assert.equal(
      tryAgainNotice({ searched: 3, found: 1, failed: 1 }),
      "Found 1 of 3 · 1 search failed",
    );
    assert.equal(
      tryAgainNotice({ searched: 3, found: 0, failed: 3 }),
      "Found 0 of 3 · 3 searches failed",
    );
  });
});

describe("Try Again's notice in Portuguese", () => {
  test("counts what was found and the searches that failed", () => {
    assert.equal(
      tryAgainNotice({ searched: 3, found: 2, failed: 0 }, "pt-BR"),
      "2 de 3 encontradas",
    );
    assert.equal(
      tryAgainNotice({ searched: 1234, found: 0, failed: 1 }, "pt-BR"),
      "0 de 1.234 encontradas · 1 busca falhou",
    );
    assert.equal(
      tryAgainNotice({ searched: 3, found: 1, failed: 2 }, "pt-BR"),
      "1 de 3 encontradas · 2 buscas falharam",
    );
  });
});
