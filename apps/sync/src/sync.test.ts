import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readPullPage } from "@wave/core";
import { migrate } from "./migrations.ts";
import { favorite, harness, pull, pullAll, push } from "./testing.ts";

const song = (
  id: string,
  changedAt: number,
  overrides: Readonly<Record<string, unknown>> = {},
) => ({
  id,
  changedAt,
  phoneId: "phone-a",
  deleted: false,
  title: "Teardrop",
  credit: "Massive Attack",
  album: "Mezzanine",
  albumArtist: "Massive Attack",
  discNumber: null,
  trackNumber: 3,
  durationMs: 330_000,
  releaseDate: null,
  year: 1998,
  genre: "Trip-Hop",
  videoId: null,
  addedAt: 1_700_000_000_000,
  ...overrides,
});

const playlist = (id: string, changedAt: number, phoneId: string, name: string) => ({
  id,
  changedAt,
  phoneId,
  deleted: false,
  name,
  createdAt: 1_700_000_000_000,
});

const play = (id: string, overrides: Readonly<Record<string, unknown>> = {}) => ({
  id,
  songId: "song-1",
  startedAt: 1_700_000_100_000,
  listenedMs: 200_000,
  durationMs: 330_000,
  endReason: "completed",
  counted: true,
  contextType: "album",
  contextId: "Mezzanine",
  contextPlaylistId: null,
  source: "phone",
  importedFrom: null,
  ...overrides,
});

const preference = (changedAt: number, value: unknown) => ({
  id: "settings.ytMusic",
  changedAt,
  phoneId: "phone-a",
  deleted: false,
  value,
});

