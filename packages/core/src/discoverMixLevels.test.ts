import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DISCOVER_MIX_LEVELS,
  blendDiscoverMix,
  discoverMix,
  discoverMixCaption,
  discoverMixKeep,
  discoverMixLibraryPool,
  discoverMixPlaylist,
  parseDiscoverMixes,
  placeDiscoverMixSongs,
  storedDiscoverMixes,
  readDiscoverMixLevel,
} from "./index.ts";

const radioSong = (n: number) => ({
  videoId: `v${n}`,
  title: `New ${n}`,
  artists: ["Someone New"],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
  video: false,
});
const newSongs = (count: number) => Array.from({ length: count }, (_, n) => radioSong(n));
const librarySong = (id: number) => ({ id, title: `Old ${id}`, artist: "Someone Known" });
const librarySongs = (count: number) => Array.from({ length: count }, (_, n) => librarySong(n + 1));

const portishead = {
  kind: "artist" as const,
  id: "artist:portishead",
  name: "Portishead",
  from: "plays" as const,
};

/** A mix's songs as letters: N for a new song, L for a Library one. */
const shape = (mix: ReturnType<typeof blendDiscoverMix>): string =>
  mix.songs.map((song) => (song.source === "stream" ? "N" : "L")).join("");

describe("A mix's level", () => {
  test("at 3, makes a 25-song mix of 15 new songs and 10 Library songs, interleaved", () => {
    const mix = discoverMix(portishead, newSongs(25), librarySongs(20))!;
    const blended = blendDiscoverMix(mix, { level: 3 });
    assert.equal(shape(blended), "NNLNLNNLNLNNLNLNNLNLNNLNL");
  });

  test("sets each level's share of new songs, the rest from the Library", () => {
    const mix = discoverMix(portishead, newSongs(25), librarySongs(25))!;
    const counts = ([1, 2, 3, 4, 5] as const).map((level) => {
      const songs = blendDiscoverMix(mix, { level }).songs;
      return [songs.length, songs.filter((song) => song.source === "stream").length];
    });
    assert.deepEqual(counts, [
      [25, 5],
      [25, 10],
      [25, 15],
      [25, 20],
      [25, 25],
    ]);
  });

  test("at 1, spreads its few new songs through the mix, starting with one", () => {
    const mix = discoverMix(portishead, newSongs(10), librarySongs(10))!;
    assert.equal(shape(blendDiscoverMix(mix, { level: 1 })), "NLLLLNLLLL");
  });

  test("at 5, plays only new songs, in the radio's order", () => {
    const mix = discoverMix(portishead, newSongs(12), librarySongs(12))!;
    const songs = blendDiscoverMix(mix, { level: 5 }).songs;
    assert.deepEqual(
      songs.map((song) => (song.source === "stream" ? song.song.videoId : song.track.id)),
      ["v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11"],
    );
  });

  test("takes its new songs in the radio's order and its Library songs in the pool's", () => {
    const mix = discoverMix(portishead, newSongs(10), [
      librarySong(7),
      librarySong(3),
      librarySong(9),
      librarySong(1),
      librarySong(5),
    ])!;
    const songs = blendDiscoverMix(mix, { level: 3 }).songs;
    assert.deepEqual(
      songs.map((song) => (song.source === "stream" ? song.song.videoId : song.track.id)),
      ["v0", "v1", 7, "v2", 3, "v3", "v4", 9, "v5", 1],
    );
  });

  test("with too few Library songs, fills the familiar share with new songs and keeps its length", () => {
    const mix = discoverMix(portishead, newSongs(25), librarySongs(4))!;
    const songs = blendDiscoverMix(mix, { level: 1 }).songs;
    assert.equal(songs.length, 25);
    assert.equal(songs.filter((song) => song.source === "library").length, 4);
  });

  test("leaves out the songs [keep] refuses, the pools' next songs taking their places", () => {
    const mix = discoverMix(portishead, newSongs(10), librarySongs(6))!;
    const songs = blendDiscoverMix(mix, {
      level: 3,
      keep: (song) =>
        song.source === "library" ? song.track.id !== 2 : song.song.videoId !== "v1",
    }).songs;
    assert.deepEqual(
      songs.map((song) => (song.source === "stream" ? song.song.videoId : song.track.id)),
      ["v0", "v2", 1, "v3", 3, "v4", "v5", 4, "v6", 5],
    );
  });

  test("saved before levels, plays its new songs alone at any level", () => {
    const { library: _library, ...older } = discoverMix(portishead, newSongs(12))!;
    assert.equal(shape(blendDiscoverMix(older, { level: 1 })), "NNNNNNNNNNNN");
  });
});

