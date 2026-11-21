import assert from "node:assert/strict";
import { test } from "node:test";
import { hideFollowRelease, readFollowReleases } from "@wave/client/db/followReleases";
import { saveFollow } from "@wave/client/db/follows";
import { saveFollowShows } from "@wave/client/db/followShows";
import { databaseFollowStore } from "@wave/client/follows/followStore";
import { addTrack, openTestDatabase } from "@wave/client/testing";
import type { FollowRelease } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { createHomeFollow, type HomeFollowDeps } from "./homeFollow.ts";

const DAY = 86_400_000;
const day = (ago: number) => new Date(Date.now() - ago * DAY).toISOString().slice(0, 10);
const release = (key: string, title: string, over: Partial<FollowRelease> = {}): FollowRelease => ({
  key,
  artistKey: "abba",
  title,
  type: "album",
  releaseDate: day(1),
  artworkUrl: `https://cdn-images.dzcdn.net/images/cover/${key}/250x250.jpg`,
  explicit: false,
  browseId: null,
  videoIds: [],
  recordingKeys: [],
  ...over,
});

const notAsked = () => Promise.reject(new Error("not asked in this test"));
const home = async (over: Partial<HomeFollowDeps> = {}) => {
  const db = await openTestDatabase();
  const settings = new Map<string, string>();
  const local = new Map<string, string>();
  const service = createHomeFollow({
    db,
    configured: true,
    signedIn: () => true,
    ask: notAsked,
    online: () => true,
    country: () => "BR",
    setting: (key) => settings.get(key) ?? null,
    local: { get: (key) => local.get(key), set: (key, value) => void local.set(key, value) },
    ytEnabled: () => true,
    pages: {
      album: notAsked,
      catalog: notAsked,
      searchArtists: notAsked,
    },
    fetch: notAsked as unknown as typeof fetch,
    pause: "0 millis",
    ...over,
  });
  return { db, settings, service };
};

test("Home's follow cards are the saved releases and the country's shows, as the phone picks them", async () => {
  const { db, settings, service } = await home();
  saveFollow(db, { name: "ABBA" }, "shows", Date.now());
  saveFollow(db, { name: "Blur" }, "releases", Date.now());
  const store = databaseFollowStore(db);
  await Effect.runPromise(
    store.saveFollowReleases(
      "abba",
      [
        release("deezer:1", "Voyage", { type: "ep", releaseDate: day(2), browseId: "MPRE1" }),
        release("deezer:2", "Hidden", { browseId: "MPRE2" }),
        release("deezer:3", "Loud", { explicit: true, artworkUrl: null, browseId: "MPRE3" }),
        release("deezer:4", "Tomorrow", { releaseDate: day(-1), browseId: "MPRE4" }),
        release("deezer:5", "Unmatched"),
      ],
      Date.now(),
    ),
  );
  hideFollowRelease(db, "deezer:2", Date.now());
  const show = { artistKey: "abba", startsAt: "2099-05-01T20:00:00Z", venue: "Hall" };
  saveFollowShows(db, {
    key: "abba",
    attractionId: "K1",
    country: "BR",
    checkedAt: Date.now(),
    shows: [
      { ...show, id: "E1", country: "BR", city: "São Paulo", ticketUrl: "https://t.example/E1" },
      { ...show, id: "E2", country: "PT", city: "Lisboa", ticketUrl: "https://t.example/E2" },
    ],
  });

  const view = await service.view();
  assert.deepEqual(view.releases, [
    {
      key: "deezer:3",
      title: "Loud",
      artist: "ABBA",
      type: "album",
      releaseDate: day(1),
      hasArtwork: false,
    },
    {
      key: "deezer:1",
      title: "Voyage",
      artist: "ABBA",
      type: "ep",
      releaseDate: day(2),
      hasArtwork: true,
    },
  ]);
  assert.deepEqual(view.shows, [
    {
      id: "E1",
      artist: "ABBA",
      startsAt: "2099-05-01T20:00:00Z",
      city: "São Paulo",
      venue: "Hall",
      ticketUrl: "https://t.example/E1",
    },
  ]);

  const ytOff = await home({ db, ytEnabled: () => false });
  assert.deepEqual(
    (await ytOff.service.view()).releases,
    [],
    "with YT Music off only the Library's releases show",
  );

  settings.set("settings.dontPlayExplicit", "on");
  assert.deepEqual(
    (await service.view()).releases.map((r) => r.title),
    ["Voyage"],
    "Don't Play Explicit leaves an explicit release out",
  );
  settings.set("settings.followedArtists", "off");
  assert.deepEqual(await service.view(), { releases: [], shows: [] });
});

