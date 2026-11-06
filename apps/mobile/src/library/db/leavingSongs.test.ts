/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sql } from "drizzle-orm";

import { creditSplits } from "./credits.ts";
import { filesGone, removeSongs } from "./missingSongs.ts";
import { selectFavoriteTrackIds, setFavorites } from "./playHistory.ts";
import {
  createPlaylist,
  deletePlaylist,
  linkPlaylistEntries,
  removePlaylistItems,
  selectPlaylistEntries,
  selectInPlaylists,
  selectPlaylistGraveyard,
} from "./playlists.ts";
import {
  addTrack,
  closeTestDatabase,
  migrateTestDatabase,
  openTestDatabase,
  type TestDatabase,
} from "./testDatabase.ts";

const LUCKY = { title: "Lucky", artist: "Radiohead", album: "OK Computer", durationMs: 259_000 };
const AIRBAG = { title: "Airbag", artist: "Radiohead", album: "OK Computer", durationMs: 284_000 };

const names = (db: TestDatabase, type: "index" | "trigger") =>
  db
    .all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = ${type} AND tbl_name = 'playlist_items'
        ORDER BY name`,
    )
    .map((row) => row.name);

describe("migration 0056", () => {
  test("playlist entries no longer go with their Library song, and keep everything else", async () => {
    const db = await openTestDatabase({ through: "0055_dismissed_follow_suggestions" });
    try {
      const lucky = addTrack(db, LUCKY);
      const airbag = addTrack(db, AIRBAG);
      const { playlistId } = createPlaylist(
        db,
        "Night",
        [
          { source: "library", trackId: airbag },
          { source: "library", trackId: lucky },
        ],
        100,
      );
      // The newest entry was deleted before the update: no entry takes its id again.
      const gone = createPlaylist(db, "Gone", [{ source: "library", trackId: lucky }], 100);
      db.run(sql`DELETE FROM playlists WHERE id = ${gone.playlistId}`);
      const highest = db.get<{ seq: number }>(
        sql`SELECT seq FROM sqlite_sequence WHERE name = 'playlist_items'`,
      )?.seq;
      const before = selectPlaylistEntries(db, playlistId);
      const rows = db.all(sql`SELECT * FROM playlist_items ORDER BY id`);
      const indexes = names(db, "index");
      const triggers = names(db, "trigger");

      await migrateTestDatabase(db);

      assert.deepEqual(selectPlaylistEntries(db, playlistId), before);
      assert.deepEqual(db.all(sql`SELECT * FROM playlist_items ORDER BY id`), rows);
      assert.deepEqual(names(db, "index"), indexes);
      assert.deepEqual(names(db, "trigger"), triggers);
      const keys = db.all<{ from: string; table: string; on_delete: string }>(
        sql`SELECT "from", "table", on_delete FROM pragma_foreign_key_list('playlist_items')
          ORDER BY "from"`,
      );
      assert.deepEqual(
        keys.map((key) => [key.from, key.table, key.on_delete]),
        [
          ["playlist_id", "playlists", "CASCADE"],
          ["track_id", "tracks", "NO ACTION"],
        ],
      );
      const added = createPlaylist(db, "Later", [{ source: "library", trackId: lucky }], 200);
      const [entry] = selectPlaylistEntries(db, added.playlistId);
      assert.ok(entry !== undefined && highest !== undefined && entry.itemId > highest);
    } finally {
      closeTestDatabase(db);
    }
  });
});

/** [playlistId]'s entries as the page lists them: a Library song's title, or the song a song without a file is. */
const entriesOf = (db: TestDatabase, playlistId: number) =>
  selectPlaylistEntries(db, playlistId).map((entry) =>
    entry.source === "library"
      ? { source: entry.source, title: entry.track.title, addedAt: entry.addedAt }
      : { source: entry.source, song: entry.song, addedAt: entry.addedAt },
  );

const luckyEntry = {
  title: "Lucky",
  artists: ["Radiohead"],
  album: "OK Computer",
  durationMs: 259_000,
  artworkUrl: null,
};

describe("a song leaving the Library", () => {
  test("Delete keeps its entries in every playlist, in place, as an unsearched entry of what the Library knew", async () => {
    const db = await openTestDatabase();
    try {
      const splits = creditSplits();
      const lucky = addTrack(db, LUCKY);
      const airbag = addTrack(db, AIRBAG);
      const night = createPlaylist(
        db,
        "Night",
        [
          { source: "library", trackId: lucky },
          { source: "library", trackId: airbag },
        ],
        100,
      ).playlistId;
      const drive = createPlaylist(
        db,
        "Drive",
        [
          { source: "library", trackId: airbag },
          { source: "library", trackId: lucky },
        ],
        200,
      ).playlistId;
      setFavorites(db, [lucky], true, 300);

      removeSongs(db, splits, [lucky], 1_000);

      assert.deepEqual(entriesOf(db, night), [
        { source: "unsearched", song: luckyEntry, addedAt: 100 },
        { source: "library", title: "Airbag", addedAt: 100 },
      ]);
      assert.deepEqual(entriesOf(db, drive), [
        { source: "library", title: "Airbag", addedAt: 200 },
        { source: "unsearched", song: luckyEntry, addedAt: 200 },
      ]);
      // Favorites only holds Library songs.
      assert.deepEqual(selectFavoriteTrackIds(db), []);
    } finally {
      closeTestDatabase(db);
    }
  });

  test("a song downloaded from YouTube Music becomes a YT Music entry of its video", async () => {
    const db = await openTestDatabase();
    try {
      const lucky = addTrack(db, { ...LUCKY, explicit: "explicit" });
      db.run(sql`UPDATE tracks SET video_id = 'lucky-video' WHERE id = ${lucky}`);
      const night = createPlaylist(db, "Night", [{ source: "library", trackId: lucky }], 100);

      removeSongs(db, creditSplits(), [lucky], 1_000);

      assert.deepEqual(entriesOf(db, night.playlistId), [
        {
          source: "stream",
          song: { ...luckyEntry, videoId: "lucky-video", albumId: null, explicit: true },
          addedAt: 100,
        },
      ]);
    } finally {
      closeTestDatabase(db);
    }
  });
});

describe("every way a song leaves the Library keeps its entries", () => {
  const pathOf = (db: TestDatabase, id: number): string =>
    db.get<{ path: string }>(sql`SELECT path FROM tracks WHERE id = ${id}`)?.path ?? "";

  test("a signed-out scan that no longer finds the file", async () => {
    const db = await openTestDatabase();
    try {
      const lucky = addTrack(db, LUCKY);
      const night = createPlaylist(db, "Night", [{ source: "library", trackId: lucky }], 100);

      filesGone(db, creditSplits(), [pathOf(db, lucky)], 1_000);

      assert.deepEqual(entriesOf(db, night.playlistId), [
        { source: "unsearched", song: luckyEntry, addedAt: 100 },
      ]);
    } finally {
      closeTestDatabase(db);
    }
  });

  test("several songs deleted together, removed entries and the Graveyard's among them", async () => {
    const db = await openTestDatabase();
    try {
      const lucky = addTrack(db, LUCKY);
      const airbag = addTrack(db, AIRBAG);
      const night = createPlaylist(
        db,
        "Night",
        [
          { source: "library", trackId: lucky },
          { source: "library", trackId: airbag },
        ],
        100,
      ).playlistId;
      const [removed] = selectPlaylistEntries(db, night);
      removePlaylistItems(db, night, [removed?.itemId ?? -1], 200);

      removeSongs(db, creditSplits(), [lucky, airbag], 1_000);

      assert.deepEqual(entriesOf(db, night), [
        {
          source: "unsearched",
          song: { ...luckyEntry, title: "Airbag", durationMs: 284_000 },
          addedAt: 100,
        },
      ]);
      assert.deepEqual(
        selectPlaylistGraveyard(db, night).map((entry) => [
          entry.source,
          entry.source === "library" ? entry.track.title : entry.song.title,
          entry.removedAt,
        ]),
        [["unsearched", "Lucky", 200]],
      );
      // No entry points at a song the Library no longer has.
      assert.equal(
        db.get<{ n: number }>(
          sql`SELECT count(*) AS n FROM playlist_items WHERE track_id IS NOT NULL`,
        )?.n,
        0,
      );
    } finally {
      closeTestDatabase(db);
    }
  });

  test("the file back in the Library turns the entries into its song again", async () => {
    const db = await openTestDatabase();
    try {
      const lucky = addTrack(db, LUCKY);
      const night = createPlaylist(db, "Night", [{ source: "library", trackId: lucky }], 100);
      removeSongs(db, creditSplits(), [lucky], 1_000);

      addTrack(db, LUCKY);
      linkPlaylistEntries(db, 2_000);

      assert.deepEqual(entriesOf(db, night.playlistId), [
        { source: "library", title: "Lucky", addedAt: 100 },
      ]);
    } finally {
      closeTestDatabase(db);
    }
  });
});

describe("selectInPlaylists", () => {
  test("says whether any of the songs is in a playlist: a removed entry or a deleted playlist doesn't count", async () => {
    const db = await openTestDatabase();
    try {
      const lucky = addTrack(db, LUCKY);
      const airbag = addTrack(db, AIRBAG);
      assert.equal(selectInPlaylists(db, [lucky, airbag]), false);

      const night = createPlaylist(db, "Night", [{ source: "library", trackId: lucky }], 100);
      assert.equal(selectInPlaylists(db, [lucky]), true);
      assert.equal(selectInPlaylists(db, [airbag, lucky]), true);
      assert.equal(selectInPlaylists(db, [airbag]), false);

      const [entry] = selectPlaylistEntries(db, night.playlistId);
      removePlaylistItems(db, night.playlistId, [entry?.itemId ?? -1], 200);
      assert.equal(selectInPlaylists(db, [lucky]), false);

      const drive = createPlaylist(db, "Drive", [{ source: "library", trackId: airbag }], 300);
      deletePlaylist(db, drive.playlistId, 400);
      assert.equal(selectInPlaylists(db, [airbag]), false);
    } finally {
      closeTestDatabase(db);
    }
  });
});
