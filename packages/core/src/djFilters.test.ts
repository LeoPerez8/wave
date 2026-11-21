import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  DEFAULT_DJ_SETTINGS,
  djArtistTile,
  djMixSliders,
  djNewReleasesRanked,
  djReleaseArtists,
  startStreamedMagicQueue,
  djToggleFilter,
  rankRadioSongs,
  startDjQueue,
  type DjFilter,
  type DjSettings,
  type YtAlbumSong,
} from "./index.ts";

const song = (videoId: string, artist = "Picked", album: string | null = null): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: [artist],
  album,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

const filtered = (...filters: DjFilter[]): DjSettings =>
  filters.reduce(djToggleFilter, DEFAULT_DJ_SETTINGS);

describe("ranking under Trending and Lesser-known songs", () => {
  /** A radio whose first song is in no other radio and whose second is in many. */
  const order = (settings: DjSettings): string[] =>
    rankRadioSongs(
      { artists: ["Picked"] },
      {
        pages: [{ id: "artist:picked", artists: ["Picked"], songs: [song("rare"), song("hit")] }],
        popularityOf: (videoId) => (videoId === "hit" ? 1 : 0),
      },
      djMixSliders(settings),
    ).map((ranked) => ranked.song!.videoId);

  test("with neither on, the radio's order stands", () => {
    assert.deepEqual(order(filtered()), ["rare", "hit"]);
  });

  test("Trending raises the songs many radios hold", () => {
    assert.deepEqual(order(filtered("trending")), ["hit", "rare"]);
  });

  test("Lesser-known songs lowers them", () => {
    const hitFirst = (settings: DjSettings): string[] =>
      rankRadioSongs(
        { artists: ["Picked"] },
        {
          pages: [{ id: "artist:picked", artists: ["Picked"], songs: [song("hit"), song("rare")] }],
          popularityOf: (videoId) => (videoId === "hit" ? 1 : 0),
        },
        djMixSliders(settings),
      ).map((ranked) => ranked.song!.videoId);
    assert.deepEqual(hitFirst(filtered()), ["hit", "rare"]);
    assert.deepEqual(hitFirst(filtered("lesserKnown")), ["rare", "hit"]);
  });
});