describe("A mix's Library pool", () => {
  const artists = [
    { id: 1, name: "Portishead" },
    { id: 2, name: "Massive Attack" },
    { id: 3, name: "Tricky" },
  ];
  const song = (
    id: number,
    title: string,
    artistIds: number[],
    extra: { genre?: string; addedAt?: number } = {},
  ) => ({
    id,
    title,
    artist: artistIds.map((at) => artists.find((artist) => artist.id === at)!.name).join(", "),
    artistIds,
    durationMs: 200_000,
    addedAt: extra.addedAt ?? 0,
    genre: extra.genre ?? null,
  });
  const songs = [
    song(10, "Glory Box", [1], { genre: "Trip Hop", addedAt: 1 }),
    song(11, "Roads", [1], { genre: "Trip Hop", addedAt: 5 }),
    song(12, "Sour Times", [1], { genre: "Trip Hop", addedAt: 3 }),
    song(20, "Teardrop", [2], { genre: "trip hop", addedAt: 2 }),
    song(21, "Angel", [2], { genre: "Electronic", addedAt: 4 }),
    song(30, "Overcome", [3], { addedAt: 6 }),
  ];
  const library = {
    artists,
    songs,
    plays: [
      { id: 12, countedPlays: 4 },
      { id: 21, countedPlays: 9 },
    ],
  };
  /** The radio's songs: the Library has the ones titled after its songs. */
  const radio = (titles: string[], video: string[] = []) =>
    titles.map((title, n) => ({
      videoId: `r${n}`,
      title,
      artists: ["Anyone"],
      album: null,
      durationMs: 200_000,
      artworkUrl: null,
      explicit: false,
      video: video.includes(title),
    }));
  const find = (heard: { title: string }) =>
    songs.find((candidate) => candidate.title === heard.title) ?? null;
  const ids = (pool: readonly { id: number }[]) => pool.map((entry) => entry.id);
  const tripHop = {
    kind: "artist" as const,
    id: "artist:portishead",
    name: "Portishead",
    from: "library" as const,
    genre: "Trip Hop",
  };

  test("is the Library songs its radio played, then its genre's, the most played and then the newest first", () => {
    const pool = discoverMixLibraryPool(tripHop, {
      radio: radio(["Something New", "Angel", "Glory Box", "Another New One"]),
      find,
      library,
      taken: new Set(),
      length: 25,
    });
    assert.deepEqual(ids(pool), [21, 10, 12, 11, 20]);
  });

  test("without a genre, is its seed artist's songs after its radio's", () => {
    const pool = discoverMixLibraryPool(
      { kind: "artist", id: "artist:massive attack", name: "massive attack", from: "plays" },
      { radio: radio(["Roads"]), find, library, taken: new Set(), length: 25 },
    );
    assert.deepEqual(ids(pool), [11, 21, 20]);
  });

  test("leaves out music videos, songs twice and the songs earlier mixes' pools have", () => {
    const pool = discoverMixLibraryPool(tripHop, {
      radio: radio(["Angel", "Overcome", "Angel", "Roads"], ["Overcome"]),
      find,
      library,
      taken: new Set([12]),
      length: 25,
    });
    assert.deepEqual(ids(pool), [21, 11, 20, 10]);
  });

  test("holds as many songs as level 1 takes", () => {
    const pool = discoverMixLibraryPool(tripHop, {
      radio: radio(["Angel", "Overcome"]),
      find,
      library,
      taken: new Set(),
      length: 4,
    });
    assert.deepEqual(ids(pool), [21, 30, 12]);
  });
});

