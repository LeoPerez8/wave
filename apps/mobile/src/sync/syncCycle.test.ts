/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { PlayEvent } from "@wave/core";

import {
  endPlay,
  listFavorites,
  recordPlay,
  selectFavoriteTrackIds,
  setFavorites,
} from "../library/db/playHistory.ts";
import { stampPreference } from "../library/db/sync.ts";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  movePlaylistItem,
  removePlaylistItems,
  renamePlaylist,
  selectPlaylist,
  selectPlaylists,
} from "../library/db/playlists.ts";
import { saveImportedPlays } from "../library/db/blackPlayer.ts";
import { trackPlayTotals } from "../library/db/stats.ts";
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
    /** Copies a file to the phone (as Syncthing would) and indexes it. */
    addFile: (song: FixtureTrack): number => {
      const id = addTrack(db, song);
      tracks.set(song.title, id);
      return id;
    },
    /** Changes a synced preference here, as Settings does. */
    setPreference: (key: string, value: string) => {
      stored.set(key, value);
      stampPreference(db, key, now());
    },
    sync: (
      options: {
        readonly songsChanged?: boolean;
        readonly to?: TestSyncService;
        readonly account?: string;
      } = {},
    ) =>
      syncCycle({
        db,
        transport: options.to ?? service,
        preferences,
        account: options.account ?? "ana@example.com",
        now,
        songsChanged: options.songsChanged ?? false,
        wait: async () => {},
      }),
  };
};

const EXIT_MUSIC: FixtureTrack = {
  title: "Exit Music",
  album: "OK Computer",
  artist: "Radiohead",
  trackNumber: 4,
  durationMs: 264_000,
};

const favoriteTitles = (db: TestDatabase) => listFavorites(db).map((row) => row.title);

/** A play of [trackId] as the player records it. */
const played = (
  trackId: number,
  startedAt: number,
  overrides: Partial<PlayEvent> = {},
): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt,
  listenedMs: 30_000,
  durationMs: 259_000,
  endReason: "completed",
  counted: true,
  source: "phone",
  ...overrides,
});