test("a release card opens the Library's album, or its YT Music album while that reads", async () => {
  let album: Awaited<ReturnType<HomeFollowDeps["pages"]["album"]>> = {
    status: "ok",
    album: { title: "Voyage", artists: ["ABBA"], year: null, artworkUrl: null, songs: [] },
  };
  const { db, service } = await home({
    pages: { catalog: notAsked, album: async () => album, searchArtists: notAsked },
  });
  saveFollow(db, { name: "ABBA" }, "releases", Date.now());
  const owned = addTrack(db, { title: "Waterloo", album: "Waterloo", artist: "ABBA" });
  const albumId = db.get<{ id: number }>(
    sql`SELECT album_id AS id FROM tracks WHERE id = ${owned}`,
  );
  await Effect.runPromise(
    databaseFollowStore(db).saveFollowReleases(
      "abba",
      [release("deezer:1", "Voyage", { browseId: "MPRE1" }), release("deezer:2", "Waterloo")],
      Date.now(),
    ),
  );
  assert.deepEqual(await service.open("deezer:2"), { kind: "album", id: albumId?.id });
  album = {
    status: "ok",
    album: { ...album.album!, songs: [{ videoId: "v1" }] as never },
  };
  assert.deepEqual(await service.open("deezer:1"), { kind: "ytAlbum", browseId: "MPRE1" });
  album = { status: "offline", album: null };
  assert.deepEqual(await service.open("deezer:1"), { kind: "noAnswer" });
  album = { status: "ok", album: null };
  assert.deepEqual(await service.open("deezer:1"), { kind: "notFound" });
  assert.equal(readFollowReleases(db).artists[0]!.releases[0]!.browseId, null, "gone: unmatched");
  assert.deepEqual(await service.open("deezer:1"), { kind: "notFound" }, "and hidden");
  assert.deepEqual(await service.open("deezer:404"), { kind: "notFound" });
});

test("a release's cover is read only from Deezer, by the card's key", async () => {
  const fetched: string[] = [];
  const { db, service } = await home({
    fetch: (async (url: string) => {
      fetched.push(url);
      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "image/jpeg" },
      });
    }) as unknown as typeof fetch,
  });
  saveFollow(db, { name: "ABBA" }, "releases", Date.now());
  await Effect.runPromise(
    databaseFollowStore(db).saveFollowReleases(
      "abba",
      [
        release("deezer:1", "Voyage", { browseId: "MPRE1" }),
        release("deezer:2", "Elsewhere", {
          artworkUrl: "https://images.example/cover.jpg",
          browseId: "MPRE2",
        }),
      ],
      Date.now(),
    ),
  );
  assert.equal(await service.artwork("deezer:1"), "data:image/jpeg;base64,AQID");
  assert.equal(await service.artwork("deezer:1"), "data:image/jpeg;base64,AQID");
  assert.equal(await service.artwork("deezer:2"), null);
  assert.equal(await service.artwork("deezer:404"), null);
  assert.deepEqual(fetched, ["https://cdn-images.dzcdn.net/images/cover/deezer:1/250x250.jpg"]);
  assert.equal(
    (await service.view()).releases.find((r) => r.key === "deezer:2")?.hasArtwork,
    false,
  );
});

test("Home's check asks Deezer and the service's Ticketmaster routes, and saves what they answer", async () => {
  const asked: string[] = [];
  const { db, service } = await home({
    ytEnabled: () => false,
    ask: async (path) => {
      asked.push(path);
      return path.includes("/attractions")
        ? {
            _embedded: {
              attractions: [
                { id: "K1", name: "ABBA", classifications: [{ segment: { name: "Music" } }] },
              ],
            },
          }
        : {
            _embedded: {
              events: [
                {
                  id: "E1",
                  url: "https://tickets.example/E1",
                  dates: { start: { dateTime: "2099-05-01T20:00:00Z" } },
                  _embedded: {
                    venues: [
                      { name: "Hall", city: { name: "Recife" }, country: { countryCode: "BR" } },
                    ],
                  },
                },
              ],
            },
          };
    },
    fetch: (async (url: string) => {
      asked.push(new URL(url).pathname);
      const body = url.includes("/search/artist")
        ? { data: [{ id: 7, name: "ABBA", nb_fan: 10 }] }
        : { data: [{ id: 1, title: "Voyage", record_type: "album", release_date: day(0) }] };
      return { ok: true, status: 200, json: async () => body };
    }) as unknown as typeof fetch,
  });
  saveFollow(db, { name: "ABBA" }, "shows", Date.now());
  assert.equal(await service.check(), true);
  assert.deepEqual(
    readFollowReleases(db).artists[0]!.releases.map((r) => [r.title, r.browseId]),
    [["Voyage", null]],
    "saved, unmatched: YT Music is off",
  );
  assert.equal(asked.filter((path) => path.startsWith("/v1/ticketmaster/")).length, 2);
  const view = await service.view();
  assert.deepEqual(
    [view.releases.map((r) => r.title), view.shows.map((s) => s.city)],
    [[], ["Recife"]],
  );
  const count = asked.length;
  assert.equal(await service.check(), false, "checked a moment ago: nothing is due");
  assert.equal(asked.length, count);
});

test("Home's check asks nothing with Followed artists off, and no shows signed out", async () => {
  const asked: string[] = [];
  const quiet = (async (url: string) => {
    asked.push(url);
    return { ok: true, status: 200, json: async () => ({ data: [] }) };
  }) as unknown as typeof fetch;
  const off = await home({ fetch: quiet });
  off.settings.set("settings.followedArtists", "off");
  saveFollow(off.db, { name: "ABBA" }, "shows", Date.now());
  assert.equal(await off.service.check(), false);
  assert.deepEqual(asked, []);

  const out = await home({ fetch: quiet, signedIn: () => false, ytEnabled: () => false });
  saveFollow(out.db, { name: "ABBA" }, "shows", Date.now());
  await out.service.check();
  assert.ok(asked.length > 0, "releases are still checked");
});