describe("POST /v1/push and GET /v1/pull", () => {
  test("a desktop play is stored and returned unchanged to another device", async () => {
    const service = await harness();
    const desktop = await service.signIn();
    const phone = await service.signIn();
    const row = play("desktop-device:1", { source: "desktop" });

    const accepted = await push(service, desktop, { plays: [row] });
    assert.equal((accepted.accepted as Record<string, number>).plays, 1);
    assert.deepEqual((await pull(service, phone)).plays, [
      { ...row, snapshot: null, videoId: null },
    ]);
    await push(service, desktop, { plays: [row] });
    assert.equal((await pull(service, phone)).plays.length, 1);
  });

  test("malformed play metadata refuses the whole push", async () => {
    const service = await harness();
    const session = await service.signIn();
    const snapshot = {
      title: "Teardrop",
      artist: "Massive Attack",
      album: null,
      artworkPath: null,
      thumbPath: null,
    };
    for (const metadata of [
      { snapshot: "not an object" },
      { snapshot: [] },
      { snapshot: {} },
      { snapshot: { ...snapshot, title: 42 } },
      { snapshot: { ...snapshot, artist: ["Massive Attack"] } },
      { snapshot: { ...snapshot, album: false } },
      { snapshot: { ...snapshot, artworkPath: 42 } },
      { snapshot: { ...snapshot, thumbPath: {} } },
      { videoId: 42 },
    ]) {
      const response = await service.request("POST", "/v1/push", {
        session,
        json: { plays: [play("valid"), play("invalid", metadata)] },
      });
      assert.equal(response.status, 400, JSON.stringify(metadata));
    }
    assert.deepEqual((await pull(service, session)).plays, []);
  });

  test("snapshot text obeys the service's field length limit and invalid pushes store nothing", async () => {
    const service = await harness();
    const session = await service.signIn();
    const snapshot = {
      title: "Teardrop",
      artist: "Massive Attack",
      album: null,
      artworkPath: null,
      thumbPath: null,
    };
    for (const field of Object.keys(snapshot)) {
      const response = await service.request("POST", "/v1/push", {
        session,
        json: {
          plays: [
            play("valid"),
            play("invalid", { snapshot: { ...snapshot, [field]: "x".repeat(16_385) } }),
          ],
        },
      });
      assert.equal(response.status, 400, field);
      assert.deepEqual(await response.json(), {
        error: "bad_request",
        detail: `plays[1].snapshot.${field} is too long`,
      });
    }
    assert.deepEqual((await pull(service, session)).plays, []);
  });

  test("a playlist play keeps its playlist's sync id, and one pushed without it has none", async () => {
    const service = await harness();
    const session = await service.signIn();
    const fromPlaylist = play("playlist-play", {
      contextType: "playlist",
      contextId: "7",
      contextPlaylistId: "playlist-sync-id",
    });
    const { contextPlaylistId: _, ...older } = play("older-playlist-play", {
      contextType: "playlist",
      contextId: "7",
    });
    await push(service, session, { plays: [fromPlaylist, older] });

    const page = await pull(service, session);
    assert.deepEqual(page.plays, [
      { ...fromPlaylist, snapshot: null, videoId: null },
      { ...older, contextPlaylistId: null, snapshot: null, videoId: null },
    ]);
    assert.deepEqual(readPullPage(JSON.stringify(page))?.plays, page.plays);
  });

  test("an older client can push and pull plays without snapshot or video id", async () => {
    const service = await harness();
    const session = await service.signIn();
    const legacy = play("old-client-play");
    await push(service, session, { plays: [legacy] });

    const page = await pull(service, session);
    assert.deepEqual(page.plays, [{ ...legacy, snapshot: null, videoId: null }]);
    assert.deepEqual(readPullPage(JSON.stringify(page))?.plays, page.plays);
    await push(service, session, { plays: [play("next-old-client-play")] });
    assert.deepEqual((await pull(service, session, page.cursor)).plays, [
      { ...play("next-old-client-play"), snapshot: null, videoId: null },
    ]);
  });

  test("upgrading an existing database keeps its old plays readable", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, { plays: [play("before-upgrade")] });
    // Recreate the deployed schema with an existing play, before migration 0005.
    await service.db.batch(
      [
        "ALTER TABLE plays DROP COLUMN snapshot",
        "ALTER TABLE plays DROP COLUMN video_id",
        "DELETE FROM migrations WHERE id = '0005_play_snapshots'",
      ],
      "write",
    );

    assert.deepEqual(await migrate(service.db), ["0005_play_snapshots"]);
    assert.deepEqual((await pull(service, session)).plays, [
      { ...play("before-upgrade"), snapshot: null, videoId: null },
    ]);
    assert.deepEqual(await migrate(service.db), []);
  });

  test("another phone gets Library and streamed play snapshots without needing a song row", async () => {
    const service = await harness();
    const phoneA = await service.signIn();
    const phoneB = await service.signIn();
    const snapshot = {
      title: "Teardrop",
      artist: "Massive Attack, Elizabeth Fraser",
      album: "Mezzanine",
      artworkPath: "https://i.ytimg.com/vi/u7K72X4eo_s/hqdefault.jpg",
      thumbPath: "https://i.ytimg.com/vi/u7K72X4eo_s/default.jpg",
    };
    const plays = [
      play("streamed-play", { snapshot, videoId: "u7K72X4eo_s" }),
      play("library-play", {
        snapshot: { ...snapshot, album: null, artworkPath: null, thumbPath: null },
        videoId: null,
      }),
    ];
    await push(service, phoneA, { plays });

    const page = await pull(service, phoneB);
    assert.deepEqual(page.plays, plays);
    assert.deepEqual(readPullPage(JSON.stringify(page))?.plays, plays);
    const repeated = await push(service, phoneA, { plays });
    assert.equal((repeated.accepted as Record<string, number>).plays, 0);
    assert.deepEqual((await pull(service, phoneB)).plays, plays);
    assert.deepEqual((await pull(service, phoneB, page.cursor)).plays, []);
  });

  test("rows pushed by one phone come back to another phone of the account", async () => {
    const service = await harness();
    const phoneA = await service.signIn();
    const phoneB = await service.signIn();
    const pushed = await push(service, phoneA, {
      songs: [song("song-1", 10)],
      playlistEntries: [
        {
          id: "entry-1",
          changedAt: 10,
          phoneId: "phone-a",
          deleted: false,
          playlistId: "list-1",
          removedAt: null,
          orderKey: "a0",
          songId: "song-1",
          ytSong: null,
          addedAt: 10,
        },
      ],
      preferences: [
        {
          id: "theme",
          changedAt: 10,
          phoneId: "phone-a",
          deleted: false,
          value: "black",
        },
      ],
      plays: [play("play-1")],
    });
    assert.deepEqual(pushed, {
      accepted: {
        songs: 1,
        playlists: 0,
        playlistEntries: 1,
        favorites: 0,
        preferences: 1,
        plays: 1,
        follows: 0,
        hiddenReleases: 0,
        notifiedShows: 0,
        dismissedSuggestions: 0,
        dislikes: 0,
      },
      corrected: {},
    });

    const pulled = await pull(service, phoneB);
    assert.deepEqual(pulled.songs, [song("song-1", 10)]);
    assert.equal(pulled.playlistEntries[0]?.songId, "song-1");
    assert.equal(pulled.preferences[0]?.value, "black");
    assert.deepEqual(pulled.plays, [play("play-1", { snapshot: null, videoId: null })]);
    assert.equal(pulled.more, false);
  });

  test("a preference back at its default goes up as null and comes back as null", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, { preferences: [preference(10, "off")] });
    const pushed = await push(service, session, { preferences: [preference(20, null)] });
    assert.equal((pushed.accepted as Record<string, number>).preferences, 1);

    const pulled = await pull(service, session);
    assert.deepEqual(pulled.preferences, [preference(20, null)]);
  });

  test("the later change of a row wins, whichever phone pushes first", async () => {
    const service = await harness();
    const phoneA = await service.signIn();
    const phoneB = await service.signIn();
    // Phone B renamed the playlist later, but pushes first; A's older rename arrives after.
    await push(service, phoneB, { playlists: [playlist("list-1", 200, "phone-b", "Night Drive")] });
    const late = await push(service, phoneA, {
      playlists: [playlist("list-1", 100, "phone-a", "Late Night")],
    });
    assert.equal((late.accepted as Record<string, number>).playlists, 0);
    for (const session of [phoneA, phoneB]) {
      const pulled = await pull(service, session);
      assert.deepEqual(
        pulled.playlists.map((row) => [row.name, row.phoneId]),
        [["Night Drive", "phone-b"]],
      );
    }
  });

  test("changes made at the same time go to the greater phone id", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, { playlists: [playlist("list-1", 100, "phone-b", "From B")] });
    await push(service, session, { playlists: [playlist("list-1", 100, "phone-a", "From A")] });
    const pulled = await pull(service, session);
    assert.deepEqual(
      pulled.playlists.map((row) => row.name),
      ["From B"],
    );
  });

  test("a tombstone removes a row, an older edit can't bring it back and a later one does", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, { favorites: [favorite("song-1", 100)] });
    const { cursor } = await pull(service, session);

    await push(service, session, {
      favorites: [{ id: "song-1", changedAt: 200, phoneId: "phone-b", deleted: true }],
    });
    const removed = await pull(service, session, cursor);
    assert.deepEqual(removed.favorites, [
      { id: "song-1", changedAt: 200, phoneId: "phone-b", deleted: true },
    ]);

    const stale = await push(service, session, { favorites: [favorite("song-1", 150)] });
    assert.equal((stale.accepted as Record<string, number>).favorites, 0);
    assert.deepEqual((await pull(service, session, removed.cursor)).favorites, []);

    await push(service, session, { favorites: [favorite("song-1", 300)] });
    const back = await pull(service, session, removed.cursor);
    assert.deepEqual(back.favorites, [favorite("song-1", 300)]);
  });

  test("a play is added once, however often it's pushed", async () => {
    const service = await harness();
    const phoneA = await service.signIn();
    const phoneB = await service.signIn();
    await push(service, phoneA, { plays: [play("play-1"), play("play-2")] });
    const again = await push(service, phoneB, {
      plays: [play("play-2", { listenedMs: 1 }), play("play-3"), play("play-3")],
    });
    assert.equal((again.accepted as Record<string, number>).plays, 1);
    const pulled = await pull(service, phoneA);
    assert.deepEqual(
      pulled.plays.map((row) => [row.id, row.listenedMs]),
      [
        ["play-1", 200_000],
        ["play-2", 200_000],
        ["play-3", 200_000],
      ],
    );
  });

  test("pushing the same change again changes nothing, so a pull after it is empty", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, { songs: [song("song-1", 10)] });
    const { cursor } = await pull(service, session);
    await push(service, session, { songs: [song("song-1", 10)] });
    const after = await pull(service, session, cursor);
    assert.deepEqual(after.songs, []);
    assert.equal(after.cursor, cursor);
  });

  test("a pull gives only what changed after its cursor, in the order it changed", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, { favorites: [favorite("a", 1), favorite("b", 1)] });
    const first = await pull(service, session);
    await push(service, session, { favorites: [favorite("b", 2), favorite("c", 2)] });
    const second = await pull(service, session, first.cursor);
    assert.deepEqual(
      second.favorites.map((row) => row.id),
      ["b", "c"],
    );
  });

  test("a large change list comes in pages, each with the next cursor", async () => {
    const service = await harness({ pullPageSize: 3 });
    const session = await service.signIn();
    await push(service, session, {
      favorites: [favorite("f1", 1), favorite("f2", 1), favorite("f3", 1)],
      plays: [play("p1"), play("p2")],
      songs: [song("s1", 1), song("s2", 1)],
    });
    const first = await pull(service, session);
    assert.equal(first.more, true);
    const all = await pullAll(service, session);
    assert.equal(all.pages, 3);
    assert.deepEqual(
      [...all.favorites, ...all.plays, ...all.songs].map((row) => row.id).toSorted(),
      ["f1", "f2", "f3", "p1", "p2", "s1", "s2"],
    );
    const after = await pull(service, session, all.cursor);
    assert.equal(after.more, false);
    assert.deepEqual([...after.favorites, ...after.plays, ...after.songs], []);
  });

  test("a pull never misses a change pushed while phones push at once", async () => {
    const service = await harness({ pullPageSize: 7 });
    const sessions = await Promise.all([service.signIn(), service.signIn(), service.signIn()]);
    const seen = new Set<string>();
    let cursor: string | undefined;
    const pulls = async (): Promise<void> => {
      for (let round = 0; round < 10; round++) {
        const page = await pull(service, sessions[0] ?? "", cursor);
        for (const row of page.favorites) seen.add(row.id);
        cursor = page.cursor;
      }
    };
    await Promise.all([
      ...sessions.map((session, phone) =>
        Promise.all(
          Array.from({ length: 4 }, (_, batch) =>
            push(service, session, {
              favorites: Array.from({ length: 5 }, (_row, i) =>
                favorite(`p${phone}-b${batch}-${i}`, 1, { phoneId: `phone-${phone}` }),
              ),
            }),
          ),
        ),
      ),
      pulls(),
    ]);
    const rest = await pullAll(service, sessions[0] ?? "", cursor);
    for (const row of rest.favorites) seen.add(row.id);
    assert.equal(seen.size, 3 * 4 * 5);
  });

  test("an account never sees another account's rows", async () => {
    const service = await harness();
    const ana = await service.signIn();
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    await push(service, ana, { favorites: [favorite("song-1", 1)] });
    assert.deepEqual((await pull(service, bo)).favorites, []);
  });

  test("an account's push never changes or deletes another account's rows of the same id", async () => {
    const service = await harness();
    const ana = await service.signIn();
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    await push(service, ana, {
      songs: [song("song-1", 1)],
      favorites: [favorite("song-1", 1)],
      playlists: [playlist("list-1", 1, "phone-a", "Ana's")],
    });
    // Bo's phone sends rows with Ana's ids, later: a change and two deletions.
    await push(service, bo, {
      songs: [song("song-1", 2, { phoneId: "phone-b", title: "Bo's title" })],
      favorites: [favorite("song-1", 2, { phoneId: "phone-b", deleted: true })],
      playlists: [{ ...playlist("list-1", 2, "phone-b", "Ana's"), deleted: true }],
    });
    const anas = await pull(service, ana);
    assert.deepEqual(
      anas.songs.map((row) => [row.id, row.title, row.deleted]),
      [["song-1", "Teardrop", false]],
    );
    assert.deepEqual(
      anas.favorites.map((row) => [row.id, row.deleted]),
      [["song-1", false]],
    );
    assert.deepEqual(
      anas.playlists.map((row) => [row.id, row.name, row.deleted]),
      [["list-1", "Ana's", false]],
    );
    const bos = await pull(service, bo);
    assert.deepEqual(
      bos.songs.map((row) => [row.id, row.title]),
      [["song-1", "Bo's title"]],
    );
    assert.deepEqual(
      bos.favorites.map((row) => [row.id, row.deleted]),
      [["song-1", true]],
    );
  });

  test("a row that isn't valid is refused, saying where, and nothing of the push is kept", async () => {
    const service = await harness();
    const session = await service.signIn();
    const bad = [
      { songs: [song("ok", 1), song("bad", 1, { durationMs: "long" })] },
      { songs: [song("bad", 1, { title: undefined })] },
      { favorites: [favorite("x", 1, { phoneId: "" })] },
      { favorites: [favorite("x", 1, { deleted: "yes" })] },
      { plays: [play("x", { endReason: "exploded" })] },
      {
        playlistEntries: [
          {
            id: "e",
            changedAt: 1,
            phoneId: "p",
            deleted: false,
            playlistId: "l",
            orderKey: "a0",
            songId: "s",
            ytSong: "{}",
            addedAt: 1,
          },
        ],
      },
      { comments: [] },
      { songs: {} },
      [],
    ];
    for (const body of bad) {
      const response = await service.request("POST", "/v1/push", { session, json: body });
      assert.equal(response.status, 400, JSON.stringify(body));
      const answer = (await response.json()) as { error: string; detail?: string };
      assert.equal(answer.error, "bad_request");
    }
    const durationAnswer = await service.request("POST", "/v1/push", { session, json: bad[0] });
    assert.deepEqual(await durationAnswer.json(), {
      error: "bad_request",
      detail: "songs[1].durationMs isn't an integer",
    });
    const notJson = await service.request("POST", "/v1/push", { session, body: "{" });
    assert.equal(notJson.status, 400);
    assert.deepEqual((await pull(service, session)).songs, []);
  });

  test("a row is held to Core's wire: a preference whose value isn't text is refused", async () => {
    const service = await harness();
    const session = await service.signIn();
    const response = await service.request("POST", "/v1/push", {
      session,
      json: { preferences: [preference(10, { dark: "black" })] },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "bad_request",
      detail: "preferences[0].value isn't text",
    });
  });

  test("a follow syncs with its level, the later change wins, and an unfollow is a tombstone", async () => {
    const service = await harness();
    const phoneA = await service.signIn();
    const phoneB = await service.signIn();
    const follow = (changedAt: number, level: string, phoneId = "phone-a") => ({
      id: "massive attack",
      changedAt,
      phoneId,
      deleted: false,
      name: "Massive Attack",
      level,
      followedAt: 100,
      deezerId: 2_163,
      ytBrowseId: null,
    });
    await push(service, phoneA, { follows: [follow(100, "releases")] });
    assert.deepEqual((await pull(service, phoneB)).follows, [follow(100, "releases")]);

    await push(service, phoneB, { follows: [follow(200, "shows", "phone-b")] });
    const stale = await push(service, phoneA, { follows: [follow(150, "releases")] });
    assert.equal((stale.accepted as Record<string, number>).follows, 0);
    assert.deepEqual((await pull(service, phoneA)).follows, [follow(200, "shows", "phone-b")]);

    const unfollow = { id: "massive attack", changedAt: 300, phoneId: "phone-a", deleted: true };
    await push(service, phoneA, { follows: [unfollow] });
    assert.deepEqual((await pull(service, phoneB)).follows, [unfollow]);
  });

  test("a follow at a level the wire doesn't know is refused", async () => {
    const service = await harness();
    const session = await service.signIn();
    const response = await service.request("POST", "/v1/push", {
      session,
      json: {
        follows: [
          {
            id: "tricky",
            changedAt: 1,
            phoneId: "phone-a",
            deleted: false,
            name: "Tricky",
            level: "everything",
            followedAt: 1,
            deezerId: null,
            ytBrowseId: null,
          },
        ],
      },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "bad_request",
      detail: "follows[0].level isn't one of its values",
    });
  });

  test("hidden releases and notified shows reach the other phone", async () => {
    const service = await harness();
    const phoneA = await service.signIn();
    const phoneB = await service.signIn();
    const marked = (id: string) => ({ id, changedAt: 10, phoneId: "phone-a", deleted: false });
    await push(service, phoneA, {
      hiddenReleases: [marked("deezer:302127")],
      notifiedShows: [marked("G5vYZ9Ma1Jb5U")],
    });
    const pulled = await pull(service, phoneB);
    assert.deepEqual(pulled.hiddenReleases, [marked("deezer:302127")]);
    assert.deepEqual(pulled.notifiedShows, [marked("G5vYZ9Ma1Jb5U")]);
  });

  test("a dismissed follow suggestion reaches the other phone, and so does its Undo", async () => {
    const service = await harness();
    const phoneA = await service.signIn();
    const phoneB = await service.signIn();
    const dismissal = {
      id: "massive attack",
      changedAt: 10,
      phoneId: "phone-a",
      deleted: false,
      dismissedAt: 10,
    };
    await push(service, phoneA, { dismissedSuggestions: [dismissal] });
    const first = await pull(service, phoneB);
    assert.deepEqual(first.dismissedSuggestions, [dismissal]);

    const undo = { id: "massive attack", changedAt: 11, phoneId: "phone-a", deleted: true };
    await push(service, phoneA, { dismissedSuggestions: [undo] });
    const second = await pull(service, phoneB, first.cursor);
    assert.deepEqual(second.dismissedSuggestions, [undo]);
  });

  test("a dislike reaches the other phone with the song as it was listed, and so does its removal", async () => {
    const service = await harness();
    const phoneA = await service.signIn();
    const phoneB = await service.signIn();
    const dislike = {
      id: "yt:4D7u5KF7SP8",
      changedAt: 10,
      phoneId: "phone-a",
      deleted: false,
      title: "Teardrop",
      artists: '["Massive Attack"]',
      durationMs: null,
      dislikedAt: 10,
    };
    await push(service, phoneA, { dislikes: [dislike] });
    const first = await pull(service, phoneB);
    assert.deepEqual(first.dislikes, [dislike]);

    // An older change arriving late doesn't bring it back.
    const removal = { id: "yt:4D7u5KF7SP8", changedAt: 12, phoneId: "phone-b", deleted: true };
    await push(service, phoneB, { dislikes: [removal] });
    await push(service, phoneA, { dislikes: [{ ...dislike, changedAt: 11, dislikedAt: 11 }] });
    const second = await pull(service, phoneA, first.cursor);
    assert.deepEqual(second.dislikes, [removal]);
  });

  test("a dislike without the song's title is refused", async () => {
    const service = await harness();
    const session = await service.signIn();
    const response = await service.request("POST", "/v1/push", {
      session,
      json: {
        dislikes: [
          {
            id: "yt:4D7u5KF7SP8",
            changedAt: 1,
            phoneId: "phone-a",
            deleted: false,
            artists: "[]",
            durationMs: null,
            dislikedAt: 1,
          },
        ],
      },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "bad_request",
      detail: "dislikes[0].title is missing",
    });
  });

  test("a dismissal without when it was dismissed is refused", async () => {
    const service = await harness();
    const session = await service.signIn();
    const response = await service.request("POST", "/v1/push", {
      session,
      json: {
        dismissedSuggestions: [{ id: "tricky", changedAt: 1, phoneId: "phone-a", deleted: false }],
      },
    });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: "bad_request",
      detail: "dismissedSuggestions[0].dismissedAt is missing",
    });
  });

  test("a pull reads with Core's readPullPage as every table's rows were pushed", async () => {
    const service = await harness();
    const session = await service.signIn();
    const rows = {
      songs: [song("song-1", 10)],
      playlists: [playlist("list-1", 10, "phone-a", "Mix")],
      playlistEntries: [
        {
          id: "entry-1",
          changedAt: 10,
          phoneId: "phone-a",
          deleted: false,
          playlistId: "list-1",
          removedAt: null,
          orderKey: "a0",
          songId: null,
          ytSong: '{"videoId":"u7K72X4eo_s"}',
          addedAt: 10,
          restoredAt: null,
        },
      ],
      favorites: [
        favorite("song-1", 10),
        { id: "song-2", changedAt: 11, phoneId: "phone-a", deleted: true },
      ],
      preferences: [preference(10, "on")],
      plays: [
        play("play-1", {
          durationMs: null,
          importedFrom: "blackplayer",
          snapshot: null,
          videoId: null,
        }),
      ],
      follows: [
        {
          id: "massive attack",
          changedAt: 10,
          phoneId: "phone-a",
          deleted: false,
          name: "Massive Attack",
          level: "releases",
          followedAt: 10,
          deezerId: 2_163,
          ytBrowseId: "UCQ2f9WmyRrpUQ8xv3IxhPOQ",
        },
        { id: "portishead", changedAt: 11, phoneId: "phone-a", deleted: true },
      ],
      hiddenReleases: [{ id: "deezer:302127", changedAt: 10, phoneId: "phone-a", deleted: false }],
      notifiedShows: [{ id: "G5vYZ9Ma1Jb5U", changedAt: 10, phoneId: "phone-a", deleted: false }],
      dismissedSuggestions: [
        { id: "bjork", changedAt: 11, phoneId: "phone-a", deleted: true },
        { id: "tricky", changedAt: 10, phoneId: "phone-a", deleted: false, dismissedAt: 10 },
      ],
      dislikes: [
        {
          id: "yt:4D7u5KF7SP8",
          changedAt: 10,
          phoneId: "phone-a",
          deleted: false,
          title: "Teardrop",
          artists: '["Massive Attack"]',
          durationMs: 330_000,
          dislikedAt: 10,
        },
      ],
    };
    await push(service, session, rows);
    const response = await service.request("GET", "/v1/pull", { session });
    const page = readPullPage(await response.text());
    assert.deepEqual({ ...page, cursor: undefined }, { ...rows, cursor: undefined, more: false });
  });

  test("a cursor that isn't one is refused", async () => {
    const service = await harness();
    const session = await service.signIn();
    for (const since of ["-1", "abc", "1.5"]) {
      const response = await service.request("GET", `/v1/pull?since=${since}`, { session });
      assert.equal(response.status, 400, since);
    }
  });
});