describe("The mixes' level setting", () => {
  test("starts at 3 on a fresh install, and reads back what was chosen", () => {
    assert.equal(readDiscoverMixLevel(null), 3);
    assert.equal(readDiscoverMixLevel("5"), 5);
    assert.equal(readDiscoverMixLevel("1"), 1);
  });

  test("falls back to 3 for anything that isn't a level", () => {
    for (const stored of ["0", "6", "2.5", "", "high"])
      assert.equal(readDiscoverMixLevel(stored), 3);
  });

  test("offers the five levels from mostly familiar to all new", () => {
    assert.deepEqual(DISCOVER_MIX_LEVELS, [
      { level: 1, label: "Mostly familiar", share: "20% new" },
      { level: 2, label: "More familiar", share: "40% new" },
      { level: 3, label: "Balanced", share: "60% new" },
      { level: 4, label: "Mostly new", share: "80% new" },
      { level: 5, label: "All new", share: "100% new" },
    ]);
  });
});

describe("A blended mix", () => {
  const known = (id: number, artist: string) => ({ id, title: `Old ${id}`, artist });
  const mix = discoverMix(
    portishead,
    newSongs(10).map((song, n) => ({
      ...song,
      artists: [n === 0 ? "Beth Gibbons" : "Someone New"],
      artworkUrl: `https://lh3.googleusercontent.com/${n}`,
    })),
    [
      known(1, "Massive Attack feat. Tracey Thorn"),
      known(2, "Tricky"),
      ...[3, 4, 5, 6, 7, 8].map((id) => known(id, "Someone Known")),
    ],
  )!;

  test("names the first three artists it plays, the Library's among them", () => {
    assert.deepEqual(discoverMixCaption(blendDiscoverMix(mix, { level: 1 })), {
      title: "Portishead mix",
      artists: "Beth Gibbons, Massive Attack, Tricky",
      line: "10 songs",
      artworkUrl: "https://lh3.googleusercontent.com/0",
    });
  });

  test("saves as a playlist of its Library songs and its new ones, in its order", () => {
    const playlist = discoverMixPlaylist(blendDiscoverMix(mix, { level: 4 }));
    assert.equal(playlist.name, "Portishead mix");
    assert.deepEqual(
      playlist.songs
        .slice(0, 4)
        .map((entry) =>
          entry.source === "library"
            ? entry.trackId
            : entry.source === "stream"
              ? entry.song.videoId
              : null,
        ),
      ["v0", "v1", "v2", "v3"],
    );
    assert.deepEqual(
      playlist.songs.flatMap((entry) => (entry.source === "library" ? [entry.trackId] : [])),
      [1, 2],
    );
  });
});

describe("A saved mix's Library pool", () => {
  const mix = discoverMix(portishead, newSongs(10), librarySongs(3))!;

  test("reads back as it was saved, so the level re-blends it offline", () => {
    const saved = { builtAt: 1_700_000_000_000, playSeeds: true, mixes: [mix] };
    assert.deepEqual(parseDiscoverMixes(storedDiscoverMixes(saved)), saved);
  });

  test("leaves out an entry it can't read", () => {
    const stored = JSON.stringify({
      version: 2,
      builtAt: 1_700_000_000_000,
      mixes: [{ ...mix, library: [librarySong(1), { id: "2", title: "x", artist: "y" }, null] }],
    });
    assert.deepEqual(parseDiscoverMixes(stored)?.mixes[0]?.library, [librarySong(1)]);
  });
});

