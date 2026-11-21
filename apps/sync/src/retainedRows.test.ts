import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SYNC_LIMITS } from "./limits.ts";
import { type Harness, favorite, harness, pull, pullAll, push } from "./testing.ts";

/** A favorite's deletion record. */
const tombstone = (id: string, changedAt = 2) => ({
  id,
  changedAt,
  phoneId: "phone-a",
  deleted: true,
});

/** Pushes [body] and asserts it's refused for [limit]. */
const refusedPush = async (
  service: Harness,
  session: string,
  body: unknown,
  limit: string,
): Promise<void> => {
  const response = await service.request("POST", "/v1/push", { session, json: body });
  assert.equal(response.status, 413);
  assert.deepEqual(await response.json(), { error: "limit", limit });
};

/** A play event. */
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
  importedFrom: null,
});

/** A Graveyard entry: a playlist entry removed by hand, kept with its song. */
const graveyardEntry = (id: string, changedAt: number) => ({
  id,
  changedAt,
  phoneId: "phone-a",
  deleted: true,
  playlistId: "drive",
  orderKey: "a0",
  songId: null,
  ytSong: JSON.stringify({ videoId: id }),
  addedAt: 100,
  removedAt: changedAt,
  restoredAt: null,
});

describe("retained sync rows", () => {
  test("each account holds the specified rows per category", () => {
    assert.deepEqual(
      {
        maxSongs: SYNC_LIMITS.maxSongs,
        maxPlaylists: SYNC_LIMITS.maxPlaylists,
        maxPlaylistEntries: SYNC_LIMITS.maxPlaylistEntries,
        maxFavorites: SYNC_LIMITS.maxFavorites,
        maxPreferences: SYNC_LIMITS.maxPreferences,
        maxPlays: SYNC_LIMITS.maxPlays,
        maxFollows: SYNC_LIMITS.maxFollows,
        maxHiddenReleases: SYNC_LIMITS.maxHiddenReleases,
        maxNotifiedShows: SYNC_LIMITS.maxNotifiedShows,
        maxDismissedSuggestions: SYNC_LIMITS.maxDismissedSuggestions,
        maxDislikes: SYNC_LIMITS.maxDislikes,
      },
      {
        maxSongs: 100_000,
        maxPlaylists: 5_000,
        maxPlaylistEntries: 250_000,
        maxFavorites: 100_000,
        maxPreferences: 200,
        maxPlays: 1_000_000,
        maxFollows: 5_000,
        maxHiddenReleases: 50_000,
        maxNotifiedShows: 50_000,
        maxDismissedSuggestions: 50_000,
        maxDislikes: 50_000,
      },
    );
  });

  test("every category takes deletion records up to its limit and refuses the next new ID", async () => {
    const service = await harness({
      limits: {
        maxSongs: 2,
        maxPlaylists: 2,
        maxPlaylistEntries: 2,
        maxFavorites: 2,
        maxPreferences: 2,
        maxPlays: 2,
        maxFollows: 2,
        maxHiddenReleases: 2,
        maxNotifiedShows: 2,
        maxDismissedSuggestions: 2,
        maxDislikes: 2,
      },
    });
    const session = await service.signIn();
    for (const [table, limit] of [
      ["songs", "maxSongs"],
      ["playlists", "maxPlaylists"],
      ["playlistEntries", "maxPlaylistEntries"],
      ["favorites", "maxFavorites"],
      ["preferences", "maxPreferences"],
      ["follows", "maxFollows"],
      ["hiddenReleases", "maxHiddenReleases"],
      ["notifiedShows", "maxNotifiedShows"],
      ["dismissedSuggestions", "maxDismissedSuggestions"],
      ["dislikes", "maxDislikes"],
    ] as const) {
      await push(service, session, { [table]: [tombstone(`${table}-1`), tombstone(`${table}-2`)] });
      await refusedPush(service, session, { [table]: [tombstone(`${table}-3`)] }, limit);
    }
    await push(service, session, { plays: [play("p1"), play("p2")] });
    await refusedPush(service, session, { plays: [play("p3")] }, "maxPlays");
  });

  test("at the limit, replays, duplicates, losing changes, deletions and restorations still go through", async () => {
    const service = await harness({ limits: { maxFavorites: 2 } });
    const session = await service.signIn();
    const batch = { favorites: [favorite("a", 10), tombstone("b", 10)] };
    await push(service, session, batch);

    const replayed = await push(service, session, batch);
    assert.equal((replayed.accepted as Record<string, number>).favorites, 0);
    // Changes made offline before the held ones lose, and take no room.
    await push(service, session, { favorites: [favorite("b", 5), tombstone("a", 5)] });
    await push(service, session, { favorites: [favorite("a", 11), favorite("a", 12)] });
    await push(service, session, { favorites: [favorite("b", 13), tombstone("a", 13)] });

    const pulled = await pull(service, session);
    assert.deepEqual(
      pulled.favorites.map((row) => [row.id, row.deleted, row.changedAt]).toSorted(),
      [
        ["a", true, 13],
        ["b", false, 13],
      ],
    );
  });

  test("a batch refused in one category writes nothing in any and leaves the cursor where it was", async () => {
    const service = await harness({ limits: { maxPlaylists: 1 } });
    const session = await service.signIn();
    await push(service, session, { playlists: [tombstone("p1")] });
    const before = await pull(service, session);

    await refusedPush(
      service,
      session,
      {
        favorites: [favorite("a", 3), tombstone("b", 3)],
        plays: [play("x")],
        playlists: [tombstone("p2", 3)],
      },
      "maxPlaylists",
    );
    assert.deepEqual(await pull(service, session), before);

    await push(service, session, { favorites: [favorite("c", 4)] });
    const next = await pull(service, session, before.cursor);
    assert.deepEqual(
      next.favorites.map((row) => row.id),
      ["c"],
    );
    assert.deepEqual(next.plays, []);
  });

  test("pushes racing for the last place: exactly one takes it", async () => {
    const service = await harness({ limits: { maxFavorites: 2 } });
    const session = await service.signIn();
    await push(service, session, { favorites: [tombstone("a")] });

    const answers = await Promise.all(
      ["b", "c", "d"].map((id) =>
        service.request("POST", "/v1/push", { session, json: { favorites: [favorite(id, 3)] } }),
      ),
    );
    assert.deepEqual(answers.map((answer) => answer.status).toSorted(), [200, 413, 413]);
    assert.equal((await pull(service, session)).favorites.length, 2);
  });

  test("rows of one account take no room from another", async () => {
    const service = await harness({ limits: { maxFavorites: 1 } });
    const ana = await service.signIn();
    const bruno = await service.signIn({ sub: "google-sub-2", email: "bruno@example.com" });
    await push(service, ana, { favorites: [tombstone("a")] });
    await push(service, bruno, { favorites: [favorite("a", 3)] });
    await refusedPush(service, bruno, { favorites: [tombstone("b")] }, "maxFavorites");

    assert.deepEqual(
      (await pull(service, ana)).favorites.map((row) => [row.id, row.deleted]),
      [["a", true]],
    );
    assert.deepEqual(
      (await pull(service, bruno)).favorites.map((row) => [row.id, row.deleted]),
      [["a", false]],
    );
  });

  test("deletion records at the limit stay, Graveyard fields and all, and page through a pull", async () => {
    const service = await harness({ limits: { maxPlaylistEntries: 3 }, pullPageSize: 1 });
    const session = await service.signIn();
    await push(service, session, {
      playlistEntries: [graveyardEntry("e1", 10), graveyardEntry("e2", 11), tombstone("e3", 12)],
    });
    await refusedPush(
      service,
      session,
      { playlistEntries: [graveyardEntry("e4", 13)] },
      "maxPlaylistEntries",
    );
    // A year on, from a phone signing in again: nothing expired them.
    service.now += 400 * 24 * 60 * 60 * 1000;
    const pulled = await pullAll(service, await service.signIn());
    assert.equal(pulled.pages, 3);
    assert.deepEqual(pulled.playlistEntries, [
      graveyardEntry("e1", 10),
      graveyardEntry("e2", 11),
      tombstone("e3", 12),
    ]);
  });
  test("a deletion record for a new ID counts against the category's limit", async () => {
    const service = await harness({ limits: { maxFavorites: 2 } });
    const session = await service.signIn();
    await push(service, session, { favorites: [favorite("a", 1), tombstone("b")] });
    const before = await pull(service, session);

    await refusedPush(service, session, { favorites: [tombstone("c")] }, "maxFavorites");
    assert.deepEqual(await pull(service, session), before);
  });

  test("a category already past its limit keeps its rows, takes non-growing changes and refuses new IDs", async () => {
    const legacy = await harness({ limits: { maxFavorites: 3 } });
    const session = await legacy.signIn();
    await push(legacy, session, {
      favorites: [favorite("a", 1), tombstone("b"), favorite("c", 1)],
    });
    const service = await harness({ limits: { maxFavorites: 2 } }, legacy.db);

    await push(service, session, {
      favorites: [favorite("a", 3), favorite("b", 3), tombstone("c", 3)],
    });
    const after = await pull(service, session);
    assert.deepEqual(
      after.favorites.map((row) => [row.id, row.deleted, row.changedAt]),
      [
        ["a", false, 3],
        ["b", false, 3],
        ["c", true, 3],
      ],
    );

    await refusedPush(service, session, { favorites: [favorite("d", 4)] }, "maxFavorites");
    await refusedPush(service, session, { favorites: [tombstone("d", 4)] }, "maxFavorites");
    assert.deepEqual(await pull(service, session), after);
  });
});
