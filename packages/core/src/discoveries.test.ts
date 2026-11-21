import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  carouselPageSongs,
  catalogueOf,
  discoveries,
  magicArtistKey,
  magicQueueCarouselPageLabel,
  magicQueueCarouselPageTitle,
  magicQueueCarouselPages,
  tasteProfile,
  ytTrackId,
  type CatalogSong,
  type DiscoveryCatalogSong,
  type DiscoveryLibrarySong,
  type MagicQueueSeed,
  type MagicSong,
  type TasteProfile,
} from "./index.ts";

const NOW = Date.UTC(2026, 10, 20, 12);

const magic = (trackId: string, artist: string): MagicSong => ({
  trackId,
  artists: [magicArtistKey(artist)],
  genre: null,
  style: null,
});

/** A candidate catalog song by [artist], brought by [radios] radios. */
const candidate = (videoId: string, artist: string, radios = 1): DiscoveryCatalogSong => {
  const entry: CatalogSong = {
    song: {
      videoId,
      title: videoId,
      artists: [artist],
      album: null,
      albumId: null,
      durationMs: 200_000,
      artworkUrl: null,
      explicit: false,
    },
    firstSeenAt: NOW,
    lastSeenAt: NOW,
    radios: Array.from({ length: radios }, (_, place) => ({
      seed: `seed ${place}`,
      seedName: `Seed ${place}`,
      lastSeenAt: NOW,
    })),
  };
  return { entry, magic: magic(ytTrackId(videoId), artist) };
};

/** A Library song by [artist], as the app holds it. */
const owned = (id: number, artist: string): DiscoveryLibrarySong<{ readonly id: number }> => ({
  song: { id },
  magic: magic(String(id), artist),
});

/** A profile of an owner who played [liked]'s songs through and skipped [skipped]'s. */
const tasteFor = (liked: readonly string[], skipped: readonly string[] = []): TasteProfile => {
  const songs = new Map<string, MagicSong>();
  const play = (artist: string, trackId: string, through: boolean) => {
    songs.set(trackId, magic(trackId, artist));
    return {
      trackId,
      startedAt: NOW,
      listenedMs: through ? 200_000 : 5_000,
      endReason: through ? ("completed" as const) : ("skipped" as const),
    };
  };
  const plays = [
    ...liked.map((artist, place) => play(artist, `liked ${place}`, true)),
    ...skipped.map((artist, place) => play(artist, `skipped ${place}`, false)),
  ];
  return tasteProfile({ plays, favorites: [], downloads: [] }, (id) => songs.get(id), NOW);
};

const NOTHING_PLAYED: ReadonlySet<string> = new Set();

/** The page's songs as short names: a video id, or "library <id>". */
const names = (page: readonly MagicQueueSeed<unknown>[]) =>
  page.map((seed) =>
    seed.source === "stream"
      ? seed.song.videoId
      : `library ${(seed.song as { readonly id: number }).id}`,
  );

describe("discoveries", () => {
  test("ranks the candidate catalog by the Taste profile, liked artists first and skipped ones last", () => {
    const page = discoveries({
      catalog: [
        candidate("skipped", "Dull Band"),
        candidate("unknown", "Stranger"),
        candidate("liked", "Loved Band"),
      ],
      library: [],
      played: NOTHING_PLAYED,
      taste: tasteFor(["Loved Band"], ["Dull Band"]),
    });
    assert.deepEqual(names(page), ["liked", "unknown", "skipped"]);
  });

  test("gives the catalog's songs as the songs they are, to stream", () => {
    const song = candidate("a", "Band");
    const [first] = discoveries({
      catalog: [song],
      library: [],
      played: NOTHING_PLAYED,
      taste: null,
    });
    assert.deepEqual(first, { source: "stream", song: song.entry.song });
  });

  test("ranks songs the profile tells nothing apart by how many radios brought them", () => {
    const page = discoveries({
      catalog: [candidate("rare", "A", 1), candidate("common", "B", 4), candidate("some", "C", 2)],
      library: [],
      played: NOTHING_PLAYED,
      taste: null,
    });
    assert.deepEqual(names(page), ["common", "some", "rare"]);
  });

  test("puts unplayed Library songs after the catalog's, ranked by the profile too", () => {
    const page = discoveries({
      catalog: [candidate("new", "Stranger")],
      library: [owned(1, "Stranger"), owned(2, "Loved Band")],
      played: NOTHING_PLAYED,
      taste: tasteFor(["Loved Band"]),
    });
    assert.deepEqual(names(page), ["new", "library 2", "library 1"]);
  });

  test("leaves out every song with a counted play, streamed or in the Library", () => {
    const page = discoveries({
      catalog: [candidate("heard", "A"), candidate("fresh", "B")],
      library: [owned(1, "C"), owned(2, "D")],
      played: new Set([ytTrackId("heard"), "2"]),
      taste: null,
    });
    assert.deepEqual(names(page), ["fresh", "library 1"]);
  });

  test("has no song when everything was played, or nothing is kept", () => {
    assert.deepEqual(
      discoveries({
        catalog: [candidate("heard", "A")],
        library: [owned(1, "C")],
        played: new Set([ytTrackId("heard"), "1"]),
        taste: null,
      }),
      [],
    );
    assert.deepEqual(
      discoveries({ catalog: [], library: [], played: NOTHING_PLAYED, taste: null }),
      [],
    );
  });

  test("leaves out disliked songs", () => {
    const page = discoveries({
      catalog: [candidate("no", "A"), candidate("yes", "B")],
      library: [owned(1, "C"), owned(2, "D")],
      played: NOTHING_PLAYED,
      taste: null,
      disliked: new Set([ytTrackId("no"), "1"]),
    });
    assert.deepEqual(names(page), ["yes", "library 2"]);
  });

  test("lists a song the catalog holds twice once", () => {
    const page = discoveries({
      catalog: [candidate("a", "A"), candidate("a", "A"), candidate("b", "B")],
      library: [],
      played: NOTHING_PLAYED,
      taste: null,
    });
    assert.deepEqual(names(page), ["a", "b"]);
  });
});

describe("the Discoveries page", () => {
  const fresh = Array.from({ length: 12 }, (_, place) => candidate(`song ${place}`, "A"));
  const page = (count: number) =>
    carouselPageSongs(
      discoveries({
        catalog: fresh.slice(0, count),
        library: [],
        played: NOTHING_PLAYED,
        taste: null,
      }),
    );

  test("shows up to nine songs", () => {
    assert.equal(page(12).length, 9);
    assert.equal(page(3).length, 3);
  });

  test("is left out with fewer than three songs", () => {
    assert.deepEqual(page(2), []);
    assert.deepEqual(
      magicQueueCarouselPages({ "most-listened-recently": 9, "magic-queue": 9, discoveries: 2 }),
      ["most-listened-recently", "magic-queue"],
    );
  });

  test("is the carousel's third page", () => {
    assert.deepEqual(
      magicQueueCarouselPages({ "most-listened-recently": 9, "magic-queue": 9, discoveries: 3 }),
      ["most-listened-recently", "magic-queue", "discoveries"],
    );
  });

  test("is named in English and Brazilian Portuguese", () => {
    const ptBR = catalogueOf("pt-BR");
    assert.equal(magicQueueCarouselPageTitle("discoveries"), "Discoveries");
    assert.equal(magicQueueCarouselPageTitle("discoveries", ptBR), "Descobertas");
    assert.equal(
      magicQueueCarouselPageLabel(["magic-queue", "discoveries"], 1, ptBR),
      "Descobertas, página 2 de 2",
    );
  });
});
