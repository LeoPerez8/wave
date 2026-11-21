import assert from "node:assert/strict";
import { test } from "node:test";
import { selectFollow, selectFollows } from "@wave/client/db/follows";
import { addTrack, openTestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import { createFollowedArtists, type FollowedArtistsDeps } from "./followedArtists.ts";

const deezer = (artists: readonly { id: number; name: string; nb_fan?: number }[]) =>
  (async () =>
    new Response(
      JSON.stringify({ data: artists.map((artist) => ({ type: "artist", ...artist })) }),
    )) as unknown as typeof fetch;
const noAnswer = (async () => {
  throw new TypeError("fetch failed");
}) as unknown as typeof fetch;

const followed = async (over: Partial<FollowedArtistsDeps> = {}) => {
  const db = await openTestDatabase();
  const synced = new Map<string, string>();
  const local = new Map<string, string>();
  const stamped: string[] = [];
  const service = createFollowedArtists({
    db,
    configured: true,
    signedIn: () => true,
    systemCountry: () => "BR",
    setting: (key) => synced.get(key) ?? null,
    saveSetting: (key, value) => {
      if (value === null) synced.delete(key);
      else synced.set(key, value);
      stamped.push(key);
    },
    local: {
      get: (key) => local.get(key),
      set: (key, value) => {
        if (value === null) local.delete(key);
        else local.set(key, value);
      },
    },
    fetch: noAnswer,
    ...over,
  });
  return { db, synced, stamped, service };
};

test("an artist's page follows at a level, changes it and unfollows", async () => {
  const { db, service } = await followed();
  assert.deepEqual(service.state("ABBA"), {
    enabled: true,
    level: null,
    showsAvailable: true,
    signInForShows: false,
    country: "BR",
  });
  assert.equal(service.set({ name: "ABBA", ytBrowseId: "UCabba" }, "releases").level, "releases");
  assert.equal(service.state("abba").level, "releases");
  assert.equal(service.set({ name: "ABBA" }, "shows").level, "shows");
  assert.equal(selectFollow(db, "ABBA")?.ytBrowseId, "UCabba");
  assert.equal(service.set({ name: "ABBA" }, null).level, null);
  assert.deepEqual(selectFollows(db), []);
});

test("shows need the sync service and a signed-in Wave account", async () => {
  const signedOut = (await followed({ signedIn: () => false })).service.state("ABBA");
  assert.deepEqual([signedOut.showsAvailable, signedOut.signInForShows], [false, true]);
  const noService = (await followed({ configured: false })).service;
  assert.deepEqual(
    [noService.state("ABBA").showsAvailable, noService.state("ABBA").signInForShows],
    [false, false],
  );
  assert.equal(noService.view().showsConfigured, false);
});

test("Settings lists the artists followed A to Z, with their level and where their page is", async () => {
  const { db, service } = await followed();
  const abba = addTrack(db, { title: "Waterloo", artist: "ABBA" });
  const artistId = db.get<{ id: number }>(
    sql`SELECT artist_id AS id FROM tracks WHERE id = ${abba}`,
  )?.id;
  service.set({ name: "Zedd", ytBrowseId: "UCzedd" }, "releases");
  service.set({ name: "ABBA" }, "shows");
  service.set({ name: "Moby" }, "releases");
  assert.deepEqual(service.view().follows, [
    { key: "abba", name: "ABBA", level: "shows", artistId, ytBrowseId: null },
    { key: "moby", name: "Moby", level: "releases", artistId: null, ytBrowseId: null },
    { key: "zedd", name: "Zedd", level: "releases", artistId: null, ytBrowseId: "UCzedd" },
  ]);
});

test("Undo after an unfollow brings the follow back with its level, unless a newer follow replaced it", async () => {
  const { db, service } = await followed();
  service.set({ name: "ABBA", deezerId: 7 }, "shows");
  const before = selectFollow(db, "ABBA");
  service.set({ name: "ABBA" }, null);
  assert.equal(service.restore("abba"), true);
  assert.deepEqual(selectFollow(db, "ABBA"), before);
  // Undone once: there is nothing left to bring back.
  assert.equal(service.restore("abba"), false);

  service.set({ name: "ABBA" }, null);
  service.set({ name: "ABBA" }, "releases");
  assert.equal(service.restore("abba"), false);
  assert.equal(selectFollow(db, "ABBA")?.level, "releases");
  assert.equal(service.restore("never-followed"), false);
});

test("the switch is the account's: off, no follow is read and nothing is followed or searched", async () => {
  const asked: string[] = [];
  const { db, synced, stamped, service } = await followed({
    fetch: (async (url: string) => {
      asked.push(url);
      return new Response(JSON.stringify({ data: [] }));
    }) as unknown as typeof fetch,
  });
  service.set({ name: "ABBA" }, "releases");
  assert.equal(service.setEnabled(false).enabled, false);
  // The phone's format: "off", and no value at all for on.
  assert.equal(synced.get("settings.followedArtists"), "off");
  assert.deepEqual(stamped, ["settings.followedArtists"]);
  assert.deepEqual(service.state("ABBA"), {
    enabled: false,
    level: null,
    showsAvailable: true,
    signInForShows: false,
    country: "BR",
  });
  assert.throws(() => service.set({ name: "Moby" }, "releases"), /off/);
  assert.deepEqual(await service.search("abba"), { results: [], answered: true });
  assert.deepEqual(asked, []);
  // What was followed stays, listed in Settings and kept for when it is on again.
  assert.equal(service.view().follows.length, 1);
  assert.equal(selectFollows(db).length, 1);

  assert.equal(service.setEnabled(true).enabled, true);
  assert.equal(synced.has("settings.followedArtists"), false);
  assert.equal(service.state("ABBA").level, "releases");
  // Saving what is already there stamps nothing.
  service.setEnabled(true);
  assert.equal(stamped.length, 2);
});

test("the country for shows is this computer's choice, the system's region until one is made", async () => {
  const { service } = await followed();
  assert.deepEqual([service.view().countryChoice, service.view().country], [null, "BR"]);
  const chosen = service.setCountry("PT");
  assert.deepEqual([chosen.countryChoice, chosen.country], ["PT", "PT"]);
  assert.equal(service.state("ABBA").country, "PT");
  assert.equal(service.country(), "PT");
  assert.throws(() => service.setCountry("Portugal"), /country/);
  assert.equal(service.setCountry(null).country, "BR");
});

test("Find artists to follow lists the Library's matches, then Deezer's, each with its follow", async () => {
  const { db, service } = await followed({
    fetch: deezer([
      { id: 27, name: "Daft Punk", nb_fan: 100 },
      { id: 954, name: "Daft Punk Tribute", nb_fan: 2 },
    ]),
  });
  const track = addTrack(db, { title: "Da Funk", artist: "Daft Punk" });
  const artistId = db.get<{ id: number }>(
    sql`SELECT artist_id AS id FROM tracks WHERE id = ${track}`,
  )?.id;
  service.set({ name: "Daft Punk Tribute" }, "releases");
  assert.deepEqual(await service.search(" daft "), {
    answered: true,
    results: [
      { key: "daft punk", name: "Daft Punk", level: null, artistId, deezerId: 27 },
      {
        key: "daft punk tribute",
        name: "Daft Punk Tribute",
        level: "releases",
        artistId: null,
        deezerId: 954,
      },
    ],
  });
});

test("a search Deezer didn't answer keeps the Library's matches and says there was no answer", async () => {
  const { db, service } = await followed({ fetch: noAnswer });
  addTrack(db, { title: "Da Funk", artist: "Daft Punk" });
  const found = await service.search("daft");
  assert.equal(found.answered, false);
  assert.deepEqual(
    found.results.map((artist) => artist.name),
    ["Daft Punk"],
  );
  // An answer with no artists is a different thing.
  const none = await (await followed({ fetch: deezer([]) })).service.search("zzzz");
  assert.deepEqual(none, { results: [], answered: true });
});
