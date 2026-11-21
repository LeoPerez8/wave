/**
 * The desktop edits no collaborative playlist (docs/spec-desktop.md, Wave account and sync):
 * main refuses every change to its name, entries or order, from any window call, for the
 * owner as for the other members. Its own image stays the device's, as for any playlist.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Database } from "@wave/client";
import { convertToCollaborative } from "@wave/client/db/collaborations";
import type { LibraryDatabase } from "@wave/client/db/database";
import { createPlaylist as storePlaylist, removePlaylistItems } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { libraryLayer } from "../database.ts";
import { runStreamedAction } from "../yt/streamedSong.ts";
import { browseLibrary } from "./browse.ts";
import { createPlaylists } from "./playlists.ts";
import { runSongAction, songMenu, type SongActionPorts } from "./songActions.ts";

const OK_COMPUTER = { artist: "Radiohead", album: "OK Computer" };

/** A Library with "Drive" (Airbag, Lucky, Lucky's removal in its Graveyard undone) made collaborative. */
const setUp = async (
  run: (context: {
    readonly db: LibraryDatabase;
    readonly folder: string;
    readonly playlists: ReturnType<typeof createPlaylists>;
    readonly picked: { files: string[] };
    readonly drive: number;
    readonly tracks: { readonly airbag: number; readonly lucky: number; readonly karma: number };
    readonly changes: () => number;
  }) => Promise<void>,
) => {
  const folder = mkdtempSync(join(tmpdir(), "wave-collab-playlists-"));
  const runtime = ManagedRuntime.make(libraryLayer(join(folder, "wave.db")));
  try {
    const db = (await runtime.runPromise(
      Effect.gen(function* () {
        return yield* Database;
      }),
    )) as unknown as LibraryDatabase;
    const test = db as unknown as TestDatabase;
    const airbag = addTrack(test, { title: "Airbag", ...OK_COMPUTER });
    const lucky = addTrack(test, { title: "Lucky", ...OK_COMPUTER });
    const karma = addTrack(test, { title: "Karma Police", ...OK_COMPUTER });
    // On drive C, as main keeps a Windows path.
    db.run(sql`UPDATE tracks SET path = 'C:' || path`);
    let clock = 0;
    const now = () => (clock += 1_000);
    const made = storePlaylist(
      db,
      "Drive",
      [
        { source: "library", trackId: airbag },
        { source: "library", trackId: lucky },
        { source: "library", trackId: karma },
      ],
      now(),
    );
    const karmaItem = db.get<{ id: number }>(
      sql`SELECT id FROM playlist_items WHERE track_id=${karma}`,
    )!.id;
    removePlaylistItems(db, made.playlistId, [karmaItem], now());
    const syncId = db.get<{ id: string }>(
      sql`SELECT sync_id AS id FROM playlists WHERE id=${made.playlistId}`,
    )!.id;
    convertToCollaborative(
      db,
      made.playlistId,
      {
        playlistId: syncId,
        members: [{ accountId: "ana", name: "Ana", joinedAt: 1, owner: true, self: true }],
      },
      now(),
    );
    let changes = 0;
    const picked = { files: [] as string[] };
    const playlists = createPlaylists({
      db,
      platform: "win32",
      imageFolder: join(folder, "playlist-images"),
      codec: { original: () => undefined, squares: () => [] },
      pickImage: async () => undefined,
      pickPlaylists: async () => picked.files,
      changed: () => void changes++,
      now,
    });
    await run({
      db,
      folder,
      playlists,
      picked,
      drive: made.playlistId,
      tracks: { airbag, lucky, karma },
      changes: () => changes,
    });
  } finally {
    await runtime.dispose();
    rmSync(folder, { recursive: true, force: true });
  }
};

/** Everything a playlist shares with its members: its name and its entries, removed ones too. */
const shared = (db: LibraryDatabase, playlistId: number) => ({
  playlist: db.get(
    sql`SELECT name, deleted, changed_at AS changedAt FROM playlists WHERE id=${playlistId}`,
  ),
  entries: db.all(
    sql`SELECT id, track_id AS trackId, order_key AS orderKey, deleted, removed_at AS removedAt, changed_at AS changedAt
      FROM playlist_items WHERE playlist_id=${playlistId} ORDER BY id`,
  ),
});