test("a release date survives stale writes and clients omitting it, and a sent null clears it", async () => {
  const service = await harness();
  const session = await service.signIn();
  await push(service, session, { songs: [song("dated", 20, { releaseDate: "1985-06-21" })] });
  await push(service, session, { songs: [song("dated", 10, { releaseDate: "2005" })] });
  // A Wave from before release dates sends none at all.
  const { releaseDate: _date, ...legacy } = song("dated", 30);
  await push(service, session, { songs: [legacy] });
  assert.equal((await pullAll(service, session)).songs[0]?.releaseDate, "1985-06-21");
  // The owner cleared the date they typed: the phone sends null, and every phone loses it.
  await push(service, session, { songs: [song("dated", 40, { releaseDate: null })] });
  assert.equal((await pullAll(service, session)).songs[0]?.releaseDate, null);
});

test("Graveyard tombstones keep their song and manual removal date through push and pull", async () => {
  const service = await harness();
  const session = await service.signIn();
  const entry = {
    id: "removed-entry",
    changedAt: 300,
    phoneId: "phone-a",
    deleted: true,
    playlistId: "drive",
    orderKey: "a0",
    songId: null,
    ytSong: JSON.stringify({ videoId: "x" }),
    addedAt: 100,
    removedAt: 300,
    restoredAt: null,
  };
  await push(service, session, { playlistEntries: [entry] });
  const page = await pullAll(service, session);
  assert.deepEqual(readPullPage(JSON.stringify(page))?.playlistEntries, [entry]);
});

