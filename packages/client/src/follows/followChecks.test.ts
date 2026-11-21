import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { WaveServiceRefusal } from "../askWaveService.ts";
import { hideFollowRelease, readFollowReleases } from "../db/followReleases.ts";
import { readFollowShows } from "../db/followShows.ts";
import { selectFollow } from "../db/follows.ts";
import { addTrack, closeTestDatabase, openTestDatabase } from "../db/testDatabase.ts";
import { followReleasesCheck, type FollowReleasesPorts } from "./followReleasesCheck.ts";
import { followShowsCheck } from "./followShowsCheck.ts";
import { databaseFollowStore } from "./followStore.ts";

const attractions = {
  _embedded: {
    attractions: [{ id: "K1", name: "ABBA", classifications: [{ segment: { name: "Music" } }] }],
  },
};
const events = {
  _embedded: {
    events: [
      {
        id: "E1",
        url: "https://tickets.example/E1",
        dates: { start: { dateTime: "2099-05-01T20:00:00Z" } },
        _embedded: {
          venues: [{ name: "Hall", city: { name: "São Paulo" }, country: { countryCode: "BR" } }],
        },
      },
    ],
  },
};

/** A shows check over a real Library, with the service answering [answer]. */
const shows = (
  store: ReturnType<typeof databaseFollowStore>,
  answer: (path: string) => unknown,
  over: Partial<Parameters<typeof followShowsCheck>[0]> = {},
) => {
  const calls: string[] = [];
  let today: { day: number; count: number } | null = null;
  const check = followShowsCheck({
    configured: true,
    enabled: () => true,
    country: () => "BR",
    signedIn: async () => true,
    online: () => true,
    checksToday: { get: () => today, set: (value) => (today = value) },
    ask: async (path) => {
      calls.push(path);
      return answer(path);
    },
    pause: "0 millis",
    ...over,
  });
  return { calls, run: () => Effect.runPromise(check(store, "home")) };
};

test("a show check saves a shows-level artist's shows from the service's Ticketmaster routes", async () => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "shows"));
    await Effect.runPromise(store.setFollow({ name: "Aurora" }, "releases"));
    const { calls, run } = shows(store, (path) =>
      path.includes("/attractions") ? attractions : events,
    );
    assert.equal(await run(), true);
    assert.deepEqual(calls, [
      "/v1/ticketmaster/attractions?keyword=ABBA",
      "/v1/ticketmaster/events?attractionId=K1&countryCode=BR",
    ]);
    const saved = readFollowShows(db).artists;
    assert.deepEqual(
      saved.map((a) => [a.key, a.attractionId, a.country, a.shows.map((s) => s.city)]),
      [["abba", "K1", "BR", ["São Paulo"]]],
    );
    assert.equal(await run(), false, "checked a moment ago: nothing is due");
    assert.equal(calls.length, 2);
  } finally {
    closeTestDatabase(db);
  }
});

test("a show check asks nothing signed out, offline or with the switch off, and stops at a refusal", async () => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "shows"));
    await Effect.runPromise(store.setFollow({ name: "Blur" }, "shows"));
    for (const over of [
      { signedIn: async () => false },
      { online: () => false },
      { enabled: () => false },
      { configured: false },
    ]) {
      const { calls, run } = shows(store, () => attractions, over);
      assert.equal(await run(), false);
      assert.deepEqual(calls, []);
    }
    const refused = shows(store, () => {
      throw new WaveServiceRefusal(429, "ticketmaster");
    });
    assert.equal(await refused.run(), false);
    assert.equal(refused.calls.length, 1, "the second artist isn't asked about");
  } finally {
    closeTestDatabase(db);
  }
});

/** A Follows check whose Deezer artist ABBA (7) lists [releases]; [asked] collects the URLs. */
const releasesCheck = (
  releases: readonly {
    id: number;
    title: string;
    release_date: string;
    explicit_lyrics?: boolean;
  }[],
  ytEnabled = () => true,
  over: Partial<FollowReleasesPorts> = {},
) => {
  const asked: string[] = [];
  const check = followReleasesCheck({
    enabled: () => true,
    ytEnabled,
    country: () => "",
    showsCheckable: async () => false,
    checkShows: () => Effect.succeed(false),
    fetch: (async (url: string) => {
      asked.push(url);
      const body = url.includes("/search/artist")
        ? { data: [{ id: 7, name: "ABBA", nb_fan: 10 }] }
        : { data: releases.map((r) => ({ ...r, record_type: "album" })) };
      return { ok: true, status: 200, json: async () => body };
    }) as unknown as typeof fetch,
    ...over,
  });
  return { asked, check };
};
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
/**
 * YT Music answering Albums searches with [albums]; [searches] collects the queries. An album in
 * [empty] reads with no songs; [offline] fails every search as no connection; [artists] answers
 * artist searches, collected in [artistSearches].
 */