const ports = (db: LibraryDatabase, playlists: ReturnType<typeof createPlaylists>) =>
  ({
    db,
    download: async () => {},
    queue: async () => {},
    removeSongs: async () => {},
    changed: () => {},
    fixSongs: async () => ({ fixed: 0, failed: 0 }) as never,
    removeFromPlaylist: playlists.removeSongs,
    runStreamed: async () => {},
  }) satisfies SongActionPorts;

test("Rename, Delete, Move, Restore, Remove from Graveyard and Remove from Playlist are refused", async () => {
  await setUp(async ({ db, playlists, drive, tracks, changes }) => {
    const before = shared(db, drive);
    const graveyard = playlists.graveyard(drive, 0, 10).items[0]!;
    const refusals: [string, () => unknown][] = [
      ["rename", () => playlists.rename(drive, "Trip")],
      ["delete", () => playlists.delete(drive)],
      ["move", () => playlists.move(drive, tracks.airbag, "down")],
      ["restore", () => playlists.restore(drive, graveyard.itemId)],
      ["forget one", () => playlists.forget(drive, graveyard.itemId)],
      ["empty graveyard", () => playlists.forget(drive)],
      ["remove songs", () => playlists.removeSongs(drive, [tracks.airbag])],
    ];
    for (const [what, edit] of refusals) assert.throws(edit, Error, what);
    assert.deepEqual(shared(db, drive), before);
    assert.equal(changes(), 0);
  });
});

test("the song menu's Add to Playlist and Remove from Playlist are refused, and a playlist's page offers no Remove", async () => {
  await setUp(async ({ db, playlists, drive, tracks }) => {
    const before = shared(db, drive);
    const onPage = { scope: { kind: "playlist" as const, id: drive }, ids: [tracks.airbag] };
    await assert.rejects(
      runSongAction(
        ports(db, playlists),
        { scope: { kind: "songs" }, ids: [tracks.karma] },
        "addToPlaylist",
        drive,
      ),
    );
    await assert.rejects(runSongAction(ports(db, playlists), onPage, "removeFromPlaylist"));
    assert.deepEqual(shared(db, drive), before);
    const actions = songMenu(db, onPage, "menu").entries.map((entry) => entry.action);
    assert.ok(!actions.includes("removeFromPlaylist"), actions.join());
  });
});

test("a YouTube Music song's Add to Playlist is refused", async () => {
  await setUp(async ({ db, drive }) => {
    const before = shared(db, drive);
    await assert.rejects(
      runStreamedAction(
        {
          db,
          ytMusic: () => true,
          downloads: {
            yt: async () => {},
            missing: async () => {},
            cancel: async () => {},
            retry: async () => {},
            status: () => null,
            ytStatus: () => null,
            unstarred: async () => {},
          } as never,
          queue: async () => {},
          changed: () => {},
        },
        {
          videoId: "abcdefghijk",
          title: "Creep",
          artists: ["Radiohead"],
          album: null,
          artworkUrl: null,
          durationMs: 238_000,
        } as never,
        "addToPlaylist",
        drive,
      ),
    );
    assert.deepEqual(shared(db, drive), before);
  });
});

test("an M3U import named as the playlist makes a playlist of its own instead of replacing it", async () => {
  await setUp(async ({ db, folder, playlists, picked, drive }) => {
    const before = shared(db, drive);
    const file = join(folder, "Drive.m3u8");
    writeFileSync(file, "C:\\Music\\OK Computer\\Airbag.mp3\n");
    picked.files = [file];
    const choice = await playlists.chooseImport();
    assert.deepEqual(choice?.files, [{ name: "Drive.m3u8", clash: null }]);
    const result = playlists.runImport(["replace"]);
    assert.notEqual(result.playlistId, drive);
    assert.deepEqual(shared(db, drive), before);
    assert.deepEqual(
      browseLibrary(db, { kind: "playlists" }, 0, 10).items.map((row) => row.title),
      ["Drive", "Drive 2"],
    );
  });
});

test("its menu knows it is collaborative", async () => {
  await setUp(async ({ playlists, drive }) => {
    assert.equal(playlists.info(drive)?.collaborative, true);
  });
});
