import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { favorite, harness, pull, push } from "./testing.ts";

const play = (id: string) => ({
  id,
  songId: "song-1",
  startedAt: 1,
  listenedMs: 20_000,
  durationMs: null,
  endReason: "skipped",
  counted: true,
  contextType: null,
  contextId: null,
  source: "auto",
  importedFrom: "blackplayer",
});

describe("limits", () => {
  test("a body past maxBodyBytes is refused with 413, naming the limit", async () => {
    const service = await harness({ limits: { maxBodyBytes: 1_000 } });
    const session = await service.signIn();
    const favorites = Array.from({ length: 50 }, (_, i) => favorite(`song-${i}`, 1));
    const response = await service.request("POST", "/v1/push", { session, json: { favorites } });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "limit", limit: "maxBodyBytes" });
    assert.deepEqual((await pull(service, session)).favorites, []);
  });

  test("an ID token past maxBodyBytes is refused too", async () => {
    const service = await harness({ limits: { maxBodyBytes: 100 } });
    const response = await service.request("POST", "/v1/session", {
      json: { idToken: await service.google.idToken() },
    });
    assert.equal(response.status, 413);
  });

  test("a push that would hold more rows than a table's limit is refused whole", async () => {
    const service = await harness({ limits: { maxFavorites: 3, maxPlays: 2 } });
    const session = await service.signIn();
    await push(service, session, { favorites: [favorite("a", 1), favorite("b", 1)] });
    const response = await service.request("POST", "/v1/push", {
      session,
      json: { favorites: [favorite("c", 1), favorite("d", 1)], plays: [play("p1")] },
    });
    assert.equal(response.status, 413);
    assert.deepEqual(await response.json(), { error: "limit", limit: "maxFavorites" });
    const pulled = await pull(service, session);
    assert.deepEqual(
      pulled.favorites.map((row) => row.id),
      ["a", "b"],
    );
    assert.deepEqual(pulled.plays, []);

    const plays = await service.request("POST", "/v1/push", {
      session,
      json: { plays: [play("p1"), play("p2"), play("p3")] },
    });
    assert.deepEqual(await plays.json(), { error: "limit", limit: "maxPlays" });
  });

  test("tombstones don't count against a table's limit", async () => {
    const service = await harness({ limits: { maxFavorites: 2 } });
    const session = await service.signIn();
    await push(service, session, { favorites: [favorite("a", 1), favorite("b", 1)] });
    await push(service, session, {
      favorites: [{ id: "a", changedAt: 2, phoneId: "phone-a", deleted: true }],
    });
    await push(service, session, { favorites: [favorite("c", 3)] });
    const pulled = await pull(service, session);
    assert.deepEqual(pulled.favorites.map((row) => [row.id, row.deleted]).toSorted(), [
      ["a", true],
      ["b", false],
      ["c", false],
    ]);
  });

  test("a session past maxRequestsPerMinute gets 429 until the next minute", async () => {
    const service = await harness({ limits: { maxRequestsPerMinute: 3 } });
    const session = await service.signIn();
    service.now = Date.UTC(2026, 9, 14, 13, 0, 10);
    for (let i = 0; i < 3; i++) await pull(service, session);
    const refused = await service.request("GET", "/v1/pull", { session });
    assert.equal(refused.status, 429);
    assert.deepEqual(await refused.json(), { error: "limit", limit: "maxRequestsPerMinute" });
    assert.equal(refused.headers.get("retry-after"), "50");

    const other = await service.signIn();
    assert.equal((await service.request("GET", "/v1/pull", { session: other })).status, 200);

    service.now = Date.UTC(2026, 9, 14, 13, 1, 0);
    assert.equal((await service.request("GET", "/v1/pull", { session })).status, 200);
  });
});

describe("DELETE /v1/account", () => {
  test("deletes every row and session of the account, and leaves other accounts alone", async () => {
    const service = await harness();
    const ana = await service.signIn();
    const anaOtherPhone = await service.signIn();
    const bo = await service.signIn({ sub: "google-sub-2", email: "bo@example.com" });
    const everything = {
      songs: [
        {
          id: "song-1",
          changedAt: 1,
          phoneId: "phone-a",
          deleted: false,
          title: "Teardrop",
          credit: "Massive Attack",
          album: null,
          albumArtist: "Massive Attack",
          discNumber: null,
          trackNumber: null,
          durationMs: 330_000,
          year: null,
          genre: null,
          videoId: "u7K72X4eo_s",
          addedAt: 1,
        },
      ],
      playlists: [
        {
          id: "list-1",
          changedAt: 1,
          phoneId: "phone-a",
          deleted: false,
          name: "Mix",
          createdAt: 1,
        },
      ],
      playlistEntries: [
        {
          id: "entry-1",
          changedAt: 1,
          phoneId: "phone-a",
          deleted: false,
          playlistId: "list-1",
          orderKey: "a0",
          songId: null,
          ytSong: '{"videoId":"u7K72X4eo_s"}',
          addedAt: 1,
        },
      ],
      favorites: [favorite("song-1", 1)],
      preferences: [{ id: "glass", changedAt: 1, phoneId: "phone-a", deleted: false, value: true }],
      plays: [play("play-1")],
    };
    await push(service, ana, everything);
    await push(service, bo, everything);
    for (const session of [ana, bo]) {
      const soulseek = { username: "quietfern42", password: "fixture-soulseek-password" };
      await service.request("PUT", "/v1/soulseek", { session, json: soulseek });
    }

    const deleted = await service.request("DELETE", "/v1/account", { session: ana });
    assert.equal(deleted.status, 204);

    for (const session of [ana, anaOtherPhone]) {
      assert.equal((await service.request("GET", "/v1/pull", { session })).status, 401);
    }
    const left = await service.db.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('migrations', 'sqlite_sequence')",
    );
    // Whose each table's rows are: a sign-in window's key is `sub:` and the Google subject.
    const owners: Readonly<Record<string, string>> = {
      accounts: "google_sub",
      sign_in_windows: "substr(key, length('sub:') + 1)",
    };
    for (const { name } of left.rows) {
      const owner = owners[String(name)] ?? "account_id";
      const rows = await service.db.execute(`SELECT ${owner} AS owner FROM ${String(name)}`);
      assert.ok(rows.rows.length > 0, `${String(name)} kept Bo's rows`);
      for (const row of rows.rows) {
        assert.ok(row.owner !== "google-sub-1", `${String(name)} kept Ana's account`);
      }
    }

    const fresh = await service.signIn();
    const pulled = await pull(service, fresh);
    assert.deepEqual(
      [
        pulled.songs,
        pulled.playlists,
        pulled.playlistEntries,
        pulled.favorites,
        pulled.preferences,
        pulled.plays,
      ],
      [[], [], [], [], [], []],
    );
    const bosPull = await pull(service, bo);
    assert.equal(bosPull.plays.length, 1);
  });
});

describe("routes", () => {
  test("an unknown route answers 404", async () => {
    const service = await harness();
    for (const [method, path] of [
      ["GET", "/"],
      ["GET", "/v1/session"],
      ["PUT", "/v1/push"],
    ] as const) {
      const response = await service.request(method, path);
      assert.equal(response.status, 404, `${method} ${path}`);
    }
  });
});
