/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { normalizeTrack, type PlayEvent } from "@wave/core";
import { eq, inArray } from "drizzle-orm";

import type { IndexedTrack } from "../library/LibraryStore.ts";
import { selectAlbumDetail, selectAlbums } from "../library/db/albums.ts";
import { creditSplits } from "../library/db/credits.ts";
import { filesGone, removeSongs, signOut } from "../library/db/missingSongs.ts";
import { saveBatch } from "../library/db/save.ts";
import { selectSkippedFiles, skipFiles } from "../library/db/skippedFiles.ts";
import * as schema from "../library/db/schema.ts";
import {
  endPlay,
  listFavorites,
  recordPlay,
  selectFavoriteTrackIds,
  setFavorites,
} from "../library/db/playHistory.ts";
import { stampPreference } from "../library/db/sync.ts";
import { countFollows, removeFollow, saveFollow, selectFollow } from "../library/db/follows.ts";
import { hideFollowRelease, readFollowReleases } from "../library/db/followReleases.ts";
import { markShowNotified, readFollowShows } from "../library/db/followShows.ts";
import {
  addToPlaylist,
  addToShazam,
  createPlaylist,
  deletePlaylist,
  movePlaylistItem,
  removePlaylistItems,
  restorePlaylistItems,
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
import { selectJoinedAccount } from "../library/db/syncRows.ts";
import { syncCycle, type SyncPreferences, type SyncTransport } from "./syncCycle.ts";
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

/** A song on a phone; [videoId] for one downloaded from YouTube Music. */
type Song = FixtureTrack & { readonly videoId?: string };

/** The file of [song] as a scan reads it. */
const scanned = (song: Song): IndexedTrack => ({
  ...normalizeTrack({
    path: `/Music/${song.album}/${song.title}.mp3`,
    title: song.title,
    artist: song.artist,
    album: song.album,
    trackNumber: song.trackNumber === undefined ? null : String(song.trackNumber),
    durationMs: song.durationMs,
  }),
  videoId: song.videoId ?? null,
  sizeBytes: 1_000,
  modifiedAt: 0,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
  explicit: "unknown",
});

/** A phone signed in to the account [service] holds: its Library, its preferences and its clock. */
const phone = async (service: TestSyncService, songs: readonly Song[] = OK_COMPUTER) => {
  const db = await openTestDatabase();
  const splits = creditSplits();
  const tracks = new Map(songs.map((song) => [song.title, addTrack(db, song)]));
  for (const song of songs) {
    if (song.videoId !== undefined) {
      db.update(schema.tracks)
        .set({ videoId: song.videoId })
        .where(eq(schema.tracks.id, tracks.get(song.title) ?? -1))
        .run();
    }
  }
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
  /** The phone's Track of a song, by title. */
  const track = (title: string): number => {
    const id =
      tracks.get(title) ??
      db
        .select({ id: schema.tracks.id })
        .from(schema.tracks)
        .where(eq(schema.tracks.title, title))
        .get()?.id;
    if (id === undefined) throw new Error(`no ${title}`);
    return id;
  };
  return {
    db,
    stored,
    now,
    track,
    /** Copies a file to the phone (as Syncthing would), and a scan saves it. */
    addFile: (song: Song): number => {
      const file = scanned(song);
      saveBatch(db, splits, [file], [], [], now());
      const id = db
        .select({ id: schema.tracks.id })
        .from(schema.tracks)
        .where(eq(schema.tracks.path, file.path))
        .get()?.id;
      if (id === undefined) throw new Error(`${song.title} wasn't saved`);
      tracks.set(song.title, id);
      return id;
    },
    /** The file of [song] is retagged as [tags] (an editor, then a scan saves it again). */
    retag: (song: Song, tags: Partial<Song>): void => {
      const file = scanned(song);
      const retagged = { ...scanned({ ...song, ...tags }), path: file.path };
      saveBatch(
        db,
        splits,
        [{ ...retagged, folder: file.folder, fileName: file.fileName }],
        [],
        [],
        now(),
      );
    },
    /** A download asked for missing song [trackId] saves [song]'s file, as its import does. */
    download: (song: Song, trackId: number): void => {
      saveBatch(db, splits, [{ ...scanned(song), fills: trackId }], [], [], now());
    },
    /** A scan no longer finds the files of these songs (an unmounted or emptied folder). */
    loseFiles: (titles: readonly string[]) => {
      const paths = db
        .select({ path: schema.tracks.path })
        .from(schema.tracks)
        .where(inArray(schema.tracks.title, [...titles]))
        .all()
        .flatMap((row) => row.path ?? []);
      filesGone(db, splits, paths);
    },
    /** Remove from Library (a missing song), or Delete once the file is gone (a song with one). */
    remove: (title: string) => {
      removeSongs(db, splits, [track(title)], now());
      tracks.delete(title);
    },
    /** A scan finds [title]'s file is a voice note and leaves it out (Core's `isVoiceNoteOrRecording`). */
    skipFile: (title: string) => {
      const row = db
        .select({ path: schema.tracks.path })
        .from(schema.tracks)
        .where(eq(schema.tracks.id, track(title)))
        .get();
      if (row?.path == null) throw new Error(`${title} has no file`);
      skipFiles(db, splits, [{ path: row.path, sizeBytes: 1_000, modifiedAt: 0 }], now());
      tracks.delete(title);
    },
    /** Signs out of the Wave account. */
    signOut: () => signOut(db, splits),
    /** Changes a synced preference here, as Settings does. */
    setPreference: (key: string, value: string) => {
      stored.set(key, value);
      stampPreference(db, key, now());
    },
    sync: (
      options: {
        readonly songsChanged?: boolean;
        readonly to?: SyncTransport;
        readonly account?: string;
        readonly turn?: () => Promise<void>;
      } = {},
    ) =>
      syncCycle({
        db,
        splits,
        transport: options.to ?? service,
        preferences,
        account: options.account ?? "ana@example.com",
        now,
        songsChanged: options.songsChanged ?? false,
        wait: async () => {},
        ...(options.turn === undefined ? {} : { turn: options.turn }),
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

/** Every song in the Library, album by album in album order, and whether the phone has its file. */
const files = (db: TestDatabase): [string, boolean][] =>
  selectAlbums(db, undefined).flatMap(
    (album) =>
      selectAlbumDetail(db, album.id)?.tracks.map((track): [string, boolean] => [
        track.title,
        track.path !== null,
      ]) ?? [],
  );

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

  test("a pulled tap duration leaves the old local value alone and never goes back up", async () => {
    const service = testSyncService();
    await service.request(
      "POST",
      "/v1/push",
      JSON.stringify({
        preferences: [
          {
            id: "settings.tapAnimationMs",
            value: "600",
            changedAt: 9_000,
            phoneId: "older-wave",
            deleted: false,
          },
        ],
      }),
    );
    const a = await phone(service, []);
    a.setPreference("settings.tapAnimationMs", "0");

    const result = await a.sync();

    assert.equal(a.stored.get("settings.tapAnimationMs"), "0");
    assert.deepEqual(result.pulled.preferences, []);
    assert.equal(result.pushed, 0);
    assert.equal((await a.sync()).pushed, 0);
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

  test("a follow made on one phone shows on the other with its level, and an unfollow removes it there", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const b = await phone(service);
    saveFollow(a.db, { name: "Massive Attack", deezerId: 2_163 }, "releases", a.now());
    await a.sync();
    const pulled = await b.sync();

    assert.equal(pulled.pulled.follows, true);
    assert.deepEqual(
      [selectFollow(b.db, "massive attack")?.name, selectFollow(b.db, "Massive Attack")?.level],
      ["Massive Attack", "releases"],
    );
    assert.equal(selectFollow(b.db, "Massive Attack")?.deezerId, 2_163);
    // Applied, not changed on b: nothing goes back up, nor when the same follow is saved again.
    saveFollow(b.db, { name: "Massive Attack", deezerId: 2_163 }, "releases", b.now());
    assert.equal((await b.sync()).pushed, 0);

    saveFollow(b.db, { name: "Massive Attack" }, "shows", b.now());
    await b.sync();
    await a.sync();
    assert.equal(selectFollow(a.db, "Massive Attack")?.level, "shows");

    removeFollow(a.db, "Massive Attack", a.now());
    await a.sync();
    await b.sync();
    assert.equal(selectFollow(b.db, "Massive Attack"), null);
    assert.equal(countFollows(b.db), 0);
  });

  test("a release hidden or a show notified on one phone stays hidden and quiet on the other", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const b = await phone(service);
    hideFollowRelease(a.db, "deezer:302127", a.now());
    assert.equal(markShowNotified(a.db, "G5vYZ9Ma1Jb5U", a.now()), true);
    await a.sync();
    await b.sync();

    assert.deepEqual(readFollowReleases(b.db).hidden, ["deezer:302127"]);
    assert.deepEqual(readFollowShows(b.db).notified, ["G5vYZ9Ma1Jb5U"]);
    // The claim another phone made holds here: this phone doesn't notify it again.
    assert.equal(markShowNotified(b.db, "G5vYZ9Ma1Jb5U", b.now()), false);
    assert.equal((await b.sync()).pushed, 0);
  });

  test("signing out keeps follows on the phone, and signing in again merges them", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const b = await phone(service);
    saveFollow(a.db, { name: "Portishead" }, "releases", a.now());
    await a.sync();
    a.signOut();
    assert.equal(selectFollow(a.db, "Portishead")?.level, "releases");

    // Signed out, a follow stays here, and goes up with the rest at the next sign-in.
    saveFollow(a.db, { name: "Tricky" }, "shows", a.now());
    saveFollow(b.db, { name: "Björk" }, "releases", b.now());
    assert.equal(service.rows().follows.length, 1);
    await a.sync();
    await b.sync();
    assert.deepEqual(
      ["Portishead", "Tricky", "Björk"].map((name) => selectFollow(b.db, name)?.level),
      ["releases", "shows", "releases"],
    );
  });

  test("the synced Shazam id fills the same playlist on a second phone with different local ids", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const b = await phone(service);
    createPlaylist(b.db, "On this phone", [], b.now());
    const saved = addToShazam(
      a.db,
      null,
      { source: "library", trackId: a.track("Airbag") },
      a.now(),
    );
    a.setPreference("settings.shazamPlaylistId", saved.syncId);
    await a.sync();
    await b.sync();
    assert.equal(b.stored.get("settings.shazamPlaylistId"), saved.syncId);
    const target = selectPlaylists(b.db).find((playlist) => playlist.name === "Shazam")!;
    assert.notEqual(target.id, saved.playlistId);
    renamePlaylist(b.db, target.id, "Recognized songs", b.now());
    const added = addToShazam(
      b.db,
      b.stored.get("settings.shazamPlaylistId") ?? null,
      { source: "library", trackId: b.track("Lucky") },
      b.now(),
    );
    assert.equal(added.syncId, saved.syncId);
    await b.sync();
    await a.sync();
    const expected = [
      { name: "On this phone", songs: [] },
      { name: "Recognized songs", songs: ["Lucky", "Airbag"] },
    ];
    assert.deepEqual(
      playlistTitles(a.db).toSorted((x, y) => x.name.localeCompare(y.name)),
      expected,
    );
    assert.deepEqual(
      playlistTitles(b.db).toSorted((x, y) => x.name.localeCompare(y.name)),
      expected,
    );
    const duplicate = addToShazam(
      b.db,
      saved.syncId,
      { source: "library", trackId: b.track("Airbag") },
      b.now(),
    );
    assert.equal(duplicate.toast, "Already in Shazam");
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
    // a lacks Exit Music's file: it's a missing song there, starred.
    assert.deepEqual(favoriteTitles(a.db).toSorted(), ["Airbag", "Exit Music", "Lucky"]);
    assert.deepEqual(
      playCounts(a.db).map((row) => row[0]),
      ["airbag", "lucky"],
    );
    assert.deepEqual(playCounts(a.db), playCounts(b.db));
    assert.equal(service.rows().songs.filter((song) => !song.deleted).length, 4);
  });

  test("an account song the phone lacks comes in as a missing song, with its star, entries and plays, and its file fills it in", async () => {
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
    const pulled = await b.sync();
    assert.ok(pulled.pulled.songs);
    assert.deepEqual(playlistTitles(b.db), [{ name: "Night", songs: ["Lucky", "Exit Music"] }]);
    assert.deepEqual(favoriteTitles(b.db), ["Exit Music"]);
    assert.deepEqual(playCounts(b.db), playCounts(a.db));
    assert.deepEqual(files(b.db), [
      ["Airbag", true],
      ["Paranoid Android", true],
      ["Exit Music", false],
      ["Lucky", true],
    ]);
    // Nothing the phone lacks goes back up as removed, and a sync with nothing new pulls only.
    assert.equal((await b.sync()).pushed, 0);
    assert.deepEqual(favoriteTitles(a.db), ["Exit Music"]);

    // The file comes (Syncthing): it fills the missing song in, the same Track.
    const missing = b.track("Exit Music");
    assert.equal(b.addFile(EXIT_MUSIC), missing);
    await b.sync({ songsChanged: true });
    assert.deepEqual(files(b.db).at(2), ["Exit Music", true]);
    assert.deepEqual(playlistTitles(b.db), [{ name: "Night", songs: ["Lucky", "Exit Music"] }]);
    assert.deepEqual(favoriteTitles(b.db), ["Exit Music"]);
    assert.deepEqual(playCounts(b.db), playCounts(a.db));
    assert.equal(service.rows().songs.length, 4);
  });

  test("a fresh install signed in shows the whole Library at once, every song missing, and files fill it in without doubles", async () => {
    const service = testSyncService();
    const a = await phone(service, [...OK_COMPUTER, EXIT_MUSIC]);
    await a.sync();

    const b = await phone(service, []);
    await b.sync();
    assert.deepEqual(
      selectAlbums(b.db, undefined).map((album) => [album.title, album.trackCount]),
      [["OK Computer", 4]],
    );
    assert.ok(files(b.db).every(([, file]) => !file));

    for (const song of OK_COMPUTER) b.addFile(song);
    await b.sync({ songsChanged: true });
    assert.deepEqual(files(b.db), [
      ["Airbag", true],
      ["Paranoid Android", true],
      ["Exit Music", false],
      ["Lucky", true],
    ]);
    // Nothing went up twice, and the account still has the song b lacks.
    assert.equal(service.rows().songs.filter((song) => !song.deleted).length, 4);
  });

  test("a download fills in the missing song it was asked for, even tagged otherwise, keeping its places, star and plays", async () => {
    const service = testSyncService();
    const a = await phone(service, [...OK_COMPUTER, EXIT_MUSIC]);
    const exit = a.track("Exit Music");
    createPlaylist(
      a.db,
      "Night",
      [
        { source: "library", trackId: exit },
        { source: "library", trackId: a.track("Lucky") },
      ],
      a.now(),
    );
    setFavorites(a.db, [exit], true, a.now());
    endPlay(a.db, recordPlay(a.db, played(exit, 7_000)), played(exit, 7_000));
    await a.sync();

    const b = await phone(service, []);
    await b.sync();
    const missing = b.track("Exit Music");
    // YouTube Music's file says another title and album: by its tags it's another recording.
    b.download(
      { title: "Exit Music (For a Film)", album: "OK Computer OKNOTOK", artist: "Radiohead" },
      missing,
    );
    const filled = b.db
      .select({ id: schema.tracks.id, path: schema.tracks.path })
      .from(schema.tracks)
      .where(eq(schema.tracks.id, missing))
      .get();
    assert.equal(filled?.path, "/Music/OK Computer OKNOTOK/Exit Music (For a Film).mp3");
    assert.deepEqual(selectFavoriteTrackIds(b.db), [missing]);
    assert.deepEqual(
      selectPlaylist(b.db, selectPlaylists(b.db)[0]?.id ?? -1)?.items.map((item) =>
        item.source === "library" ? item.track.id : null,
      ),
      [missing, b.track("Lucky")],
    );
    assert.equal(playCounts(b.db).length, 1);

    // It stays the account's song: nothing new goes up, and it doesn't come back missing.
    await b.sync({ songsChanged: true });
    assert.equal(service.rows().songs.filter((song) => !song.deleted).length, 4);
    assert.equal(
      b.db
        .select()
        .from(schema.tracks)
        .all()
        .filter((track) => track.path === null).length,
      3,
    );
    assert.deepEqual(favoriteTitles(a.db), ["Exit Music"]);
  });

  test("files a scan no longer finds while signed in become missing songs, and the account keeps them", async () => {
    const service = testSyncService();
    const a = await phone(service);
    setFavorites(a.db, [a.track("Lucky")], true, a.now());
    await a.sync();

    a.loseFiles(["Airbag", "Paranoid Android", "Lucky"]);
    await a.sync({ songsChanged: true });
    assert.ok(files(a.db).every(([, file]) => !file));
    assert.equal(files(a.db).length, 3);
    assert.deepEqual(favoriteTitles(a.db), ["Lucky"]);
    assert.equal(service.rows().songs.filter((song) => !song.deleted).length, 3);
    assert.equal(service.rows().favorites.filter((star) => !star.deleted).length, 1);

    // The folder is back: the files fill their songs in again.
    for (const song of OK_COMPUTER) a.addFile(song);
    assert.ok(files(a.db).every(([, file]) => file));
    assert.equal(files(a.db).length, 3);
  });

  test("signed out, a scan that no longer finds a file removes its song, as before", async () => {
    const a = await phone(testSyncService());
    a.loseFiles(["Lucky"]);
    assert.deepEqual(
      files(a.db).map(([title]) => title),
      ["Airbag", "Paranoid Android"],
    );
  });

  test("Remove from Library and Delete take the song out of the account, and other phones lose it at their next pull", async () => {
    const service = testSyncService();
    const a = await phone(service, [...OK_COMPUTER, EXIT_MUSIC]);
    await a.sync();
    const b = await phone(service, []);
    await b.sync();

    // b removes a song it doesn't have; a deletes one it has.
    b.remove("Exit Music");
    await b.sync();
    a.remove("Lucky");
    await a.sync({ songsChanged: true });
    await b.sync();
    await a.sync();

    assert.deepEqual(
      service
        .rows()
        .songs.flatMap((song) => (song.deleted ? [] : [song.title]))
        .toSorted(),
      ["Airbag", "Paranoid Android"],
    );
    assert.deepEqual(
      files(b.db).map(([title]) => title),
      ["Airbag", "Paranoid Android"],
    );
    // a has Exit Music's file: a pull never takes a file's song away.
    assert.deepEqual(
      files(a.db).map(([title]) => title),
      ["Airbag", "Paranoid Android", "Exit Music"],
    );
  });

  test("a file a scan skips as a voice note leaves the Library and the account with its star and entries, and never comes back as a missing song", async () => {
    const service = testSyncService();
    const voiceNote: Song = {
      title: "PTT-20260412-WA0017",
      album: "Unknown Album",
      artist: "Unknown Artist",
      durationMs: 12_000,
    };
    const a = await phone(service, [...OK_COMPUTER, voiceNote]);
    setFavorites(a.db, [a.track(voiceNote.title)], true, a.now());
    createPlaylist(
      a.db,
      "Night",
      [
        { source: "library", trackId: a.track("Airbag") },
        { source: "library", trackId: a.track(voiceNote.title) },
      ],
      a.now(),
    );
    await a.sync();
    const b = await phone(service, []);
    await b.sync();
    assert.equal(files(b.db).length, 4);

    a.skipFile(voiceNote.title);
    await a.sync({ songsChanged: true });
    await b.sync();
    await a.sync();

    for (const db of [a.db, b.db]) {
      assert.deepEqual(
        files(db).map(([title]) => title),
        ["Airbag", "Paranoid Android", "Lucky"],
      );
      assert.deepEqual(favoriteTitles(db), []);
      assert.deepEqual(playlistTitles(db), [{ name: "Night", songs: ["Airbag"] }]);
    }
    assert.deepEqual(
      selectSkippedFiles(a.db, ["/Music"]).map((file) => file.path),
      ["/Music/Unknown Album/PTT-20260412-WA0017.mp3"],
    );
  });

  test("a removed song's star and playlist entries leave the account with it, even on a phone that keeps its file", async () => {
    const service = testSyncService();
    const a = await phone(service, [...OK_COMPUTER, EXIT_MUSIC]);
    const exit = a.track("Exit Music");
    const lucky = a.track("Lucky");
    createPlaylist(
      a.db,
      "Night",
      [
        { source: "library", trackId: a.track("Airbag") },
        { source: "library", trackId: lucky },
        { source: "library", trackId: exit },
      ],
      a.now(),
    );
    setFavorites(a.db, [lucky, exit], true, a.now());
    await a.sync();
    const b = await phone(service);
    await b.sync();
    assert.deepEqual(favoriteTitles(b.db).toSorted(), ["Exit Music", "Lucky"]);

    // a deletes Lucky, which b has the file of; b removes Exit Music, which it lacks.
    a.remove("Lucky");
    await a.sync({ songsChanged: true });
    b.remove("Exit Music");
    await b.sync();
    await a.sync();

    assert.deepEqual(favoriteTitles(a.db), []);
    assert.deepEqual(favoriteTitles(b.db), []);
    assert.deepEqual(playlistTitles(a.db), [{ name: "Night", songs: ["Airbag"] }]);
    assert.deepEqual(playlistTitles(b.db), [{ name: "Night", songs: ["Airbag"] }]);
    assert.deepEqual(
      files(b.db).map(([title]) => title),
      ["Airbag", "Paranoid Android", "Lucky"],
    );
    // The removals went up once.
    assert.equal((await a.sync()).pushed, 0);
    assert.equal((await b.sync()).pushed, 0);
    // A phone signing in later gets none of them back.
    const c = await phone(service);
    await c.sync();
    assert.deepEqual(favoriteTitles(c.db), []);
    assert.deepEqual(playlistTitles(c.db), [{ name: "Night", songs: ["Airbag"] }]);
  });

  test("a file retagged to another recording key takes its star and entries along, and its old version leaves the account", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const lucky = a.track("Lucky");
    createPlaylist(
      a.db,
      "Night",
      [
        { source: "library", trackId: a.track("Airbag") },
        { source: "library", trackId: lucky },
      ],
      a.now(),
    );
    setFavorites(a.db, [lucky], true, a.now());
    endPlay(a.db, recordPlay(a.db, played(lucky, 7_000)), played(lucky, 7_000));
    await a.sync();
    // b has the files, still tagged as they were; c has none.
    const b = await phone(service);
    await b.sync();
    const c = await phone(service, []);
    await c.sync();

    const LUCKY = OK_COMPUTER[2] as FixtureTrack;
    a.retag(LUCKY, { title: "Lucky (Remastered)" });
    await a.sync({ songsChanged: true });
    await b.sync();
    await c.sync();
    await a.sync();

    // a shows its file once, under its new tags, with its star, place and plays.
    assert.deepEqual(files(a.db), [
      ["Airbag", true],
      ["Paranoid Android", true],
      ["Lucky (Remastered)", true],
    ]);
    assert.deepEqual(favoriteTitles(a.db), ["Lucky (Remastered)"]);
    assert.deepEqual(playlistTitles(a.db), [
      { name: "Night", songs: ["Airbag", "Lucky (Remastered)"] },
    ]);
    assert.equal(playCounts(a.db).length, 1);
    assert.deepEqual(
      service
        .rows()
        .songs.flatMap((song) => (song.deleted ? [] : [song.title]))
        .toSorted(),
      ["Airbag", "Lucky (Remastered)", "Paranoid Android"],
    );
    // c, with no file, has only the new version, starred and in its place.
    assert.deepEqual(files(c.db), [
      ["Airbag", false],
      ["Paranoid Android", false],
      ["Lucky (Remastered)", false],
    ]);
    assert.deepEqual(favoriteTitles(c.db), ["Lucky (Remastered)"]);
    assert.deepEqual(playlistTitles(c.db), [
      { name: "Night", songs: ["Airbag", "Lucky (Remastered)"] },
    ]);
    // b keeps its file as it's tagged there; the star and the place move to the new version.
    assert.deepEqual(files(b.db), [
      ["Airbag", true],
      ["Paranoid Android", true],
      ["Lucky", true],
      ["Lucky (Remastered)", false],
    ]);
    assert.deepEqual(favoriteTitles(b.db), ["Lucky (Remastered)"]);
    assert.deepEqual(playlistTitles(b.db), [
      { name: "Night", songs: ["Airbag", "Lucky (Remastered)"] },
    ]);
    assert.equal((await a.sync()).pushed, 0);
    assert.equal((await b.sync()).pushed, 0);
  });

  test("signing out leaves no missing song, and a playlist entry of one becomes a YT Music entry or leaves", async () => {
    const service = testSyncService();
    const a = await phone(service, [...OK_COMPUTER, { ...EXIT_MUSIC, videoId: "exit-video" }]);
    createPlaylist(
      a.db,
      "Night",
      [
        { source: "library", trackId: a.track("Lucky") },
        { source: "library", trackId: a.track("Exit Music") },
        { source: "library", trackId: a.track("Airbag") },
      ],
      a.now(),
    );
    await a.sync();
    const b = await phone(service, [OK_COMPUTER[0] as FixtureTrack]);
    await b.sync();

    b.signOut();
    assert.deepEqual(files(b.db), [["Airbag", true]]);
    assert.deepEqual(playlistTitles(b.db), [{ name: "Night", songs: ["yt:Exit Music", "Airbag"] }]);
    // Signing in again joins anew: the missing songs come back, the YT Music entry stays one.
    await b.sync();
    assert.equal(files(b.db).length, 4);
  });

  test("a pull that lands after signing out changes nothing: no missing song comes back", async () => {
    const service = testSyncService();
    const a = await phone(service, [...OK_COMPUTER, EXIT_MUSIC]);
    await a.sync();
    const b = await phone(service, [OK_COMPUTER[0] as FixtureTrack]);
    await b.sync();
    b.signOut();

    // Signed in again, and out while the first pull is on its way.
    const signedOutMidPull: SyncTransport = {
      request: async (method, path, body) => {
        const response = await service.request(method, path, body);
        if (path.startsWith("/v1/pull")) b.signOut();
        return response;
      },
    };
    await assert.rejects(b.sync({ to: signedOutMidPull }), { code: "ERR_WAVE_SIGNED_OUT" });
    assert.deepEqual(files(b.db), [["Airbag", true]]);
    assert.equal(selectJoinedAccount(b.db), null);
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

  test("a sync's database work waits for the app's free turns, and still finishes", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const b = await phone(service);
    createPlaylist(a.db, "Day", [{ source: "library", trackId: a.track("Lucky") }], a.now());
    await a.sync();

    let open = false;
    let turns = 0;
    const waiting: (() => void)[] = [];
    const turn = (): Promise<void> => {
      turns += 1;
      return open ? Promise.resolve() : new Promise((resolve) => waiting.push(resolve));
    };
    const syncing = b.sync({ turn });
    for (let i = 0; i < 50; i++) await new Promise((resolve) => setImmediate(resolve));
    // The owner is busy: the sync waits, with nothing of the account's applied yet.
    assert.equal(waiting.length, 1);
    assert.deepEqual(playlistTitles(b.db), []);

    open = true;
    for (const release of waiting.splice(0)) release();
    await syncing;
    assert.deepEqual(playlistTitles(b.db), [{ name: "Day", songs: ["Lucky"] }]);
    // Joining, the pulled page, settling and the push's read (nothing to push): a turn each.
    assert.equal(turns, 4);
  });

  test("signing out while a pulled page waits for its turn applies none of it", async () => {
    const service = testSyncService();
    const a = await phone(service);
    const b = await phone(service);
    createPlaylist(a.db, "Day", [{ source: "library", trackId: a.track("Lucky") }], a.now());
    await a.sync();

    let turns = 0;
    let release = (): void => {};
    // The first turn (joining) is free; the pulled page's waits.
    const turn = (): Promise<void> =>
      ++turns === 1 ? Promise.resolve() : new Promise((resolve) => (release = resolve));
    const syncing = b.sync({ turn });
    for (let i = 0; i < 50 && turns < 2; i++) await new Promise((r) => setImmediate(r));
    assert.equal(turns, 2);
    b.signOut();
    release();
    await assert.rejects(syncing, { code: "ERR_WAVE_SIGNED_OUT" });
    assert.deepEqual(playlistTitles(b.db), []);
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

test("playlist removal and Undo sync the same entries and order to another phone", async () => {
  const service = testSyncService();
  const a = await phone(service);
  const b = await phone(service);
  const { playlistId } = createPlaylist(
    a.db,
    "Undo",
    [
      { source: "library", trackId: a.track("Airbag") },
      {
        source: "stream",
        song: {
          videoId: "stream",
          title: "Stream",
          artists: ["Guest"],
          album: null,
          durationMs: 180000,
          artworkUrl: null,
          explicit: false,
        },
      },
      {
        source: "unsearched",
        song: {
          title: "Pending",
          artists: ["Guest"],
          album: null,
          durationMs: null,
          artworkUrl: null,
        },
      },
      { source: "library", trackId: a.track("Lucky") },
    ],
    a.now(),
  );
  await a.sync();
  await b.sync();
  const onB = selectPlaylists(b.db)[0]!.id;
  const original = selectPlaylist(b.db, onB)!.items;
  const removed = selectPlaylist(a.db, playlistId)!.items.slice(1, 3);
  const removal = removePlaylistItems(
    a.db,
    playlistId,
    removed.map((e) => e.itemId),
    a.now(),
  );
  await a.sync();
  await b.sync();
  assert.deepEqual(
    selectPlaylist(b.db, onB)!.items.map((e) => e.source),
    ["library", "library"],
  );
  restorePlaylistItems(a.db, removal, a.now());
  await a.sync();
  await b.sync();
  assert.deepEqual(selectPlaylist(b.db, onB)!.items, original);
});