describe("a removed playlist entry stays removed", () => {
  const entry = (
    changedAt: number,
    phoneId: string,
    overrides: Readonly<Record<string, unknown>> = {},
  ) => ({
    id: "entry-1",
    changedAt,
    phoneId,
    deleted: false,
    playlistId: "drive",
    orderKey: "a0",
    songId: "song-1",
    ytSong: null,
    addedAt: 100,
    removedAt: null,
    restoredAt: null,
    ...overrides,
  });
  const removed = (changedAt: number, phoneId: string) =>
    entry(changedAt, phoneId, { deleted: true, removedAt: changedAt });
  const held = async (service: Parameters<typeof pullAll>[0], session: string) =>
    (await pullAll(service, session)).playlistEntries;
  const acceptedEntries = (answer: Readonly<Record<string, unknown>>) =>
    (answer.accepted as Record<string, number>).playlistEntries;

  test("a move stamped after a removal is not stored, whichever arrives first", async () => {
    const move = entry(400, "phone-b", { orderKey: "b0" });
    for (const order of [
      [removed(300, "phone-a"), move],
      [move, removed(300, "phone-a")],
    ]) {
      const service = await harness();
      const session = await service.signIn();
      await push(service, session, { playlistEntries: [entry(100, "phone-a")] });
      for (const change of order) await push(service, session, { playlistEntries: [change] });
      assert.deepEqual(await held(service, session), [removed(300, "phone-a")]);
    }
  });

  test("a restore brings the entry back, an edit keeps it back and a later removal removes it again", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, { playlistEntries: [removed(300, "phone-a")] });

    const restored = entry(400, "phone-b", { restoredAt: 400 });
    assert.equal(acceptedEntries(await push(service, session, { playlistEntries: [restored] })), 1);
    assert.deepEqual(await held(service, session), [restored]);

    const moved = entry(500, "phone-a", { orderKey: "c0", restoredAt: 400 });
    await push(service, session, { playlistEntries: [moved] });
    assert.deepEqual(await held(service, session), [moved]);

    await push(service, session, { playlistEntries: [removed(600, "phone-b")] });
    const staleMove = entry(700, "phone-a", { orderKey: "d0", restoredAt: 400 });
    assert.equal(
      acceptedEntries(await push(service, session, { playlistEntries: [staleMove] })),
      0,
    );
    assert.deepEqual(await held(service, session), [removed(600, "phone-b")]);
  });

  test("a restore made before the removal held doesn't undo it", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, { playlistEntries: [removed(600, "phone-a")] });
    await push(service, session, {
      playlistEntries: [entry(900, "phone-b", { restoredAt: 400 })],
    });
    assert.deepEqual(await held(service, session), [removed(600, "phone-a")]);
  });

  test("a Wave from before restores keeps pushing: its edit of a restored entry is stored, its edit of a removed one is not", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, { playlistEntries: [removed(300, "phone-a")] });
    await push(service, session, {
      playlistEntries: [entry(400, "phone-a", { restoredAt: 400 })],
    });

    const { restoredAt: _restored, ...legacyMove } = entry(500, "phone-old", { orderKey: "b0" });
    assert.equal(
      acceptedEntries(await push(service, session, { playlistEntries: [legacyMove] })),
      1,
    );
    assert.deepEqual(await held(service, session), [
      entry(500, "phone-old", { orderKey: "b0", restoredAt: 400 }),
    ]);

    await push(service, session, { playlistEntries: [removed(600, "phone-a")] });
    const { restoredAt: _again, ...legacyLate } = entry(700, "phone-old", { orderKey: "c0" });
    assert.equal(
      acceptedEntries(await push(service, session, { playlistEntries: [legacyLate] })),
      0,
    );
    assert.deepEqual(await held(service, session), [removed(600, "phone-a")]);
  });

  test("a restore from a clock running ahead brings the entry back, and a later removal still removes it", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, { playlistEntries: [removed(service.now - 10, "phone-a")] });
    const at = service.now + 86_400_000;
    await push(service, session, { playlistEntries: [entry(at, "phone-b", { restoredAt: at })] });
    assert.equal((await held(service, session))[0]?.deleted, false);

    service.now += 60_000;
    await push(service, session, { playlistEntries: [removed(service.now, "phone-a")] });
    assert.deepEqual(await held(service, session), [removed(service.now, "phone-a")]);
  });

  test("other tables still take an edit made after a removal", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, {
      playlists: [{ id: "drive", changedAt: 300, phoneId: "phone-a", deleted: true }],
    });
    await push(service, session, { playlists: [playlist("drive", 400, "phone-b", "Drive")] });
    assert.deepEqual((await pullAll(service, session)).playlists, [
      playlist("drive", 400, "phone-b", "Drive"),
    ]);
  });

  test("upgrading an existing database only adds the restore time and keeps its entries", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, { playlistEntries: [entry(100, "phone-a")] });
    // Recreate the deployed schema with an existing entry, before migration 0014.
    await service.db.batch(
      [
        "ALTER TABLE playlist_entries DROP COLUMN restored_at",
        "DELETE FROM migrations WHERE id = '0015_playlist_entry_restores'",
      ],
      "write",
    );
    assert.deepEqual(await migrate(service.db), ["0015_playlist_entry_restores"]);
    assert.deepEqual(await held(service, session), [entry(100, "phone-a")]);
  });
});

