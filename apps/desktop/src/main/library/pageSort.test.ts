import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { createPlaylist } from "@wave/client/db/playlists";
import { saveYtArtist } from "@wave/client/db/ytArtists";
import type { LibraryDatabase } from "@wave/client/db/database";
import { identityKey } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { libraryLayer } from "../database.ts";
import {
  arrangedRowIds,
  browseLibrary,
  browseRowIds,
  browseTrackIds,
  playlistSongs,
} from "./browse.ts";
import { playlistSongSort, toggleBrowseSort, togglePlaylistSort } from "./browseSort.ts";

const withLibrary = async (run: (db: LibraryDatabase) => void) => {
  const folder = mkdtempSync(join(tmpdir(), "wave-page-sort-"));
  const runtime = ManagedRuntime.make(libraryLayer(join(folder, "wave.db")));
  try {
    run(
      (await runtime.runPromise(
        Effect.gen(function* () {
          return yield* Database;
        }),
      )) as unknown as LibraryDatabase,
    );
  } finally {
    await runtime.dispose();
    rmSync(folder, { recursive: true, force: true });
  }
};

const add = (db: LibraryDatabase, track: Parameters<typeof addTrack>[1]) =>
  addTrack(db as unknown as TestDatabase, track);

const shown = (db: LibraryDatabase, scope: { kind: "playlist" | "artist" | "genre"; id: number }) =>
  browseLibrary(db, scope, 0, 50);
const titles = (db: LibraryDatabase, scope: Parameters<typeof shown>[1]) =>
  shown(db, scope).items.map((row) => row.title);
/** The titles Play queues, in order. */
const queued = (db: LibraryDatabase, scope: Parameters<typeof shown>[1]) => {
  const ids = browseTrackIds(db, scope).map(Number);
  const byId = new Map(
    db.all<{ id: number; title: string }>(sql`SELECT id, title FROM tracks`).map((t) => [t.id, t]),
  );
  return ids.map((id) => byId.get(id)!.title);
};

test("a playlist sorts from its headers, keeps its own sort and plays in the order shown", async () => {
  await withLibrary((db) => {
    const banana = add(db, { title: "Banana", artist: "Zed", album: "One", year: 2001 });
    const cherry = add(db, { title: "Cherry", artist: "Amy", album: "Two", year: 1990 });
    const apple = add(db, { title: "Apple", artist: "Moe", album: "Three" });
    const entries = [banana, cherry, apple].map((trackId) => ({
      source: "library" as const,
      trackId,
    }));
    const { playlistId: id } = createPlaylist(db, "Fruit", entries, 0);
    const { playlistId: other } = createPlaylist(db, "Other", entries, 0);
    const scope = { kind: "playlist", id } as const;

    assert.deepEqual(shown(db, scope).sort, { key: "custom", descending: false });
    assert.deepEqual(titles(db, scope), ["Banana", "Cherry", "Apple"]);
    assert.deepEqual(
      shown(db, scope).items.map((row) => row.order),
      [1, 2, 3],
    );

    togglePlaylistSort(db, id, "title");
    assert.deepEqual(shown(db, scope).sort, { key: "title", descending: false });
    assert.deepEqual(titles(db, scope), ["Apple", "Banana", "Cherry"]);
    // Each row still says its place in the playlist's own order.
    assert.deepEqual(
      shown(db, scope).items.map((row) => row.order),
      [3, 1, 2],
    );
    assert.deepEqual(queued(db, scope), ["Apple", "Banana", "Cherry"]);
    assert.equal(shown(db, scope).total, 3);
    assert.deepEqual(
      browseLibrary(db, scope, 1, 1).items.map((row) => row.title),
      ["Banana"],
    );

    togglePlaylistSort(db, id, "title");
    assert.deepEqual(titles(db, scope), ["Cherry", "Banana", "Apple"]);
    togglePlaylistSort(db, id, "artist");
    assert.deepEqual(titles(db, scope), ["Cherry", "Apple", "Banana"]);
    // Oldest first, the song with no date last.
    togglePlaylistSort(db, id, "releaseDate");
    assert.deepEqual(titles(db, scope), ["Cherry", "Banana", "Apple"]);
    assert.deepEqual(
      shown(db, scope).items.map((row) => row.released),
      ["1990", "2001", undefined],
    );

    // The other playlist never left its own order.
    assert.deepEqual(playlistSongSort(db, other), { key: "custom", descending: false });
    assert.deepEqual(titles(db, { kind: "playlist", id: other }), ["Banana", "Cherry", "Apple"]);

    togglePlaylistSort(db, id, "custom");
    assert.deepEqual(titles(db, scope), ["Banana", "Cherry", "Apple"]);
    assert.deepEqual(queued(db, scope), ["Banana", "Cherry", "Apple"]);
  });
});

