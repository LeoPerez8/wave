import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  HARVEST_MOBILE_BYTES,
  HARVEST_RETRY_MS,
  MAGIC_CATALOG_LOW,
  MAGIC_CATALOG_POOL,
  artistGraph,
  magicArtistKey,
  magicCatalogCandidates,
  magicRefillDue,
  magicSignal,
  startMagicQueue,
  ytTrackId,
  type CatalogSong,
  type GenreProfileOf,
  type MagicSession,
  type RecommendSources,
  type TasteProfile,
} from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 100 * DAY;

/** A catalog song by [artists] that the radios of [seeds] brought. */
const catalogSong = (videoId: string, artists: string[], seeds: string[]): CatalogSong => ({
  song: {
    videoId,
    title: `Song ${videoId}`,
    artists,
    album: null,
    albumId: null,
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
  },
  firstSeenAt: NOW - 30 * DAY,
  lastSeenAt: NOW - DAY,
  radios: seeds.map((seedName) => ({
    seed: seedName.toLowerCase(),
    seedName,
    lastSeenAt: NOW - DAY,
  })),
});

const noProfiles: GenreProfileOf = () => undefined;

const sources = (
  catalog: CatalogSong[],
  more: Partial<RecommendSources> = {},
): RecommendSources => ({
  catalog,
  graph: artistGraph({ catalog, pages: [], plays: [] }),
  profileOf: noProfiles,
  now: NOW,
  ...more,
});

/** A Magic Queue started from a Library song by [artist], its radio grown from them, any genre. */
const sessionOf = (artist: string): MagicSession => {
  const started = startMagicQueue(
    { kind: "track", id: "1", title: "Seed" },
    [{ trackId: "1", artists: [], genre: null }],
    { id: "s1", random: () => 0, radio: { artists: [artist], profile: null } },
  );
  assert.ok(started !== null);
  return started.session;
};

const notInLibrary = () => false;

const ids = (candidates: readonly { readonly song: { readonly videoId: string } }[]): string[] =>
  candidates.map((candidate) => candidate.song.videoId);

/** 60 songs of Muse's radio the engine ranks alike, and [extra] after them (by video id). */
const crowded = (extra: CatalogSong): CatalogSong[] => [
  ...Array.from({ length: 60 }, (_, at) =>
    catalogSong(`song${String(at).padStart(2, "0")}`, [`Artist ${at}`], ["Muse"]),
  ),
  extra,
];

describe("A Magic Queue's catalog candidates", () => {
  test("are the seed artists' radio songs from the catalog, as YT Music songs it weighs", () => {
    const catalog = [
      catalogSong("muse1", ["Muse"], ["Muse"]),
      catalogSong("placebo1", ["Placebo"], ["Muse"]),
      catalogSong("abba1", ["ABBA"], ["ABBA"]),
    ];
    const { candidates } = magicCatalogCandidates(sessionOf("Muse"), sources(catalog), {
      inLibrary: notInLibrary,
    });
    assert.deepEqual(new Set(ids(candidates)), new Set(["muse1", "placebo1"]));
    const placebo = candidates.find((candidate) => candidate.song.videoId === "placebo1");
    assert.equal(placebo?.trackId, ytTrackId("placebo1"));
    assert.deepEqual(placebo?.artists, ["placebo"]);
  });

  test("leave out the Library's songs, songs queued, excluded artists and a recording twice", () => {
    const catalog = [
      catalogSong("muse1", ["Muse"], ["Muse"]),
      catalogSong("owned", ["Muse"], ["Muse"]),
      catalogSong("queued", ["Muse"], ["Muse"]),
      catalogSong("skipped", ["Placebo"], ["Muse"]),
      {
        ...catalogSong("again", ["Muse"], ["Muse"]),
        song: { ...catalogSong("muse1", ["Muse"], []).song, videoId: "again" },
      },
    ];
    const started = sessionOf("Muse");
    const session = magicSignal(
      { ...started, used: [...started.used, ytTrackId("queued")] },
      {
        kind: "skip",
        song: { trackId: ytTrackId("skipped"), artists: [magicArtistKey("Placebo")], genre: null },
      },
    );
    const { candidates, left } = magicCatalogCandidates(session, sources(catalog), {
      inLibrary: (song) => song.videoId === "owned",
    });
    // "again" is muse1's recording under another video: one of the two comes.
    assert.equal(left, 1);
    assert.ok(["muse1", "again"].includes(ids(candidates)[0] ?? ""));
  });

  test("keep to the seed songs' genres: an artist with no genre known stays out", () => {
    const rock = new Map([["rock", 1]]);
    const pop = new Map([["pop", 1]]);
    const profiles: Record<string, ReadonlyMap<string, number>> = {
      Muse: rock,
      Placebo: rock,
      ABBA: pop,
    };
    const catalog = [
      catalogSong("muse1", ["Muse"], ["Muse"]),
      catalogSong("placebo1", ["Placebo"], ["Muse"]),
      catalogSong("abba1", ["ABBA"], ["Muse"]),
      catalogSong("nobody1", ["Nobody"], ["Muse"]),
    ];
    const session = { ...sessionOf("Muse"), seedProfile: { rock: 1 } };
    const { candidates } = magicCatalogCandidates(
      session,
      sources(catalog, { profileOf: (artist) => profiles[artist] }),
      { inLibrary: notInLibrary },
    );
    assert.deepEqual(new Set(ids(candidates)), new Set(["muse1", "placebo1"]));
  });

  test("hold the best 50 for a batch, and say how many the session has left", () => {
    const catalog = Array.from({ length: 80 }, (_, at) =>
      catalogSong(`song${at}`, [`Artist ${at}`], ["Muse"]),
    );
    const { candidates, left } = magicCatalogCandidates(sessionOf("Muse"), sources(catalog), {
      inLibrary: notInLibrary,
    });
    assert.equal(MAGIC_CATALOG_POOL, 50);
    assert.equal(candidates.length, 50);
    assert.equal(left, 80);
  });

  test("the session's signals bring a liked artist's songs among the best", () => {
    const catalog = crowded(catalogSong("zliked", ["Liked"], ["Muse"]));
    const started = sessionOf("Muse");
    const before = magicCatalogCandidates(started, sources(catalog), { inLibrary: notInLibrary });
    assert.ok(!ids(before.candidates).includes("zliked"));
    const liked = magicSignal(started, {
      kind: "favorite",
      song: { trackId: ytTrackId("other"), artists: [magicArtistKey("Liked")], genre: null },
    });
    const { candidates } = magicCatalogCandidates(liked, sources(catalog), {
      inLibrary: notInLibrary,
    });
    assert.equal(ids(candidates)[0], "zliked");
  });

  test("the owner's taste brings an artist they like among the best", () => {
    const catalog = crowded(catalogSong("zliked", ["Liked"], ["Muse"]));
    const taste: TasteProfile = {
      at: NOW,
      songs: new Map(),
      artists: new Map([[magicArtistKey("Liked"), 6]]),
      genres: new Map(),
    };
    const { candidates } = magicCatalogCandidates(sessionOf("Muse"), sources(catalog, { taste }), {
      inLibrary: notInLibrary,
    });
    assert.equal(ids(candidates)[0], "zliked");
  });

  test("rank by the engine's weights given (the section's sliders)", () => {
    // Carried by four radios, close to Muse through one: popular.
    const catalog = crowded(catalogSong("zpopular", ["Popular"], ["Muse", "A", "B", "C"]));
    const ranked = (popularity: number) =>
      ids(
        magicCatalogCandidates(sessionOf("Muse"), sources(catalog), {
          inLibrary: notInLibrary,
          engine: { weights: { popularity } },
        }).candidates,
      );
    assert.ok(!ranked(0).includes("zpopular"));
    assert.equal(ranked(1)[0], "zpopular");
  });

  test("offline, only the songs that can play: those the audio cache holds whole", () => {
    const catalog = [
      catalogSong("cached", ["Muse"], ["Muse"]),
      catalogSong("streamed", ["Muse"], ["Muse"]),
    ];
    const { candidates, left } = magicCatalogCandidates(sessionOf("Muse"), sources(catalog), {
      inLibrary: notInLibrary,
      playable: (videoId) => videoId === "cached",
    });
    assert.deepEqual(ids(candidates), ["cached"]);
    assert.equal(left, 1);
  });
});

