import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../database.ts";
import { albumArtists, artistAlbums } from "./artistPage.ts";
import { browseLibrary } from "./browse.ts";

/** Runs [use] over a desktop Library file, as main opens it. */
const inLibrary = async (use: (db: TestDatabase) => void): Promise<void> => {
  const folder = mkdtempSync(join(tmpdir(), "wave-artist-page-"));
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

test("an artist's page lists their albums newest first, then the albums they appear on", () =>
  inLibrary((db) => {
    addTrack(db, {
      title: "Bad Guy",
      artist: "Billie Eilish",
      album: "When We All Fall Asleep",
      year: 2019,
    });
    addTrack(db, {
      title: "Ocean Eyes",
      artist: "Billie Eilish",
      album: "Don't Smile at Me",
      year: 2017,
    });
    addTrack(db, {
      title: "Birds",
      artist: "Billie Eilish",
      album: "Hit Me Hard and Soft",
      year: 2024,
    });
    addTrack(db, {
      title: "Lovely",
      artist: "Billie Eilish",
      album: "13 Reasons Why",
      albumArtist: "Various Artists",
      year: 2018,
    });
    addTrack(db, { title: "Location", artist: "Khalid", album: "American Teen", year: 2017 });
    const billie = browseLibrary(db, { kind: "artists" }, 0, 10).items.find(
      (row) => row.title === "Billie Eilish",
    )!;

    const shelves = artistAlbums(db, billie.id);

    assert.deepEqual(
      shelves.albums.map((row) => [row.title, row.year]),
      [
        ["Hit Me Hard and Soft", 2024],
        ["When We All Fall Asleep", 2019],
        ["Don't Smile at Me", 2017],
      ],
    );
    assert.deepEqual(
      shelves.appearsOn.map((row) => [row.title, row.artist]),
      [["13 Reasons Why", "Various Artists"]],
    );
  }));

test("an artist with no such id has no albums", () =>
  inLibrary((db) => {
    assert.deepEqual(artistAlbums(db, 404), { albums: [], appearsOn: [] });
  }));

test("an album's credited artists come in credit order, each with their Library id", () =>
  inLibrary((db) => {
    addTrack(db, { title: "Lift", artist: "Ella Fitzgerald", album: "Ella and Louis" });
    addTrack(db, { title: "Solo", artist: "Louis Armstrong", album: "Hello, Dolly!" });
    // A scan files a duet's album under both of its artists, in credit order.
    db.run(sql`INSERT INTO album_artists (album_id, artist_id, position)
    SELECT al.id, ar.id, 1 FROM albums al, artists ar
    WHERE al.title = 'Ella and Louis' AND ar.name = 'Louis Armstrong'`);
    const album = browseLibrary(db, { kind: "albums" }, 0, 10).items.find(
      (row) => row.title === "Ella and Louis",
    )!;
    const artists = browseLibrary(db, { kind: "artists" }, 0, 10).items;
    const id = (name: string) => artists.find((row) => row.title === name)!.id;

    assert.deepEqual(albumArtists(db, album.id), [
      { id: id("Ella Fitzgerald"), name: "Ella Fitzgerald" },
      { id: id("Louis Armstrong"), name: "Louis Armstrong" },
    ]);
    assert.deepEqual(albumArtists(db, 404), []);
  }));