/** What Stats ranks songs by, per song title: counted plays, time listened, the latest play. */
const playCounts = (db: TestDatabase) =>
  trackPlayTotals(db, { from: null, to: Number.MAX_SAFE_INTEGER })
    .map((row) => [row.sortKey, row.countedPlays, row.listenedMs, row.latestPlayAt])
    .toSorted((x, y) => String(x[0]).localeCompare(String(y[0])));

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

  test("two phones editing one playlist offline keep both edits", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const b = await phone(service);
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

    // Offline, each its own way.
    addToPlaylist(
      a.db,
      playlistId,
      [{ source: "library", trackId: a.track("Paranoid Android") }],
      a.now(),
    );
    const onB = selectPlaylists(b.db)[0]?.id ?? -1;
    renamePlaylist(b.db, onB, "Road", b.now());
    const airbag = selectPlaylist(b.db, onB)?.items[0]?.itemId ?? -1;
    removePlaylistItems(b.db, onB, [airbag], b.now());

    await a.sync();
    await b.sync();
    await a.sync();
    const both = [{ name: "Road", songs: ["Lucky", "Paranoid Android"] }];
    assert.deepEqual(playlistTitles(a.db), both);
    assert.deepEqual(playlistTitles(b.db), both);
  });

  test("plays go up once each, a play going on once it ends, and the stats agree", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const b = await phone(service);
    const lucky = a.track("Lucky");
    const first = recordPlay(a.db, played(lucky, a.now()));
    endPlay(a.db, first, played(lucky, 2_000, { listenedMs: 259_000 }));
    const going = recordPlay(a.db, played(a.track("Airbag"), a.now(), { listenedMs: 5_000 }));
    await a.sync();
    await b.sync();
    assert.equal(service.rows().plays.length, 1);

    endPlay(a.db, going, played(a.track("Airbag"), 3_000, { listenedMs: 284_000 }));
    recordPlay(b.db, played(b.track("Lucky"), b.now()));
    // A play that never ended (Wave's process died) goes up once the next one starts.
    const paranoid = played(b.track("Paranoid Android"), b.now());
    endPlay(b.db, recordPlay(b.db, paranoid), paranoid);
    await a.sync();
    await b.sync();
    await a.sync();
    assert.equal(service.rows().plays.length, 4);
    assert.deepEqual(playCounts(a.db), playCounts(b.db));

    // Nothing new: a pull, and nothing goes up again.
    const requests = service.requests.length;
    await a.sync();
    assert.deepEqual(
      service.requests.slice(requests).map((request) => request.split("?")[0]),
      ["GET /v1/pull"],
    );
  });

  test("18,000 BlackPlayer plays go up in batches the service takes, once, from either phone", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const b = await phone(service);
    const history = (p: Awaited<ReturnType<typeof phone>>) =>
      Array.from({ length: 18_000 }, (_, n) => ({
        trackId: p.track(OK_COMPUTER[n % 3]?.title ?? ""),
        startedAt: 1_500_000_000_000 + n * 60_000,
      }));
    saveImportedPlays(a.db, history(a));
    saveImportedPlays(b.db, history(b));

    await a.sync();
    const pushes = service.requests.filter((request) => request.startsWith("POST")).length;
    assert.ok(pushes > 1, `${pushes} pushes`);
    assert.equal(service.rows().plays.length, 18_000);

    // The other phone imported the same stats: they're the same plays, and needn't go up.
    const before = service.requests.length;
    await b.sync();
    assert.equal(service.rows().plays.length, 18_000);
    assert.ok(!service.requests.slice(before).some((request) => request.startsWith("POST")));
    assert.deepEqual(playCounts(b.db), playCounts(a.db));
  });

  test("a preference picked on one phone applies on the other at its next pull", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const b = await phone(service);
    a.setPreference("settings.theme", '{"primary":"rose"}');
    await a.sync();
    const pulled = await b.sync();

    assert.equal(b.stored.get("settings.theme"), '{"primary":"rose"}');
    assert.deepEqual(pulled.pulled.preferences, [
      { key: "settings.theme", value: '{"primary":"rose"}' },
    ]);
    // Applied, not changed on b: nothing goes back up.
    assert.equal((await b.sync()).pushed, 0);

    b.setPreference("settings.theme", '{"primary":"teal"}');
    await b.sync();
    await a.sync();
    assert.equal(a.stored.get("settings.theme"), '{"primary":"teal"}');
  });

  test("signing in on a phone with its own Library loses nothing from either side", async () => {
    const service = testSyncService();
    const a = await phone(service);
    createPlaylist(a.db, "Drive", [{ source: "library", trackId: a.track("Airbag") }], a.now());
    setFavorites(a.db, [a.track("Airbag")], true, a.now());
    endPlay(
      a.db,
      recordPlay(a.db, played(a.track("Airbag"), 5_000)),
      played(a.track("Airbag"), 5_000),
    );
    await a.sync();

    // b was used signed out: a Library of its own, with a playlist of the same name.
    const b = await phone(service, [...OK_COMPUTER, EXIT_MUSIC]);
    createPlaylist(b.db, "Drive", [{ source: "library", trackId: b.track("Lucky") }], b.now());
    setFavorites(b.db, [b.track("Lucky"), b.track("Exit Music")], true, b.now());
    endPlay(
      b.db,
      recordPlay(b.db, played(b.track("Lucky"), 6_000)),
      played(b.track("Lucky"), 6_000),
    );
    await b.sync();
    await a.sync();

    for (const side of [a, b]) {
      // Two playlists named Drive stay two.
      assert.deepEqual(
        playlistTitles(side.db)
          .map((row) => `${row.name}: ${row.songs.join(", ")}`)
          .toSorted(),
        ["Drive: Airbag", "Drive: Lucky"],
      );
    }
    assert.deepEqual(favoriteTitles(b.db).toSorted(), ["Airbag", "Exit Music", "Lucky"]);
    assert.deepEqual(favoriteTitles(a.db).toSorted(), ["Airbag", "Lucky"]);
    assert.deepEqual(
      playCounts(a.db).map((row) => row[0]),
      ["airbag", "lucky"],
    );
    assert.deepEqual(playCounts(a.db), playCounts(b.db));
    assert.equal(service.rows().songs.filter((song) => !song.deleted).length, 4);
  });

  test("an account song the phone lacks waits, with its star, entries and plays, until its file comes", async () => {
    const service = testSyncService();
    const a = await phone(service, [...OK_COMPUTER, EXIT_MUSIC]);
    const exit = a.track("Exit Music");
    createPlaylist(
      a.db,
      "Night",
      [
        { source: "library", trackId: a.track("Lucky") },
        { source: "library", trackId: exit },
      ],
      a.now(),
    );
    setFavorites(a.db, [exit], true, a.now());
    endPlay(a.db, recordPlay(a.db, played(exit, 7_000)), played(exit, 7_000));
    await a.sync();

    const b = await phone(service);
    await b.sync();
    assert.deepEqual(playlistTitles(b.db), [{ name: "Night", songs: ["Lucky"] }]);
    assert.deepEqual(favoriteTitles(b.db), []);
    // Nothing the phone lacks goes back up as removed, and a sync with nothing new pulls only.
    assert.equal((await b.sync()).pushed, 0);
    assert.deepEqual(favoriteTitles(a.db), ["Exit Music"]);

    b.addFile(EXIT_MUSIC);
    await b.sync({ songsChanged: true });
    assert.deepEqual(playlistTitles(b.db), [{ name: "Night", songs: ["Lucky", "Exit Music"] }]);
    assert.deepEqual(favoriteTitles(b.db), ["Exit Music"]);
    assert.deepEqual(playCounts(b.db), playCounts(a.db));
  });

  test("signing in again joins as the first time does: everything goes up to the account", async () => {
    const first = testSyncService();
    const a = await phone(first);
    createPlaylist(a.db, "Drive", [{ source: "library", trackId: a.track("Airbag") }], a.now());
    a.setPreference("settings.glass", "{}");
    endPlay(
      a.db,
      recordPlay(a.db, played(a.track("Airbag"), 5_000)),
      played(a.track("Airbag"), 5_000),
    );
    await a.sync();

    const second = testSyncService();
    await a.sync({ to: second, account: "bea@example.com" });
    const rows = second.rows();
    assert.deepEqual(
      [rows.songs.length, rows.playlists.length, rows.playlistEntries.length],
      [3, 1, 1],
    );
    assert.deepEqual([rows.preferences.length, rows.plays.length], [1, 1]);
  });

  test("a request refused for the request rate goes again after a wait", async () => {
    const service = testSyncService();
    const a = await phone(service);
    service.refuse = 2;
    await a.sync();
    assert.equal(service.rows().songs.length, 3);
  });

  test("changes made offline wait and go up in full once online", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const b = await phone(service);
    await a.sync();
    service.offline = true;

    createPlaylist(a.db, "Day", [{ source: "library", trackId: a.track("Lucky") }], a.now());
    setFavorites(a.db, [a.track("Airbag")], true, a.now());
    const play = recordPlay(a.db, played(a.track("Lucky"), a.now()));
    endPlay(a.db, play, played(a.track("Lucky"), a.now(), { listenedMs: 259_000 }));
    await assert.rejects(a.sync());

    service.offline = false;
    await a.sync();
    await b.sync();
    assert.deepEqual(playlistTitles(b.db), [{ name: "Day", songs: ["Lucky"] }]);
    assert.deepEqual(selectFavoriteTrackIds(b.db), [b.track("Airbag")]);
    assert.deepEqual(playCounts(b.db), playCounts(a.db));
  });
});
