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
      },
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
          orderKey: "a0",
          songId: null,
          ytSong: '{"videoId":"u7K72X4eo_s"}',
          addedAt: 10,
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