describe("a change time ahead of the service's clock", () => {
  test("is stored as the service's time, and a later change by another device wins over it", async () => {
    const service = await harness();
    const ahead = await service.signIn();
    const other = await service.signIn();
    const storedAt = service.now;

    const answer = await push(service, ahead, {
      playlists: [playlist("drive", storedAt + 86_400_000, "phone-z", "Drive")],
    });
    assert.deepEqual(answer.accepted && (answer.accepted as Record<string, number>).playlists, 1);
    assert.deepEqual(answer.corrected, { playlists: [{ id: "drive", changedAt: storedAt }] });
    assert.equal((await pull(service, other)).playlists[0]?.changedAt, storedAt);

    service.now += 60_000;
    const renamed = playlist("drive", service.now, "phone-a", "Road");
    await push(service, other, { playlists: [renamed] });
    assert.deepEqual((await pullAll(service, ahead)).playlists, [renamed]);
  });

  test("is corrected in every table that carries one", async () => {
    const service = await harness();
    const session = await service.signIn();
    const at = service.now + 5_000;
    const stamp = { changedAt: at, phoneId: "phone-a", deleted: false };

    const answer = await push(service, session, {
      songs: [song("song-1", at)],
      playlists: [playlist("drive", at, "phone-a", "Drive")],
      playlistEntries: [
        { id: "e1", ...stamp, playlistId: "drive", orderKey: "a0", songId: "song-1", addedAt: 1 },
      ],
      favorites: [favorite("song-1", at)],
      preferences: [preference(at, "on")],
      plays: [play("phone-a:1")],
      follows: [{ id: "tricky", changedAt: at, phoneId: "phone-a", deleted: true }],
      hiddenReleases: [{ id: "deezer:1", ...stamp }],
      notifiedShows: [{ id: "show-1", ...stamp }],
      dismissedSuggestions: [{ id: "bjork", ...stamp, dismissedAt: 10 }],
    });
    const now = service.now;
    assert.deepEqual(answer.corrected, {
      songs: [{ id: "song-1", changedAt: now }],
      playlists: [{ id: "drive", changedAt: now }],
      playlistEntries: [{ id: "e1", changedAt: now }],
      favorites: [{ id: "song-1", changedAt: now }],
      preferences: [{ id: "settings.ytMusic", changedAt: now }],
      follows: [{ id: "tricky", changedAt: now }],
      hiddenReleases: [{ id: "deezer:1", changedAt: now }],
      notifiedShows: [{ id: "show-1", changedAt: now }],
      dismissedSuggestions: [{ id: "bjork", changedAt: now }],
    });
    const page = await pullAll(service, session);
    for (const table of Object.keys(answer.corrected as object) as (keyof typeof page)[]) {
      assert.deepEqual(
        (page[table] as readonly { changedAt?: unknown }[]).map((row) => row.changedAt),
        [now],
        table,
      );
    }
  });

  test("a row whose time is not ahead is stored unchanged, and the answer names none", async () => {
    const service = await harness();
    const session = await service.signIn();
    const rows = [
      playlist("past", service.now - 1, "phone-a", "Past"),
      playlist("present", service.now, "phone-a", "Present"),
    ];
    const answer = await push(service, session, { playlists: rows });
    assert.deepEqual(answer.corrected, {});
    assert.deepEqual((await pullAll(service, session)).playlists, rows);
  });

  test("a corrected row that loses to the row held isn't named", async () => {
    const service = await harness();
    const session = await service.signIn();
    await push(service, session, {
      playlists: [playlist("drive", service.now, "phone-z", "Held")],
    });
    const answer = await push(service, session, {
      playlists: [playlist("drive", service.now + 9_000, "phone-a", "Ahead")],
    });
    assert.deepEqual(answer.corrected, {});
    assert.equal((await pullAll(service, session)).playlists[0]?.name, "Held");
  });
});
