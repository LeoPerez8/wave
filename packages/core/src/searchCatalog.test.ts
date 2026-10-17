import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createSearchCatalog,
  createSearchIndex,
  type SearchEntry,
  type SearchIndex,
  type SearchResults,
} from "./index.ts";

interface Row {
  readonly name: string;
  readonly by?: string;
}

type Hit = SearchEntry & { readonly row: Row };

const artistOf = (row: Row): Hit => ({ kind: "artist", name: row.name, row });
const songOf = (row: Row): Hit => ({ kind: "song", name: row.name, also: [row.by ?? ""], row });
const playlistOf = (row: Row): Hit => ({ kind: "playlist", name: row.name, row });

const names = (results: SearchResults<SearchEntry>): string[] =>
  results.groups.flatMap((group) => group.items.map((item) => item.name));

/** Works until nothing is left; returns how many calls it took. */
const finish = (catalog: { readonly work: (budget: number) => boolean }, budget = 1000): number => {
  let calls = 1;
  while (catalog.work(budget)) calls++;
  return calls;
};

const SOURCES = ["artists", "songs", "playlists"] as const;

const ARTISTS: Row[] = [{ name: "Beyoncé" }, { name: "Björk" }];
const SONGS: Row[] = [
  { name: "Halo", by: "Beyoncé" },
  { name: "Hyperballad", by: "Björk" },
  { name: "Love on Top", by: "Beyoncé" },
];
const PLAYLISTS: Row[] = [{ name: "Love songs" }];

const filled = () => {
  const catalog = createSearchCatalog<(typeof SOURCES)[number], Hit>(SOURCES);
  catalog.update("artists", ARTISTS, artistOf);
  catalog.update("songs", SONGS, songOf);
  catalog.update("playlists", PLAYLISTS, playlistOf);
  return catalog;
};

