import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../database.ts";
import { createPlaylist, renamePlaylist } from "@wave/client/db/playlists";
import { keepLyricsSearchText } from "@wave/client/db/lyricsSearchIndex";
import { sql } from "drizzle-orm";
import { searchLibrary, searchSongIds } from "./search.ts";

/** Runs [use] over a desktop Library file, as main opens it. */
const inLibrary = async (use: (db: TestDatabase) => void): Promise<void> => {
  const folder = mkdtempSync(join(tmpdir(), "wave-search-"));
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        use((yield* Database) as unknown as TestDatabase);
      }).pipe(Effect.provide(libraryLayer(join(folder, "wave.db")))),
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

const seed = (db: TestDatabase) => {
  addTrack(db, { title: "Pink Moon", artist: "Nick Drake", album: "Pink Moon", genre: "Folk" });
  addTrack(db, { title: "Road", artist: "Nick Drake", album: "Pink Moon", genre: "Folk" });
  addTrack(db, { title: "Things Behind the Sun", artist: "Nick Drake", album: "Pink Moon" });
  addTrack(db, { title: "Harvest", artist: "Neil Young", album: "Harvest", genre: "Rock" });
};

test("a search finds songs, albums, artists, playlists and genres as the phone does", () =>
  inLibrary((db) => {
    seed(db);
    createPlaylist(db, "Drake at night", [], 1);
    const view = searchLibrary(db, "drake");
    assert.deepEqual(
      [view.top?.kind, view.top?.row.title],
      ["playlist", "Drake at night"],
      "a name that starts with the query beats one with it as a later word",
    );
    const group = (kind: string) => view.groups.find((g) => g.kind === kind);
    assert.deepEqual(
      group("song")
        ?.items.map((row) => row.title)
        .toSorted(),
      ["Pink Moon", "Road", "Things Behind the Sun"],
      "a song is found by its artist",
    );
    assert.equal(group("song")?.total, 3);
    assert.equal(group("song")?.items[0]?.artist, "Nick Drake");
    assert.equal(group("song")?.items[0]?.album, "Pink Moon");
    assert.deepEqual(
      group("album")?.items.map((row) => [row.title, row.artist]),
      [["Pink Moon", "Nick Drake"]],
      "an album is found by its album artist",
    );
    assert.deepEqual(
      group("playlist")?.items.map((row) => row.title),
      ["Drake at night"],
    );
    assert.deepEqual(
      group("artist")?.items.map((row) => row.title),
      ["Nick Drake"],
    );
    assert.equal(group("genre"), undefined);
    assert.deepEqual(
      [searchLibrary(db, "nick").top?.kind, searchLibrary(db, "nick").top?.row.title],
      ["artist", "Nick Drake"],
    );
    assert.equal(searchLibrary(db, "folk").top?.kind, "genre");
    assert.deepEqual(searchLibrary(db, "  ").groups, []);
  }));

test("songs found by their lyrics follow, leaving out those Songs shows, and lead from 3 words", () =>
  inLibrary((db) => {
    seed(db);
    const ids = new Map(
      db
        .all<{ id: number; title: string }>(sql`SELECT id, title FROM tracks`)
        .map((t) => [t.title, t.id]),
    );
    keepLyricsSearchText(
      db,
      ids.get("Pink Moon")!,
      "Saw it written and I saw it say\nPink moon is on its way",
    );
    keepLyricsSearchText(db, ids.get("Harvest")!, "Did I see you down\nUnder a pink moon tonight");
    const view = searchLibrary(db, "pink moon");
    assert.deepEqual(
      view.lyrics.map((hit) => [hit.row.title, hit.line, hit.ranges]),
      [
        [
          "Harvest",
          "Under a pink moon tonight",
          [
            { start: 8, end: 12 },
            { start: 13, end: 17 },
          ],
        ],
      ],
      "Pink Moon is already in Songs",
    );
    assert.equal(view.lyricsFirst, false);
    assert.equal(searchLibrary(db, "under a pink moon").lyricsFirst, true);
    assert.deepEqual(searchSongIds(db, "pink moon").at(-1), ids.get("Harvest"));
  }));

test("a song's title with its artist puts that song on top and isn't a lyric phrase", () =>
  inLibrary((db) => {
    seed(db);
    for (const query of ["pink moon nick drake", "nick drake pink moon"]) {
      const view = searchLibrary(db, query);
      assert.deepEqual([view.top?.kind, view.top?.row.title], ["song", "Pink Moon"]);
      assert.equal(view.lyricsFirst, false);
      assert.equal(view.namesSong, true);
    }
    assert.equal(searchLibrary(db, "pink moon").namesSong, false);
    const phrase = searchLibrary(db, "under a pink moon");
    assert.equal(phrase.namesSong, false);
    assert.equal(phrase.lyricsFirst, true);
  }));

test("a search follows the Library: songs added, renamed playlists and lists read again", () =>
  inLibrary((db) => {
    seed(db);
    assert.equal(searchLibrary(db, "parasite").top, null);
    addTrack(db, { title: "Parasite", artist: "Nick Drake", album: "Pink Moon" });
    assert.equal(searchLibrary(db, "parasite").top?.row.title, "Parasite");
    const { playlistId } = createPlaylist(db, "Morning", [], 1);
    assert.equal(searchLibrary(db, "morning").top?.row.id, playlistId);
    renamePlaylist(db, playlistId, "Evening", 2);
    assert.equal(searchLibrary(db, "morning").top, null);
    assert.equal(searchLibrary(db, "evening").top?.row.title, "Evening");
  }));