describe("ranking under New releases", () => {
  /** The middle of 2026, so no time zone moves the year. */
  const now = Date.UTC(2026, 5, 15);

  const session = (settings: DjSettings, picked: string[] = ["Picked"]) =>
    startDjQueue(
      picked.map((name) => djArtistTile(name)!),
      { id: "dj1", settings },
    )!;

  const release = (title: string, year: number | null, browseId = `MPREb_${title}`) => ({
    kind: "album" as const,
    browseId,
    title,
    artists: [],
    year,
    artworkUrl: null,
  });

  /** Picked's saved page: an album of 2026, a single of 2025 and an album of 2024. */
  const pickedPage = {
    name: "Picked",
    albums: [release("This Year", 2026), release("Two Years Ago", 2024)],
    singles: [release("Last Year", 2025)],
  };

  /** The radio's songs as ranked for a session with [settings], then raised by New releases. */
  const order = (
    settings: DjSettings,
    songs: readonly YtAlbumSong[],
    pages: Parameters<typeof djNewReleasesRanked>[2] = [pickedPage],
  ): string[] => {
    const started = session(settings);
    const ranked = rankRadioSongs(
      { artists: started.radioArtists },
      { pages: [{ id: "artist:picked", artists: ["Picked"], songs }] },
      djMixSliders(settings),
    );
    return djNewReleasesRanked(started, ranked, pages, now).map((song) => song.song!.videoId);
  };

  /** Five songs on no known release, then [last]. */
  const after = (last: YtAlbumSong): YtAlbumSong[] => [
    ...["a", "b", "c", "d", "e"].map((id) => song(id)),
    last,
  ];

  test("raises a song on a release of the current year", () => {
    const songs = after(song("new", "Picked", "This Year"));
    assert.deepEqual(order(filtered("newReleases"), songs), ["new", "a", "b", "c", "d", "e"]);
  });

  test("off, the radio's order stands", () => {
    const songs = after(song("new", "Picked", "This Year"));
    assert.deepEqual(order(filtered(), songs), ["a", "b", "c", "d", "e", "new"]);
    assert.deepEqual(order(filtered("trending"), songs), ["a", "b", "c", "d", "e", "new"]);
  });

  test("a page gives only a year, so the current year and the one before count", () => {
    const lastYear = after(song("single", "Picked", "Last Year"));
    assert.deepEqual(order(filtered("newReleases"), lastYear), ["single", "a", "b", "c", "d", "e"]);
    const older = after(song("old", "Picked", "Two Years Ago"));
    assert.deepEqual(order(filtered("newReleases"), older), ["a", "b", "c", "d", "e", "old"]);
  });

  test("a song with no known release is neutral", () => {
    const songs = [
      song("none"),
      song("unlisted", "Picked", "Not On The Page"),
      song("undated", "Picked", "No Year"),
      song("old", "Picked", "Two Years Ago"),
    ];
    const pages = [{ ...pickedPage, singles: [release("No Year", null)] }];
    assert.deepEqual(order(filtered("newReleases"), songs, pages), [
      "none",
      "unlisted",
      "undated",
      "old",
    ]);
    assert.deepEqual(order(filtered("newReleases"), after(song("new", "Picked", "This Year")), []), [
      "a",
      "b",
      "c",
      "d",
      "e",
      "new",
    ]);
  });

  test("a release counts for the songs that credit the page's artist", () => {
    const namesake = after(song("other", "Stranger", "This Year"));
    assert.deepEqual(order(filtered("newReleases"), namesake), ["a", "b", "c", "d", "e", "other"]);
    const featured = after({ ...song("feat", "Guest", "this  year"), artists: ["Guest", "PICKED"] });
    assert.deepEqual(order(filtered("newReleases"), featured), ["feat", "a", "b", "c", "d", "e"]);
  });

  test("a song's album page tells its release whatever the title says", () => {
    const deluxe = after({
      ...song("deluxe", "Picked", "This Year (Deluxe)"),
      albumId: "MPREb_This Year",
    });
    assert.deepEqual(order(filtered("newReleases"), deluxe), ["deluxe", "a", "b", "c", "d", "e"]);
  });

  test("songs on recent releases keep the radio's order among themselves", () => {
    const songs = [
      song("a"),
      song("first", "Picked", "This Year"),
      song("b"),
      song("second", "Picked", "Last Year"),
    ];
    assert.deepEqual(order(filtered("newReleases"), songs), ["first", "second", "a", "b"]);
  });
});

describe("the pages New releases reads", () => {
  /** Picked lists Near A and Near B as similar, and Near A lists Far. */
  const graph = artistGraph({
    catalog: [],
    pages: [
      { name: "Picked", similar: ["Near A", "Near B"] },
      { name: "Near A", similar: ["Far"] },
    ].map(({ name, similar }) => ({
      name,
      similar: similar.map((other) => ({ name: other, browseId: `UC${other}`, audience: null })),
    })),
    plays: [],
  });

  const started = (settings: DjSettings) =>
    startDjQueue([djArtistTile("Picked")!, djArtistTile("Also Picked")!], {
      id: "dj1",
      settings,
    })!;

  test("are the selected artists' and their direct neighbours', the selected first", () => {
    assert.deepEqual(djReleaseArtists(started(filtered("newReleases")), graph), [
      "Picked",
      "Also Picked",
      "Near A",
      "Near B",
    ]);
  });

  test("are the selected artists' alone while there's no artist graph", () => {
    assert.deepEqual(djReleaseArtists(started(filtered("newReleases")), null), [
      "Picked",
      "Also Picked",
    ]);
  });

  test("are none with New releases off, or in a queue that isn't DJ's", () => {
    assert.deepEqual(djReleaseArtists(started(filtered("trending")), graph), []);
    const other = startStreamedMagicQueue(song("seed"), { id: "m1" }).session;
    assert.deepEqual(djReleaseArtists(other, graph), []);
  });
});