const albumsYt = (
  albums: Record<string, string>,
  {
    empty = [],
    offline = false,
    artists = {},
  }: {
    empty?: readonly string[];
    offline?: boolean;
    artists?: Record<string, string>;
  } = {},
) => {
  const searches: string[] = [];
  const artistSearches: string[] = [];
  return {
    searches,
    artistSearches,
    yt: {
      searchAlbums: (query: string) => {
        searches.push(query);
        if (offline) return Effect.fail({ offline: true });
        const title = Object.keys(albums).find((t) => query === `ABBA ${t}`);
        return Effect.succeed(
          title === undefined
            ? []
            : [
                {
                  title,
                  releaseType: "album" as const,
                  browseId: albums[title]!,
                  artists: ["ABBA"],
                },
              ],
        );
      },
      album: (browseId: string) =>
        Effect.succeed({
          tracks: empty.includes(browseId) ? [] : [{ videoId: `${browseId}-1` }],
        }),
      searchArtists: (name: string) => {
        artistSearches.push(name);
        const browseId = artists[name];
        return Effect.succeed(browseId === undefined ? [] : [{ name, browseId, audience: 1000 }]);
      },
    },
  };
};

test("a Follows check saves each artist's Deezer releases and matches them on YT Music", async () => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "releases"));
    const { asked, check } = releasesCheck([
      { id: 1, title: "Voyage", release_date: daysAgo(0) },
      { id: 2, title: "Old", release_date: "1980-01-01" },
    ]);
    const { yt, searches } = albumsYt({ Voyage: "MPRE1" });
    assert.equal(await Effect.runPromise(check(store, yt, "home")), true);
    assert.equal(asked.length, 2);
    assert.deepEqual(searches, ["ABBA Voyage"], "only the release inside the follow's window");
    assert.equal(selectFollow(db, "ABBA")?.deezerId, 7);
    const releases = readFollowReleases(db).artists[0]!.releases;
    assert.deepEqual(
      releases.map((r) => [r.title, r.browseId, r.videoIds]),
      [
        ["Voyage", "MPRE1", ["MPRE1-1"]],
        ["Old", null, []],
      ],
    );
    assert.equal(await Effect.runPromise(check(store, yt, "home")), false, "nothing is due");
    assert.equal(asked.length, 2);
  } finally {
    closeTestDatabase(db);
  }
});

test("a Follows check handles each answer on a turn of its own, after the network wait", async () => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "releases"));
    const events: string[] = [];
    const { check } = releasesCheck(
      [{ id: 1, title: "Voyage", release_date: daysAgo(0) }],
      () => true,
      {
        settle: Effect.sync(() => events.push("settle")),
        answered: Effect.sync(() => events.push("answered")),
      },
    );
    const { yt, searches } = albumsYt({ Voyage: "MPRE1" });
    assert.equal(await Effect.runPromise(check(store, yt, "home")), true);
    assert.deepEqual(searches, ["ABBA Voyage"]);
    // The Deezer artist search, its releases page and the YT Music search: each answer then a turn.
    assert.equal(
      events.filter((event) => event === "answered").length >= 3,
      true,
      events.join(" "),
    );
    for (const [at, event] of events.entries())
      if (event === "answered") assert.notEqual(events[at + 1], "answered");
  } finally {
    closeTestDatabase(db);
  }
});

