import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { createPlaylist } from "@wave/client/db/playlists";
import { recordPlay } from "@wave/client/db/playHistory";
import type { LibraryDatabase } from "@wave/client/db/database";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { libraryLayer } from "../database.ts";
import { browseLibrary, browseLetter, browseRowIds } from "./browse.ts";
import {
  movePlaylistInList,
  playlistListView,
  showPlaylistListAs,
  sortPlaylistList,
} from "./playlistList.ts";

const DAY = 86_400_000;

/** A Library in a real SQLite file, as main opens it. */
const withLibrary = async (run: (db: LibraryDatabase) => void | Promise<void>) => {
  const folder = mkdtempSync(join(tmpdir(), "wave-playlist-list-"));
  const runtime = ManagedRuntime.make(libraryLayer(join(folder, "wave.db")));
  try {
    const db = (await runtime.runPromise(
      Effect.gen(function* () {
        return yield* Database;
      }),
    )) as unknown as LibraryDatabase;
    await run(db);
  } finally {
    await runtime.dispose();
    rmSync(folder, { recursive: true, force: true });
  }
};

/** Playlists made a day apart, in the order given: the last is the newest. */
const make = (db: LibraryDatabase, ...names: string[]) =>
  names.map((name, day) => createPlaylist(db, name, [], (day + 1) * DAY).playlistId);

/** The Playlists page and the sidebar alike. */
const listed = (db: LibraryDatabase) =>
  browseLibrary(db, { kind: "playlists" }, 0, 50).items.map((row) => row.title);

const playFrom = (db: LibraryDatabase, playlistId: number, at: number) => {
  const track = addTrack(db as unknown as TestDatabase, { title: `Song ${at}` });
  recordPlay(db, {
    trackId: String(track),
    startedAt: at,
    counted: true,
    listenedMs: 16000,
    durationMs: 180000,
    source: "desktop",
    endReason: "skipped",
    context: { kind: "playlist", id: String(playlistId) },
  });
};

test("the list is by name until another sort is chosen, and keeps the one chosen", async () => {
  await withLibrary((db) => {
    make(db, "Road", "Autumn", "Morning");
    assert.deepEqual(listed(db), ["Autumn", "Morning", "Road"]);
    assert.equal(playlistListView(db).sort, "name");
    sortPlaylistList(db, "added");
    assert.deepEqual(listed(db), ["Morning", "Autumn", "Road"]);
    assert.equal(playlistListView(db).sort, "added");
  });
});

test("Recently Played puts the playlist played from last first, never-played ones by name", async () => {
  await withLibrary((db) => {
    const [road, autumn] = make(db, "Road", "Autumn", "Morning", "Bells");
    playFrom(db, road!, 5 * DAY);
    playFrom(db, autumn!, 6 * DAY);
    sortPlaylistList(db, "played");
    assert.deepEqual(listed(db), ["Autumn", "Road", "Bells", "Morning"]);
  });
});

test("in Custom, a playlist moves to a place and stays there; other sorts don't move", async () => {
  await withLibrary((db) => {
    const [road, autumn, morning] = make(db, "Road", "Autumn", "Morning");
    assert.equal(movePlaylistInList(db, road!, 0), false, "by name nothing is arranged");
    sortPlaylistList(db, "custom");
    // Custom starts from the order the list showed.
    assert.deepEqual(listed(db), ["Autumn", "Morning", "Road"]);
    assert.equal(movePlaylistInList(db, road!, 0), true);
    assert.deepEqual(listed(db), ["Road", "Autumn", "Morning"]);
    // Move Down from the top, then Move Up off the top moves nothing.
    assert.equal(movePlaylistInList(db, road!, 1), true);
    assert.deepEqual(listed(db), ["Autumn", "Road", "Morning"]);
    assert.equal(movePlaylistInList(db, autumn!, -1), false);
    assert.equal(movePlaylistInList(db, morning!, 3), false);
    assert.deepEqual(playlistListView(db).ids, [autumn, road, morning]);
    // Another sort and back brings the arranged order back.
    sortPlaylistList(db, "name");
    sortPlaylistList(db, "custom");
    assert.deepEqual(listed(db), ["Autumn", "Road", "Morning"]);
  });
});

test("selection and paging read the list in the order it shows", async () => {
  await withLibrary((db) => {
    const ids = make(db, "Road", "Autumn", "Morning");
    sortPlaylistList(db, "added");
    assert.deepEqual(browseRowIds(db, { kind: "playlists" }, 0, 10).items, [...ids].reverse());
    const second = browseLibrary(db, { kind: "playlists" }, 1, 1);
    assert.deepEqual([second.total, second.items.map((row) => row.title)], [3, ["Autumn"]]);
  });
});

test("jumping by letter goes by name only while the list is by name", async () => {
  await withLibrary((db) => {
    make(db, "Road", "Autumn", "Morning");
    assert.equal(browseLetter(db, { kind: "playlists" }, "m"), 1);
    sortPlaylistList(db, "added");
    assert.equal(browseLetter(db, { kind: "playlists" }, "m"), null);
  });
});

test("the page shows as a table until the grid is chosen, and keeps it", async () => {
  await withLibrary((db) => {
    assert.equal(playlistListView(db).layout, "list");
    showPlaylistListAs(db, "grid");
    assert.equal(playlistListView(db).layout, "grid");
    showPlaylistListAs(db, "list");
    assert.equal(playlistListView(db).layout, "list");
  });
});

test("a Find narrows the list in the order chosen, and its total and ids follow it", async () => {
  await withLibrary((db) => {
    const [roadTrip, , roadWork] = make(db, "Road Trip", "Autumn", "Road Work");
    sortPlaylistList(db, "added");
    const found = { kind: "playlists", find: "road" } as const;
    const page = browseLibrary(db, found, 0, 50);
    assert.deepEqual(
      [page.total, page.items.map((row) => row.title)],
      [2, ["Road Work", "Road Trip"]],
    );
    assert.deepEqual(browseRowIds(db, found, 0, 10).items, [roadWork, roadTrip]);
  });
});