describe("A mix with Don't play explicit", () => {
  const marked = new Set([1, 4]);
  const fresh = newSongs(10).map((song, n) => ({ ...song, explicit: n % 3 === 0 }));
  const pool = librarySongs(8).map((song) => ({
    ...song,
    explicit: marked.has(song.id) ? ("explicit" as const) : ("clean" as const),
  }));
  const mix = discoverMix(portishead, fresh, pool)!;
  const ids = (blended: ReturnType<typeof blendDiscoverMix>) =>
    blended.songs.map((song) => (song.source === "stream" ? song.song.videoId : song.track.id));

  test("on, keeps no explicit song, new or the Library's", () => {
    const keep = discoverMixKeep({ dontPlayExplicit: true, library: null });
    const blended = blendDiscoverMix(mix, { level: 1, keep });
    assert.deepEqual(ids(blended), ["v1", 2, "v2", 3, 5, "v4", 6, "v5", 7, 8]);
  });

  test("on, fills the explicit new songs' places with clean Library songs, so the mix keeps its length", () => {
    const keep = discoverMixKeep({ dontPlayExplicit: true, library: null });
    const allExplicit = discoverMix(
      portishead,
      newSongs(12).map((song) => ({ ...song, explicit: true })),
      librarySongs(9),
    )!;
    const blended = blendDiscoverMix(allExplicit, { level: 3, keep });
    assert.equal(shape(blended), "LLLLLLLLL");
    const halfExplicit = discoverMix(
      portishead,
      newSongs(20).map((song, n) => ({ ...song, explicit: n % 2 === 0 })),
      librarySongs(16),
    )!;
    const half = blendDiscoverMix(halfExplicit, { level: 3, keep });
    assert.equal(half.songs.length, 20);
    assert.equal(half.songs.filter((song) => song.source === "stream").length, 10);
  });

  test("off, keeps every song, as the mix was", () => {
    const keep = discoverMixKeep({ dontPlayExplicit: false, library: null });
    assert.deepEqual(
      blendDiscoverMix(mix, { level: 3, keep }),
      blendDiscoverMix(mix, { level: 3 }),
    );
  });

  test("goes by the Library's flag when it's read, and leaves out songs it no longer has", () => {
    const library = new Map([
      [1, { explicit: "clean" as const }],
      [2, { explicit: "explicit" as const }],
      [3, { explicit: "unknown" as const }],
    ]);
    const keep = discoverMixKeep({ dontPlayExplicit: true, library });
    const blended = blendDiscoverMix(mix, { level: 1, keep });
    assert.deepEqual(
      blended.songs.flatMap((song) => (song.source === "library" ? [song.track.id] : [])),
      [1, 3],
    );
  });

  test("a pool keeps its songs' flags, saved and read back", () => {
    const tagged = discoverMixLibraryPool(
      { kind: "artist", id: "artist:x", name: "X", from: "plays" },
      {
        radio: [],
        find: () => null,
        library: {
          artists: [{ id: 7, name: "X" }],
          songs: [
            {
              id: 70,
              title: "A",
              artist: "X",
              artistIds: [7],
              durationMs: 1,
              addedAt: 2,
              explicit: "explicit",
            },
            { id: 71, title: "B", artist: "X", artistIds: [7], durationMs: 1, addedAt: 1 },
          ],
        },
        taken: new Set(),
        length: 25,
      },
    );
    assert.deepEqual(tagged, [
      { id: 70, title: "A", artist: "X", explicit: "explicit" },
      { id: 71, title: "B", artist: "X" },
    ]);
    const saved = { builtAt: 1, playSeeds: true, mixes: [discoverMix(portishead, fresh, tagged)!] };
    assert.deepEqual(parseDiscoverMixes(storedDiscoverMixes(saved))?.mixes[0]?.library, tagged);
  });
});

describe("A blended mix's songs as they play", () => {
  const mix = blendDiscoverMix(discoverMix(portishead, newSongs(10), librarySongs(4))!, {
    level: 3,
  });
  const tracks = new Map([1, 2, 4].map((id) => [id, { id, path: `/music/${id}.flac` }]));

  test("are the Library's tracks for its Library songs and for new songs downloaded since, the rest streamed", () => {
    const placed = placeDiscoverMixSongs(mix, {
      find: (song) => (song.videoId === "v1" ? { id: 99, path: "/music/v1.m4a" } : null),
      track: (id) => tracks.get(id) ?? null,
    });
    assert.deepEqual(
      placed.map((song) => (song.source === "stream" ? song.song.videoId : song.track.path)),
      [
        "v0",
        "/music/v1.m4a",
        "/music/1.flac",
        "v2",
        "/music/2.flac",
        "v3",
        "v4",
        "v5",
        "/music/4.flac",
      ],
    );
  });
});