test("a Follows check searches unmatched releases newest first, and a miss again at the next check", async () => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "releases"));
    const { check } = releasesCheck([
      { id: 1, title: "Older", release_date: daysAgo(3) },
      { id: 2, title: "Newest", release_date: daysAgo(0) },
      { id: 3, title: "Middle", release_date: daysAgo(1) },
    ]);
    const first = albumsYt({ Middle: "MPRE3" });
    await Effect.runPromise(check(store, first.yt, "home"));
    assert.deepEqual(first.searches, ["ABBA Newest", "ABBA Middle", "ABBA Older"]);
    // Due again: only the misses are asked for.
    const cached = readFollowReleases(db).artists[0]!;
    await Effect.runPromise(store.saveFollowReleases("abba", cached.releases, 0));
    const second = albumsYt({ Older: "MPRE1" });
    await Effect.runPromise(check(store, second.yt, "home"));
    assert.deepEqual(second.searches, ["ABBA Newest", "ABBA Older"]);
    assert.deepEqual(
      readFollowReleases(db).artists[0]!.releases.map((r) => [r.title, r.browseId]),
      [
        ["Older", "MPRE1"],
        ["Newest", null],
        ["Middle", "MPRE3"],
      ],
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("a Follows check with YT Music off reads Deezer and searches nothing", async () => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "releases"));
    const { asked, check } = releasesCheck(
      [{ id: 1, title: "Voyage", release_date: daysAgo(0) }],
      () => false,
    );
    const { yt, searches } = albumsYt({ Voyage: "MPRE1" });
    assert.equal(await Effect.runPromise(check(store, yt, "home")), true);
    assert.equal(asked.length, 2);
    assert.deepEqual(searches, []);
  } finally {
    closeTestDatabase(db);
  }
});

test("a Follows check saves no match whose album has no songs", async () => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "releases"));
    const { check } = releasesCheck([{ id: 1, title: "Voyage", release_date: daysAgo(0) }]);
    const { yt } = albumsYt({ Voyage: "MPRE1" }, { empty: ["MPRE1"] });
    await Effect.runPromise(check(store, yt, "home"));
    assert.deepEqual(
      readFollowReleases(db).artists[0]!.releases.map((r) => [r.title, r.browseId]),
      [["Voyage", null]],
    );
  } finally {
    closeTestDatabase(db);
  }
});

test("a Follows check searches only releases that could show: not in the Library, hidden or blocked explicit", async () => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "releases"));
    addTrack(db, { title: "One", album: "Owned", artist: "ABBA" });
    hideFollowRelease(db, "deezer:3", 1);
    const { check } = releasesCheck(
      [
        { id: 1, title: "Owned", release_date: daysAgo(0) },
        { id: 2, title: "Wanted", release_date: daysAgo(1) },
        { id: 3, title: "Hidden", release_date: daysAgo(2) },
        { id: 4, title: "Rude", release_date: daysAgo(3), explicit_lyrics: true },
      ],
      () => true,
      { blockExplicit: () => true },
    );
    const { yt, searches } = albumsYt({});
    await Effect.runPromise(check(store, yt, "home"));
    assert.deepEqual(searches, ["ABBA Wanted"]);
  } finally {
    closeTestDatabase(db);
  }
});

test("a Follows check stops searching at the first answer that there's no connection", async () => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "releases"));
    const { check } = releasesCheck(
      [
        { id: 1, title: "Newest", release_date: daysAgo(0) },
        { id: 2, title: "Older", release_date: daysAgo(1) },
      ],
      () => true,
      { offline: (error) => (error as { offline?: boolean }).offline === true },
    );
    const { yt, searches } = albumsYt({}, { offline: true });
    await Effect.runPromise(check(store, yt, "home"));
    assert.deepEqual(searches, ["ABBA Newest"]);
  } finally {
    closeTestDatabase(db);
  }
});

test("a Follows check saves a follow's YT Music artist when it has none", async () => {
  const db = await openTestDatabase();
  try {
    const store = databaseFollowStore(db);
    await Effect.runPromise(store.setFollow({ name: "ABBA" }, "releases"));
    const { check } = releasesCheck([{ id: 1, title: "Voyage", release_date: daysAgo(0) }]);
    const first = albumsYt({}, { artists: { ABBA: "UCabba" } });
    await Effect.runPromise(check(store, first.yt, "home"));
    assert.deepEqual(first.artistSearches, ["ABBA"]);
    assert.equal(selectFollow(db, "ABBA")?.ytBrowseId, "UCabba");
    // Due again: the saved artist isn't looked up again.
    const cached = readFollowReleases(db).artists[0]!;
    await Effect.runPromise(store.saveFollowReleases("abba", cached.releases, 0));
    const second = albumsYt({}, { artists: { ABBA: "UCother" } });
    await Effect.runPromise(check(store, second.yt, "home"));
    assert.deepEqual(second.artistSearches, []);
    assert.equal(selectFollow(db, "ABBA")?.ytBrowseId, "UCabba");
  } finally {
    closeTestDatabase(db);
  }
});