describe("search catalog", () => {
  test("no index until every source has been read and prepared", () => {
    const catalog = createSearchCatalog<(typeof SOURCES)[number], Hit>(SOURCES);
    catalog.update("artists", ARTISTS, artistOf);
    catalog.update("songs", SONGS, songOf);
    finish(catalog);
    assert.equal(catalog.index(), null);
    catalog.update("playlists", PLAYLISTS, playlistOf);
    assert.equal(catalog.index(), null);
    finish(catalog);
    assert.notEqual(catalog.index(), null);
  });

  test("finds what one index over all the sources finds, in the same order", () => {
    const catalog = filled();
    finish(catalog);
    const whole = createSearchIndex([
      ...ARTISTS.map(artistOf),
      ...SONGS.map(songOf),
      ...PLAYLISTS.map(playlistOf),
    ]);
    for (const query of ["b", "beyo", "love", "h", "bjork hyper", "zz"])
      assert.deepEqual(names(catalog.index()!.search(query)), names(whole.search(query)), query);
  });

  test("preparing takes bounded steps: each prepares at most the budget given", () => {
    const catalog = filled();
    // 6 entries, 2 at a time: three steps, the last saying nothing is left.
    assert.equal(catalog.work(2), true);
    assert.equal(catalog.index(), null);
    assert.equal(catalog.work(2), true);
    assert.equal(catalog.work(2), false);
    assert.deepEqual(names(catalog.index()!.search("halo")), ["Halo"]);
  });

  test("the same rows again keep what was prepared and the same index", () => {
    const catalog = filled();
    finish(catalog);
    const index = catalog.index();
    const prepared = catalog.stats().prepared;
    catalog.update("songs", SONGS, songOf);
    catalog.update("artists", ARTISTS, artistOf);
    assert.equal(catalog.work(1000), false);
    assert.equal(catalog.index(), index);
    assert.equal(catalog.stats().prepared, prepared);
  });

  test("a changed source is prepared again on its own: the others are reused", () => {
    const catalog = filled();
    finish(catalog);
    const prepared = catalog.stats().prepared;
    catalog.update("playlists", [...PLAYLISTS, { name: "Halo remixes" }], playlistOf);
    finish(catalog);
    assert.equal(catalog.stats().prepared - prepared, 2);
    assert.deepEqual(names(catalog.index()!.search("halo")), ["Halo", "Halo remixes"]);
  });

  test("while a source is prepared again, searches use the last complete index", () => {
    const catalog = filled();
    finish(catalog);
    const before: SearchIndex<Hit> | null = catalog.index();
    catalog.update("songs", [...SONGS.slice(1), { name: "Crazy in Love", by: "Beyoncé" }], songOf);
    assert.equal(catalog.work(1), true);
    assert.equal(catalog.index(), before);
    assert.deepEqual(names(catalog.index()!.search("halo")), ["Halo"]);
    finish(catalog);
    assert.notEqual(catalog.index(), before);
    assert.deepEqual(names(catalog.index()!.search("halo")), []);
    assert.deepEqual(names(catalog.index()!.search("crazy")), ["Crazy in Love"]);
  });

  test("rows that change while they are prepared: the newest win, the half-prepared ones are dropped", () => {
    const catalog = filled();
    finish(catalog);
    catalog.update("songs", [{ name: "Army of Me", by: "Björk" }, ...SONGS], songOf);
    catalog.work(1);
    catalog.update("songs", [{ name: "Joga", by: "Björk" }], songOf);
    finish(catalog);
    assert.deepEqual(names(catalog.index()!.search("army")), []);
    assert.deepEqual(names(catalog.index()!.search("joga")), ["Joga"]);
  });

  test("once its sources go unfollowed, no index until every source is given again and prepared", () => {
    const catalog = filled();
    finish(catalog);
    catalog.unfollowed();
    assert.equal(catalog.index(), null);

    // The Library lost a song while nothing followed it: the old index must not find it.
    const songs = SONGS.slice(1);
    catalog.update("artists", ARTISTS, artistOf);
    catalog.update("songs", songs, songOf);
    catalog.update("playlists", PLAYLISTS, playlistOf);
    assert.equal(catalog.work(1), true);
    assert.equal(catalog.index(), null);
    finish(catalog);
    assert.deepEqual(names(catalog.index()!.search("halo")), []);
    assert.deepEqual(names(catalog.index()!.search("hyper")), ["Hyperballad"]);
  });

  test("once unfollowed, sources given again unchanged bring the same index back without preparing", () => {
    const catalog = filled();
    finish(catalog);
    const index = catalog.index();
    const prepared = catalog.stats().prepared;
    catalog.unfollowed();
    catalog.update("artists", ARTISTS, artistOf);
    catalog.update("songs", SONGS, songOf);
    assert.equal(catalog.index(), null);
    catalog.update("playlists", PLAYLISTS, playlistOf);
    assert.equal(catalog.work(1000), false);
    assert.equal(catalog.index(), index);
    assert.equal(catalog.stats().prepared, prepared);
  });

  test("once unfollowed, rows still being prepared from before don't count as given again", () => {
    const catalog = filled();
    finish(catalog);
    catalog.update("songs", [{ name: "Joga", by: "Björk" }], songOf);
    catalog.unfollowed();
    finish(catalog);
    assert.equal(catalog.index(), null);
    catalog.update("artists", ARTISTS, artistOf);
    catalog.update("songs", SONGS, songOf);
    catalog.update("playlists", PLAYLISTS, playlistOf);
    finish(catalog);
    assert.deepEqual(names(catalog.index()!.search("halo")), ["Halo"]);
  });

  test("an empty source is ready at once", () => {
    const catalog = createSearchCatalog<(typeof SOURCES)[number], Hit>(SOURCES);
    catalog.update("artists", [], artistOf);
    catalog.update("songs", [], songOf);
    catalog.update("playlists", [], playlistOf);
    assert.equal(catalog.work(10), false);
    assert.deepEqual(catalog.index()!.search("a").groups, []);
  });

  test("prepares a library of 50,000 songs in steps of a few milliseconds", () => {
    const rows: Row[] = Array.from({ length: 50_000 }, (_, i) => ({
      name: `Song ${i} of the long album`,
      by: `Artist ${i % 900}`,
    }));
    const catalog = createSearchCatalog<"songs", Hit>(["songs"]);
    catalog.update("songs", rows, songOf);
    let longest = 0;
    let more = true;
    while (more) {
      const started = performance.now();
      more = catalog.work(500);
      longest = Math.max(longest, performance.now() - started);
    }
    // Desktop bound, generous for CI: a step of 500 entries stays well under a frame.
    assert.ok(longest < 50, `longest step ${longest} ms`);
    assert.equal(catalog.index()!.search("song 4999").groups[0]?.total, 11);
  });
});