test("a playlist's YT Music songs sort among its files", async () => {
  await withLibrary((db) => {
    const road = add(db, { title: "Road", artist: "Nick Drake", album: "Pink Moon" });
    const stream = {
      videoId: "abcdefghijk",
      title: "Parasite",
      artists: ["Nick Drake"],
      album: "Pink Moon",
      albumId: "MPREb_pinkmoon",
      durationMs: 124_000,
      artworkUrl: null,
      explicit: false,
    };
    const { playlistId: id } = createPlaylist(
      db,
      "Mixed",
      [
        { source: "library", trackId: road },
        { source: "stream", song: stream },
      ],
      0,
    );
    const scope = { kind: "playlist", id } as const;
    assert.deepEqual(titles(db, scope), ["Road", "Parasite"]);
    togglePlaylistSort(db, id, "title");
    assert.deepEqual(titles(db, scope), ["Parasite", "Road"]);
    assert.deepEqual(
      playlistSongs(db, id)?.map((entry) => ("song" in entry ? entry.song.title : entry.trackId)),
      ["Parasite", road],
    );
    // The rows' keys in the order shown: a streamed entry's is its row id, negative.
    const keys = shown(db, scope).items.map((row) => row.id);
    assert.deepEqual(arrangedRowIds(db, scope), keys);
    assert.equal(keys[0]! < 0, true);
    // A Shift range reads its keys in that order too, a page at a time.
    assert.deepEqual(browseRowIds(db, scope, 0, 50), { items: keys, offset: 0, total: 2 });
    assert.deepEqual(browseRowIds(db, scope, 1, 1), { items: [road], offset: 1, total: 2 });
    togglePlaylistSort(db, id, "custom");
    assert.equal(arrangedRowIds(db, scope), undefined);
    assert.deepEqual(browseRowIds(db, scope, 0, 50).items, [road, keys[0]]);
  });
});

test("an artist's songs sort by Popular once their list is saved, and by the other sorts", async () => {
  await withLibrary((db) => {
    const song = (title: string, addedAt: number) =>
      add(db, { title, artist: "Daft Punk", album: "Discovery", durationMs: 200_000, addedAt });
    song("Aerodynamic", 3);
    song("Veridis Quo", 2);
    song("One More Time", 1);
    const artist = db.get<{ id: number }>(sql`SELECT id FROM artists WHERE name='Daft Punk'`)!.id;
    const scope = { kind: "artist", id: artist } as const;
    // Popular with no list saved: song name order.
    assert.deepEqual(shown(db, scope).sort, { key: "popular", descending: false });
    assert.deepEqual(titles(db, scope), ["Aerodynamic", "One More Time", "Veridis Quo"]);

    const listed = (title: string, videoId: string) => ({
      videoId,
      title,
      artists: ["Daft Punk"],
      album: "Discovery",
      durationMs: 200_000,
      artworkUrl: null,
      explicit: false,
    });
    saveYtArtist(db, identityKey("Daft Punk"), {
      outcome: "found",
      checkedAt: 1_000,
      browseId: "UCRr1xG_2WIDs18a6cIiCxeA",
      page: {
        name: "Daft Punk",
        songs: [],
        songsPlaylistId: null,
        allSongs: [
          listed("One More Time", "aaaaaaaaaaa"),
          listed("Something About Us", "bbbbbbbbbbb"),
          listed("Veridis Quo", "ccccccccccc"),
        ],
        albums: [],
        singles: [],
        similar: [],
      },
    } as Parameters<typeof saveYtArtist>[2]);
    assert.deepEqual(titles(db, scope), ["One More Time", "Veridis Quo", "Aerodynamic"]);
    assert.deepEqual(
      shown(db, scope).items.map((row) => row.order),
      [1, 3, undefined],
    );
    assert.deepEqual(queued(db, scope), ["One More Time", "Veridis Quo", "Aerodynamic"]);
    // A Shift range over Popular follows the ranked rows.
    const ranked = shown(db, scope).items.map((row) => row.id);
    assert.deepEqual(browseRowIds(db, scope, 0, 50), { items: ranked, offset: 0, total: 3 });
    assert.deepEqual(browseRowIds(db, scope, 1, 2).items, ranked.slice(1));

    toggleBrowseSort(db, "artist", "added");
    assert.deepEqual(
      browseRowIds(db, scope, 0, 50).items,
      shown(db, scope).items.map((row) => row.id),
    );
    assert.deepEqual(titles(db, scope), ["Aerodynamic", "Veridis Quo", "One More Time"]);
    // The ranks stay on the rows whatever the sort.
    assert.deepEqual(
      shown(db, scope).items.map((row) => row.order),
      [undefined, 3, 1],
    );
    assert.deepEqual(queued(db, scope), ["Aerodynamic", "Veridis Quo", "One More Time"]);
    toggleBrowseSort(db, "artist", "popular");
    assert.deepEqual(titles(db, scope), ["One More Time", "Veridis Quo", "Aerodynamic"]);
  });
});

test("a genre's songs sort from their headers", async () => {
  await withLibrary((db) => {
    add(db, { title: "Blue", artist: "Zed", album: "Two", genre: "Jazz" });
    add(db, { title: "Alto", artist: "Amy", album: "One", genre: "Jazz" });
    const genre = db.get<{ id: number }>(sql`SELECT id FROM genres WHERE name='Jazz'`)!.id;
    const scope = { kind: "genre", id: genre } as const;
    assert.deepEqual(titles(db, scope), ["Alto", "Blue"]);
    toggleBrowseSort(db, "genre", "title");
    assert.deepEqual(titles(db, scope), ["Blue", "Alto"]);
    assert.deepEqual(queued(db, scope), ["Blue", "Alto"]);
    toggleBrowseSort(db, "genre", "artist");
    assert.deepEqual(titles(db, scope), ["Alto", "Blue"]);
  });
});
