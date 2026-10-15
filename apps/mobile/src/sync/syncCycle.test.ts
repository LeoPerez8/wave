/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createPlaylist,
  deletePlaylist,
  movePlaylistItem,
  renamePlaylist,
  selectPlaylist,
  selectPlaylists,
} from "../library/db/playlists.ts";
import {
  addTrack,
  openTestDatabase,
  type FixtureTrack,
  type TestDatabase,
} from "../library/db/testDatabase.ts";
import { syncCycle, type SyncPreferences } from "./syncCycle.ts";
import { testSyncService, type TestSyncService } from "./testSyncService.ts";

const OK_COMPUTER: readonly FixtureTrack[] = [
  {
    title: "Airbag",
    album: "OK Computer",
    artist: "Radiohead",
    trackNumber: 1,
    durationMs: 284_000,
  },
  {
    title: "Paranoid Android",
    album: "OK Computer",
    artist: "Radiohead",
    trackNumber: 2,
    durationMs: 387_000,
  },
  {
    title: "Lucky",
    album: "OK Computer",
    artist: "Radiohead",
    trackNumber: 11,
    durationMs: 259_000,
  },
];

/** A phone signed in to the account [service] holds: its Library, its preferences and its clock. */
const phone = async (service: TestSyncService, songs: readonly FixtureTrack[] = OK_COMPUTER) => {
  const db = await openTestDatabase();
  const tracks = new Map(songs.map((song) => [song.title, addTrack(db, song)]));
  const stored = new Map<string, string>();
  let clock = 1_000;
  const preferences: SyncPreferences = {
    value: (key) => stored.get(key) ?? null,
    apply: (key, value) => {
      if (value === null) stored.delete(key);
      else stored.set(key, value);
    },
  };
  const now = () => (clock += 1_000);
  return {
    db,
    stored,
    now,
    /** The phone's Track of a song, by title. */
    track: (title: string): number => {
      const id = tracks.get(title);
      if (id === undefined) throw new Error(`no ${title}`);
      return id;
    },
    sync: (options: { readonly songsChanged?: boolean } = {}) =>
      syncCycle({
        db,
        transport: service,
        preferences,
        account: "ana@example.com",
        now,
        songsChanged: options.songsChanged ?? false,
        wait: async () => {},
      }),
  };
};

const playlistTitles = (db: TestDatabase) =>
  selectPlaylists(db).map((row) => ({
    name: row.name,
    songs:
      selectPlaylist(db, row.id)?.items.map((item) =>
        item.source === "library" ? item.track.title : `yt:${item.song.title}`,
      ) ?? [],
  }));

describe("syncCycle", () => {
  test("a playlist made, renamed, reordered and deleted on one phone shows on the other", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const b = await phone(service);
    await a.sync();
    await b.sync();

    const { playlistId } = createPlaylist(
      a.db,
      "Drive",
      [
        { source: "library", trackId: a.track("Airbag") },
        { source: "library", trackId: a.track("Lucky") },
      ],
      a.now(),
    );
    await a.sync();
    await b.sync();
    assert.deepEqual(playlistTitles(b.db), [{ name: "Drive", songs: ["Airbag", "Lucky"] }]);

    renamePlaylist(a.db, playlistId, "Night Drive", a.now());
    const lucky = selectPlaylist(a.db, playlistId)?.items[1]?.itemId ?? -1;
    movePlaylistItem(a.db, playlistId, lucky, 0, a.now());
    await a.sync();
    await b.sync();
    assert.deepEqual(playlistTitles(b.db), [{ name: "Night Drive", songs: ["Lucky", "Airbag"] }]);

    deletePlaylist(a.db, playlistId, a.now());
    await a.sync();
    await b.sync();
    assert.deepEqual(playlistTitles(b.db), []);
  });
});
