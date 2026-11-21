import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { createPlaylist } from "@wave/client/db/playlists";
import type { LibraryDatabase } from "@wave/client/db/database";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type { BrowseScope } from "../../shared/browse.ts";
import { libraryLayer } from "../database.ts";
import {
  browseLetter,
  browseLibrary,
  browseRowIds,
  browseTrackIds,
  playlistSongs,
} from "./browse.ts";
import { togglePlaylistSort } from "./browseSort.ts";
import { selectionMenu } from "./collectionActions.ts";
import { targetSongs } from "./songActions.ts";

const withLibrary = async (run: (db: LibraryDatabase) => void) => {
  const folder = mkdtempSync(join(tmpdir(), "wave-browse-find-"));
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

const titles = (db: LibraryDatabase, scope: BrowseScope) =>
  browseLibrary(db, scope, 0, 50).items.map((row) => row.title);

const library = (db: LibraryDatabase) => ({
  halo: add(db, { title: "Halo", artist: "Beyoncé", album: "I Am", genre: "Pop" }),
  diva: add(db, { title: "Diva", artist: "Beyoncé", album: "I Am", genre: "Pop" }),
  hello: add(db, { title: "Hello", artist: "Adele", album: "25", genre: "Soul" }),
  beyond: add(db, { title: "Beyond the Sea", artist: "Bobby Darin", album: "That's All" }),
});

test("Find narrows Songs in its query, a page at a time, as Play and Select All read it", async () => {
  await withLibrary((db) => {
    const songs = library(db);
    const scope: BrowseScope = { kind: "songs", find: "beyo" };
    assert.deepEqual(titles(db, scope), ["Beyond the Sea", "Diva", "Halo"]);
    // Each page is cut from the rows found, and its total counts only those.
    const page = browseLibrary(db, scope, 1, 1);
    assert.deepEqual(
      page.items.map((row) => row.title),
      ["Diva"],
    );
    assert.equal(page.total, 3);
    assert.deepEqual(browseRowIds(db, scope, 0, 50), {
      items: [songs.beyond, songs.diva, songs.halo],
      offset: 0,
      total: 3,
    });
    // Play and Shuffle queue the rows found, in the order shown.
    assert.deepEqual(browseTrackIds(db, scope), [songs.beyond, songs.diva, songs.halo].map(String));
    // Select All acts on the rows found, less the unchecked.
    assert.deepEqual(targetSongs(db, { scope, all: true, except: [songs.diva] }), [
      songs.beyond,
      songs.halo,
    ]);
    // Every query word starts a word of the title, artist or album, in any order.
    assert.deepEqual(titles(db, { kind: "songs", find: "am HAL" }), ["Halo"]);
    assert.deepEqual(titles(db, { kind: "songs", find: "zzz" }), []);
    // A blank query, or one of punctuation only, leaves the whole list.
    assert.equal(titles(db, { kind: "songs", find: " ... " }).length, 4);
    // Jumping by letter goes to the letter among the rows found.
    assert.equal(browseLetter(db, scope, "h"), 2);
  });
});

test("Find narrows the lists of lists by their names, and an artist's and a genre's songs", async () => {
  await withLibrary((db) => {
    library(db);
    createPlaylist(db, "Beyoncé hits", [], 0);
    createPlaylist(db, "Road trip", [], 0);
    assert.deepEqual(titles(db, { kind: "artists", find: "beyo" }), ["Beyoncé"]);
    assert.deepEqual(titles(db, { kind: "albums", find: "beyo" }), ["I Am"]);
    assert.deepEqual(titles(db, { kind: "genres", find: "so" }), ["Soul"]);
    assert.deepEqual(titles(db, { kind: "playlists", find: "beyo" }), ["Beyoncé hits"]);
    const artist = browseLibrary(db, { kind: "artists" }, 0, 50).items.find(
      (row) => row.title === "Beyoncé",
    )!.id;
    assert.deepEqual(titles(db, { kind: "artist", id: artist, find: "ha" }), ["Halo"]);
    const genre = browseLibrary(db, { kind: "genres" }, 0, 50).items.find(
      (row) => row.title === "Pop",
    )!.id;
    assert.deepEqual(titles(db, { kind: "genre", id: genre, find: "di" }), ["Diva"]);
  });
});

test("Find in a playlist keeps each song's place and its streamed songs", async () => {
  await withLibrary((db) => {
    const songs = library(db);
    const { playlistId: id } = createPlaylist(
      db,
      "Mixed",
      [
        { source: "library", trackId: songs.hello },
        {
          source: "stream",
          song: {
            videoId: "crazy",
            title: "Crazy in Love",
            artists: ["Beyoncé", "Jay-Z"],
            album: null,
            durationMs: 236_000,
            artworkUrl: null,
            explicit: false,
          },
        },
        { source: "library", trackId: songs.halo },
      ],
      0,
    );
    const scope: BrowseScope = { kind: "playlist", id, find: "beyo" };
    const page = browseLibrary(db, scope, 0, 50);
    assert.deepEqual(
      page.items.map((row) => [row.title, row.order]),
      [
        ["Crazy in Love", 2],
        ["Halo", 3],
      ],
    );
    assert.equal(page.total, 2);
    assert.equal(page.hero?.title, "Mixed");
    const keys = page.items.map((row) => row.id);
    assert.deepEqual(browseRowIds(db, scope, 0, 50), { items: keys, offset: 0, total: 2 });
    assert.deepEqual(
      playlistSongs(db, id, "beyo")?.map((entry) =>
        "song" in entry ? entry.song.title : entry.trackId,
      ),
      ["Crazy in Love", songs.halo],
    );
    assert.deepEqual(targetSongs(db, { scope, all: true, except: [] }), [songs.halo]);
    // Sorted, the playlist still finds the same songs, in the sort's order.
    togglePlaylistSort(db, id, "title");
    assert.deepEqual(titles(db, scope), ["Crazy in Love", "Halo"]);
    assert.deepEqual(titles(db, { ...scope, find: "hel" }), ["Hello"]);
  });
});

test("Select All on a list of lists Find narrows checks only the rows it finds", async () => {
  await withLibrary((db) => {
    library(db);
    const menu = (find?: string) =>
      selectionMenu(
        db,
        {
          collections: [
            { kind: "album", all: true, except: [], ...(find === undefined ? {} : { find }) },
          ],
        },
        false,
      );
    assert.equal(menu("beyo").count, 1);
    assert.equal(menu().count, 3);
  });
});
