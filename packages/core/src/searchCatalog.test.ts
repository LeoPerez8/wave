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
  test("until every source is prepared, the index finds what the prepared ones hold", () => {
    const catalog = createSearchCatalog<(typeof SOURCES)[number], Hit>(SOURCES);
    assert.equal(catalog.index(), null);
    catalog.update("artists", ARTISTS, artistOf);
    catalog.update("songs", SONGS, songOf);
    finish(catalog);
    assert.equal(catalog.complete(), false);
    assert.deepEqual(names(catalog.index()!.search("love")), ["Love on Top"]);
    catalog.update("playlists", PLAYLISTS, playlistOf);
    finish(catalog);
    assert.equal(catalog.complete(), true);
    assert.deepEqual(names(catalog.index()!.search("love")), ["Love on Top", "Love songs"]);
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
    assert.equal(catalog.complete(), false);
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

  test("rows read again with keys: only rows whose search text changed are prepared, hits carry the new rows", () => {
    const keyOf = (row: Row): string => row.name;
    const catalog = createSearchCatalog<(typeof SOURCES)[number], Hit>(SOURCES);
    catalog.update("artists", ARTISTS, artistOf);
    catalog.update("songs", SONGS, songOf, keyOf);
    catalog.update("playlists", PLAYLISTS, playlistOf);
    finish(catalog);
    const prepared = catalog.stats().prepared;

    // The same songs read again as new rows, one retagged and one added.
    const reread: Row[] = [
      { name: "Halo", by: "Beyoncé" },
      { name: "Hyperballad", by: "Björk Guðmundsdóttir" },
      { name: "Joga", by: "Björk" },
      { name: "Love on Top", by: "Beyoncé" },
    ];
    catalog.update("songs", reread, songOf, keyOf);
    finish(catalog);
    assert.equal(catalog.stats().prepared - prepared, 2);

    const whole = createSearchIndex([
      ...ARTISTS.map(artistOf),
      ...reread.map(songOf),
      ...PLAYLISTS.map(playlistOf),
    ]);
    for (const query of ["b", "bjork", "gudmundsdottir", "love", "joga", "halo"])
      assert.deepEqual(names(catalog.index()!.search(query)), names(whole.search(query)), query);
    const halo = catalog.index()!.search("halo").top as Hit;
    assert.equal(halo.row, reread[0]);
  });

  test("rows patched in by key take their place in the source's order, as a whole read gives them", () => {
    interface Song extends Row {
      readonly id: number;
    }
    const byName = (a: Song, b: Song): number =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : a.id - b.id;
    const keyOf = (row: Song): number => row.id;
    const songs: Song[] = [
      { id: 1, name: "Halo", by: "Beyoncé" },
      { id: 4, name: "Intro", by: "Beyoncé" },
      { id: 2, name: "Love on Top", by: "Beyoncé" },
    ];
    const catalog = createSearchCatalog<(typeof SOURCES)[number], Hit>(SOURCES);
    catalog.update("artists", ARTISTS, artistOf);
    catalog.update("songs", songs, songOf, keyOf);
    catalog.update("playlists", PLAYLISTS, playlistOf);
    finish(catalog);
    const prepared = catalog.stats().prepared;

    // A scan batch: song 4 retagged, songs 3 and 5 new, one of them named like another.
    const batch: Song[] = [
      { id: 5, name: "Intro", by: "Björk" },
      { id: 4, name: "Intro", by: "Beyoncé, Jay-Z" },
      { id: 3, name: "Crazy in Love", by: "Beyoncé" },
    ];
    assert.equal(catalog.patch("songs", batch, byName), true);
    finish(catalog);
    assert.equal(catalog.stats().prepared - prepared, 3);

    const read: Song[] = [
      { id: 3, name: "Crazy in Love", by: "Beyoncé" },
      { id: 1, name: "Halo", by: "Beyoncé" },
      { id: 4, name: "Intro", by: "Beyoncé, Jay-Z" },
      { id: 5, name: "Intro", by: "Björk" },
      { id: 2, name: "Love on Top", by: "Beyoncé" },
    ];
    assert.deepEqual(catalog.rows("songs"), read);
    const whole = createSearchIndex([
      ...ARTISTS.map(artistOf),
      ...read.map(songOf),
      ...PLAYLISTS.map(playlistOf),
    ]);
    const ids = (results: SearchResults<Hit>): number[] =>
      results.groups.flatMap((group) => group.items.map((item) => (item.row as Song).id ?? -1));
    for (const query of ["intro", "b", "crazy", "jay"])
      assert.deepEqual(ids(catalog.index()!.search(query)), ids(whole.search(query)), query);
  });

  test("a patch before the source's first rows changes nothing: the first read holds it", () => {
    const catalog = createSearchCatalog<(typeof SOURCES)[number], Hit>(SOURCES);
    assert.equal(
      catalog.patch("songs", [{ name: "Joga" }], () => 0),
      false,
    );
    assert.equal(catalog.rows("songs"), null);
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
    const steps: number[] = [];
    let more = true;
    while (more) {
      const started = performance.now();
      more = catalog.work(500);
      steps.push(performance.now() - started);
    }
    steps.sort((a, b) => a - b);
    const p95 = steps[Math.floor(steps.length * 0.95)]!;
    const longest = steps.at(-1)!;
    // Desktop bound, generous for CI: a step of 500 entries stays well under a frame. The 95th
    // percentile, not the longest step, so a garbage-collection pause on a busy runner doesn't count.
    assert.ok(p95 < 50, `95th-percentile step ${p95} ms (longest ${longest} ms)`);
    assert.equal(catalog.index()!.search("song 4999").groups[0]?.total, 11);
  });
});