describe("A Magic Queue's refill", () => {
  const WIFI = { onMobileData: false, usedToday: 0, now: NOW };
  const MOBILE = { onMobileData: true, usedToday: 0, now: NOW };
  /** A catalog of Muse's radio, read [ago] before now. */
  const readAgo = (ago: number): CatalogSong[] => [
    {
      ...catalogSong("muse1", ["Muse"], []),
      radios: [{ seed: "muse", seedName: "Muse", lastSeenAt: NOW - ago }],
    },
  ];
  const never: CatalogSong[] = [catalogSong("abba1", ["ABBA"], ["ABBA"])];

  test("isn't due while the session has enough candidates left", () => {
    assert.equal(MAGIC_CATALOG_LOW, 20);
    const session = sessionOf("Muse");
    assert.equal(magicRefillDue(session, { catalog: never, left: 20 }, WIFI), false);
    assert.equal(magicRefillDue(session, { catalog: never, left: 19 }, WIFI), true);
  });

  test("on Wi-Fi, reads a radio running low unless it was read in the last 12 hours", () => {
    const session = sessionOf("Muse");
    const left = 5;
    assert.equal(magicRefillDue(session, { catalog: readAgo(DAY), left }, WIFI), true);
    assert.equal(
      magicRefillDue(session, { catalog: readAgo(HARVEST_RETRY_MS - 1), left }, WIFI),
      false,
    );
  });

  test("on mobile data, only when none is left, within the harvest's day", () => {
    const session = sessionOf("Muse");
    assert.equal(magicRefillDue(session, { catalog: never, left: 1 }, MOBILE), false);
    assert.equal(magicRefillDue(session, { catalog: never, left: 0 }, MOBILE), true);
    assert.equal(
      magicRefillDue(
        session,
        { catalog: never, left: 0 },
        { ...MOBILE, usedToday: HARVEST_MOBILE_BYTES },
      ),
      false,
    );
  });

  test("a refill tried this session that brought nothing isn't due again within 12 hours", () => {
    const session = sessionOf("Muse");
    const tried = (ago: number) => ({ ...WIFI, tried: new Map([[session.id, NOW - ago]]) });
    assert.equal(magicRefillDue(session, { catalog: never, left: 0 }, tried(DAY / 24)), false);
    assert.equal(
      magicRefillDue(session, { catalog: never, left: 0 }, tried(HARVEST_RETRY_MS - 1)),
      false,
    );
    assert.equal(magicRefillDue(session, { catalog: never, left: 0 }, tried(HARVEST_RETRY_MS)), true);
    const other = new Map([["another session", NOW]]);
    assert.equal(magicRefillDue(session, { catalog: never, left: 0 }, { ...WIFI, tried: other }), true);
  });

  test("never for a session with no radio artists", () => {
    const session = { ...sessionOf("Muse"), radioArtists: [] };
    assert.equal(magicRefillDue(session, { catalog: never, left: 0 }, WIFI), false);
  });
});
