import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  DISCOVER_MIX_LEVELS,
  blendDiscoverMix,
  discoverMix,
  discoverMixCaption,
  discoverMixKeep,
  discoverMixFamiliarPool,
  discoverMixPlaylist,
  parseDiscoverMixes,
  placeDiscoverMixSongs,
  storedDiscoverMixes,
  readDiscoverMixLevel,
  discoverLevelLabel,
  magicQueueShare,
  mixKnownSongs,
  type DiscoverMixSong,
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
/** [tracks] as a mix's familiar share: Library songs. */
const familiar = <T>(tracks: readonly T[]) =>
  tracks.map((track) => ({ source: "library" as const, track }));

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
    const mix = discoverMix(portishead, newSongs(25), familiar(librarySongs(20)))!;
    const blended = blendDiscoverMix(mix, { level: 3 });
    assert.equal(shape(blended), "NNLNLNNLNLNNLNLNNLNLNNLNL");
  });

  test("sets each level's share of new songs, the rest from the Library", () => {
    const mix = discoverMix(portishead, newSongs(25), familiar(librarySongs(25)))!;
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
    const mix = discoverMix(portishead, newSongs(10), familiar(librarySongs(10)))!;
    assert.equal(shape(blendDiscoverMix(mix, { level: 1 })), "NLLLLNLLLL");
  });

  test("at 5, plays only new songs, in the radio's order", () => {
    const mix = discoverMix(portishead, newSongs(12), familiar(librarySongs(12)))!;
    const songs = blendDiscoverMix(mix, { level: 5 }).songs;
    assert.deepEqual(
      songs.map((song) => (song.source === "stream" ? song.song.videoId : song.track.id)),
      ["v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10", "v11"],
    );
  });

  test("takes its new songs in the radio's order and its Library songs in the pool's", () => {
    const mix = discoverMix(
      portishead,
      newSongs(10),
      familiar([librarySong(7), librarySong(3), librarySong(9), librarySong(1), librarySong(5)]),
    )!;
    const songs = blendDiscoverMix(mix, { level: 3 }).songs;
    assert.deepEqual(
      songs.map((song) => (song.source === "stream" ? song.song.videoId : song.track.id)),
      ["v0", "v1", 7, "v2", 3, "v3", "v4", 9, "v5", 1],
    );
  });

  test("with too few Library songs, fills the familiar share with new songs and keeps its length", () => {
    const mix = discoverMix(portishead, newSongs(25), familiar(librarySongs(4)))!;
    const songs = blendDiscoverMix(mix, { level: 1 }).songs;
    assert.equal(songs.length, 25);
    assert.equal(songs.filter((song) => song.source === "library").length, 4);
  });

  test("leaves out the songs [keep] refuses, the pools' next songs taking their places", () => {
    const mix = discoverMix(portishead, newSongs(10), familiar(librarySongs(6)))!;
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
    const { familiar: _familiar, ...older } = discoverMix(portishead, newSongs(12))!;
    assert.equal(shape(blendDiscoverMix(older, { level: 1 })), "NNNNNNNNNNNN");
  });
});

describe("A mix's familiar share", () => {
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
  const yt = (videoId: string, title: string, artist: string, video = false) => ({
    videoId,
    title,
    artists: [artist],
    album: null,
    albumId: null,
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
    video,
  });
  /** The radio's songs, [title, artist] each. */
  const radio = (heard: [string, string][], videos: string[] = []) =>
    heard.map(([title, artist], n) => yt(`r${n}`, title, artist, videos.includes(title)));
  type Yt = ReturnType<typeof yt>;
  /** What the owner knows: the Library above, the songs [streamed] and those [playlisted]. */
  const knownWith = (
    streamed: { song: Yt; plays: number; firstPlayedAt: number }[] = [],
    playlisted: { song: { source: "stream"; song: Yt }; addedAt: number }[] = [],
  ) => mixKnownSongs({ library: songs, playedRecordingKeys: [], streamed, playlisted });
  const ids = (pool: readonly DiscoverMixSong[]) =>
    pool.map((entry) => (entry.source === "library" ? entry.track.id : entry.song.videoId));
  const none = { tracks: new Set<number>(), videos: new Set<string>() };
  const tripHop = {
    kind: "artist" as const,
    id: "artist:portishead",
    name: "Portishead",
    from: "library" as const,
    genre: "Trip Hop",
  };

  test("is the familiar songs its radio played, then its genre's Library songs, then its seed artists' non-D songs", () => {
    const known = knownWith(
      [
        { song: yt("streamed", "Wandering Star", "Portishead"), plays: 1, firstPlayedAt: 9 },
        { song: yt("loved", "Mysterons", "Portishead"), plays: 7, firstPlayedAt: 1 },
        { song: yt("heard", "Karmacoma", "Massive Attack"), plays: 3, firstPlayedAt: 1 },
        { song: yt("elsewhere", "Pumpkin", "Tricky"), plays: 9, firstPlayedAt: 1 },
      ],
      [{ song: { source: "stream", song: yt("listed", "Numb", "Portishead") }, addedAt: 20 }],
    );
    const pool = discoverMixFamiliarPool(tripHop, {
      radio: radio([
        ["Something New", "Someone"],
        ["Angel", "Massive Attack"],
        ["Karmacoma", "Massive Attack"],
        ["Glory Box", "Portishead"],
        ["Another New One", "Someone"],
      ]),
      known,
      library,
      taken: none,
      length: 25,
    });
    assert.deepEqual(ids(pool), [21, "r2", 10, 12, 11, 20, "loved", "streamed", "listed"]);
  });

  test("streams a familiar song the radio played as the radio has it", () => {
    const known = knownWith([
      { song: yt("heard", "Karmacoma", "Massive Attack"), plays: 3, firstPlayedAt: 1 },
    ]);
    const pool = discoverMixFamiliarPool(tripHop, {
      radio: radio([["Karmacoma", "Massive Attack"]]),
      known,
      library: { artists, songs: [] },
      taken: none,
      length: 25,
    });
    assert.deepEqual(pool, [
      {
        source: "stream",
        song: {
          videoId: "r0",
          title: "Karmacoma",
          artists: ["Massive Attack"],
          album: null,
          albumId: null,
          durationMs: 200_000,
          artworkUrl: null,
          explicit: false,
        },
      },
    ]);
  });

  test("without a genre, is its seed artist's songs after its radio's", () => {
    const pool = discoverMixFamiliarPool(
      { kind: "artist", id: "artist:massive attack", name: "massive attack", from: "plays" },
      {
        radio: radio([["Roads", "Portishead"]]),
        known: knownWith(),
        library,
        taken: none,
        length: 25,
      },
    );
    assert.deepEqual(ids(pool), [11, 21, 20]);
  });

  test("grown from several artists, takes each one's non-D songs", () => {
    const known = knownWith([
      { song: yt("a", "Karmacoma", "Massive Attack"), plays: 3, firstPlayedAt: 1 },
      { song: yt("b", "Pumpkin", "Tricky"), plays: 5, firstPlayedAt: 1 },
      { song: yt("c", "Elsewhere", "Goldfrapp"), plays: 9, firstPlayedAt: 1 },
    ]);
    const pool = discoverMixFamiliarPool(
      {
        ...tripHop,
        genre: "Nothing Here",
        artists: [
          { id: 2, name: "Massive Attack" },
          { id: 3, name: "Tricky" },
        ],
      },
      { radio: [], known, library, taken: none, length: 25 },
    );
    assert.deepEqual(ids(pool), ["b", "a"]);
  });

  test("leaves out music videos, unknown songs, songs twice and the songs earlier mixes' shares have", () => {
    const known = knownWith([
      { song: yt("taken", "Mysterons", "Portishead"), plays: 3, firstPlayedAt: 1 },
    ]);
    const pool = discoverMixFamiliarPool(tripHop, {
      radio: radio(
        [
          ["Angel", "Massive Attack"],
          ["Overcome", "Tricky"],
          ["Angel", "Massive Attack"],
          ["Roads", "Portishead"],
          ["Brand New", "Someone"],
        ],
        ["Overcome"],
      ),
      known,
      library,
      taken: { tracks: new Set([12]), videos: new Set(["taken"]) },
      length: 25,
    });
    assert.deepEqual(ids(pool), [21, 11, 20, 10]);
  });

  test("at 20% new, fills a small Library's mix with played and playlisted songs before new ones", () => {
    const known = knownWith(
      [3, 4, 5].map((n) => ({
        song: yt(`s${n}`, `Streamed ${n}`, "Tricky"),
        plays: n,
        firstPlayedAt: 1,
      })),
      [6, 7, 8].map((n) => ({
        song: { source: "stream" as const, song: yt(`p${n}`, `Listed ${n}`, "Tricky") },
        addedAt: n,
      })),
    );
    const tricky = {
      kind: "artist" as const,
      id: "artist:tricky",
      name: "Tricky",
      from: "plays" as const,
    };
    const share = discoverMixFamiliarPool(tricky, {
      radio: [],
      known,
      library,
      taken: none,
      length: 12,
    });
    const blended = blendDiscoverMix(discoverMix(tricky, newSongs(12), share)!, { level: 1 });
    assert.deepEqual(
      blended.songs.map((entry) =>
        entry.source === "library" ? "L" : entry.familiar === true ? "F" : "N",
      ),
      ["N", "L", "N", "F", "N", "F", "F", "N", "F", "N", "F", "F"],
    );
  });

  test("keeps each song's artwork file, for the tile's cover", () => {
    const covered = (row: (typeof songs)[number]) => ({
      ...row,
      artworkPath: row.id === 21 ? "/art/mezzanine.jpg" : null,
    });
    const pool = discoverMixFamiliarPool(tripHop, {
      radio: radio([
        ["Angel", "Massive Attack"],
        ["Glory Box", "Portishead"],
      ]),
      known: mixKnownSongs({
        library: songs.map(covered),
        playedRecordingKeys: [],
        streamed: [],
        playlisted: [],
      }),
      library: { ...library, songs: songs.map(covered) },
      taken: none,
      length: 25,
    });
    assert.deepEqual(
      pool
        .slice(0, 2)
        .map((entry) => (entry.source === "library" ? entry.track.artworkPath : null)),
      ["/art/mezzanine.jpg", undefined],
    );
    const saved = {
      builtAt: 1,
      playSeeds: true,
      mixes: [discoverMix(tripHop, newSongs(10), pool)!],
    };
    assert.deepEqual(parseDiscoverMixes(storedDiscoverMixes(saved))?.mixes[0]?.familiar, pool);
  });

  test("holds as many songs as level 1 takes", () => {
    const pool = discoverMixFamiliarPool(tripHop, {
      radio: radio([
        ["Angel", "Massive Attack"],
        ["Overcome", "Tricky"],
      ]),
      known: knownWith(),
      library,
      taken: none,
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

describe("Discover's new-music scale", () => {
  test("names each step with its share, one scale for the Magic Queue and the mixes", () => {
    assert.deepEqual(
      ([1, 2, 3, 4, 5] as const).map((level) => [
        discoverLevelLabel(level),
        magicQueueShare(level),
      ]),
      [
        ["Mostly familiar · 20% new", 0.2],
        ["More familiar · 40% new", 0.4],
        ["Balanced · 60% new", 0.6],
        ["Mostly new · 80% new", 0.8],
        ["All new · 100% new", 1],
      ],
    );
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
    familiar([
      known(1, "Massive Attack feat. Tracey Thorn"),
      known(2, "Tricky"),
      ...[3, 4, 5, 6, 7, 8].map((id) => known(id, "Someone Known")),
    ]),
  )!;

  test("names the first three artists it plays, the Library's among them", () => {
    assert.deepEqual(discoverMixCaption(blendDiscoverMix(mix, { level: 1 })), {
      title: "Portishead mix",
      artists: "Beth Gibbons, Massive Attack, Tricky",
      line: "10 songs",
      artworkUrl: "https://lh3.googleusercontent.com/0",
    });
  });

  test("follows the level: mostly familiar, it takes its first Library song's cover; mostly new, its first new song's", () => {
    const covered = discoverMix(
      portishead,
      newSongs(10).map((song, n) => ({
        ...song,
        artworkUrl: `https://lh3.googleusercontent.com/${n}`,
      })),
      familiar([
        { ...known(1, "Massive Attack"), artworkPath: "/art/blue-lines.jpg" },
        { ...known(2, "Tricky"), artworkPath: "/art/maxinquaye.jpg" },
        ...[3, 4, 5, 6, 7, 8].map((id) => known(id, "Someone Known")),
      ]),
    )!;
    const coverAt = (level: 1 | 2 | 3 | 4 | 5) =>
      discoverMixCaption(blendDiscoverMix(covered, { level })).artworkUrl;
    assert.deepEqual(
      [1, 2, 3, 4, 5].map((level) => coverAt(level as 1)),
      [
        "file:///art/blue-lines.jpg",
        "file:///art/blue-lines.jpg",
        "https://lh3.googleusercontent.com/0",
        "https://lh3.googleusercontent.com/0",
        "https://lh3.googleusercontent.com/0",
      ],
    );
  });

  test("mostly familiar, takes the first Library song with a cover, else its first new song's", () => {
    const later = discoverMix(
      portishead,
      newSongs(10).map((song) => ({ ...song, artworkUrl: "https://lh3.googleusercontent.com/n" })),
      familiar([
        known(1, "Massive Attack"),
        { ...known(2, "Tricky"), artworkPath: "/art/maxinquaye.jpg" },
        ...[3, 4, 5, 6, 7, 8].map((id) => known(id, "X")),
      ]),
    )!;
    assert.equal(
      discoverMixCaption(blendDiscoverMix(later, { level: 1 })).artworkUrl,
      "file:///art/maxinquaye.jpg",
    );
    assert.equal(
      discoverMixCaption(blendDiscoverMix(mix, { level: 1 })).artworkUrl,
      "https://lh3.googleusercontent.com/0",
    );
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
  const mix = discoverMix(portishead, newSongs(10), familiar(librarySongs(3)))!;

  test("reads back as it was saved, so the level re-blends it offline", () => {
    const saved = { builtAt: 1_700_000_000_000, playSeeds: true, mixes: [mix] };
    assert.deepEqual(parseDiscoverMixes(storedDiscoverMixes(saved)), saved);
  });

  test("leaves out an entry it can't read", () => {
    const stored = JSON.stringify({
      version: 3,
      builtAt: 1_700_000_000_000,
      mixes: [
        {
          ...mix,
          familiar: [
            { source: "library", track: librarySong(1) },
            { source: "library", track: { id: "2", title: "x", artist: "y" } },
            { source: "stream", song: { videoId: "" } },
            null,
          ],
        },
      ],
    });
    assert.deepEqual(parseDiscoverMixes(stored)?.mixes[0]?.familiar, familiar([librarySong(1)]));
  });
});

describe("A mix with Don't play explicit", () => {
  const marked = new Set([1, 4]);
  const fresh = newSongs(10).map((song, n) => ({ ...song, explicit: n % 3 === 0 }));
  const pool = librarySongs(8).map((song) => ({
    ...song,
    explicit: marked.has(song.id) ? ("explicit" as const) : ("clean" as const),
  }));
  const mix = discoverMix(portishead, fresh, familiar(pool))!;
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
      familiar(librarySongs(9)),
    )!;
    const blended = blendDiscoverMix(allExplicit, { level: 3, keep });
    assert.equal(shape(blended), "LLLLLLLLL");
    const halfExplicit = discoverMix(
      portishead,
      newSongs(20).map((song, n) => ({ ...song, explicit: n % 2 === 0 })),
      familiar(librarySongs(16)),
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

  const streamedX = (videoId: string, title: string, explicit: boolean) => ({
    videoId,
    title,
    artists: ["X"],
    album: null,
    albumId: null,
    durationMs: 1,
    artworkUrl: null,
    explicit,
  });
  const tagged = discoverMixFamiliarPool(
    { kind: "artist", id: "artist:x", name: "X", from: "plays" },
    {
      radio: [],
      known: mixKnownSongs({
        library: [],
        playedRecordingKeys: [],
        streamed: [
          { song: streamedX("rude", "C", true), plays: 2, firstPlayedAt: 1 },
          { song: streamedX("polite", "D", false), plays: 1, firstPlayedAt: 1 },
        ],
        playlisted: [],
      }),
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
      taken: { tracks: new Set(), videos: new Set() },
      length: 25,
    },
  );

  test("a familiar share keeps its songs' flags, saved and read back", () => {
    assert.deepEqual(tagged, [
      { source: "library", track: { id: 70, title: "A", artist: "X", explicit: "explicit" } },
      { source: "library", track: { id: 71, title: "B", artist: "X" } },
      { source: "stream", song: streamedX("rude", "C", true) },
      { source: "stream", song: streamedX("polite", "D", false) },
    ]);
    const saved = { builtAt: 1, playSeeds: true, mixes: [discoverMix(portishead, fresh, tagged)!] };
    assert.deepEqual(parseDiscoverMixes(storedDiscoverMixes(saved))?.mixes[0]?.familiar, tagged);
  });

  test("on, leaves out explicit familiar songs, the Library's and those that stream", () => {
    const keep = discoverMixKeep({ dontPlayExplicit: true, library: null });
    const blended = blendDiscoverMix(discoverMix(portishead, newSongs(10), tagged)!, {
      level: 1,
      keep,
    });
    assert.deepEqual(
      ids(blended).filter((id) => id === 70 || id === 71 || id === "rude" || id === "polite"),
      [71, "polite"],
    );
  });
});

describe("A mix with familiar songs that stream", () => {
  const streamed = (n: number) => ({ ...radioSong(100 + n), title: `Heard ${n}` });
  const share = [
    { source: "library" as const, track: librarySong(1) },
    { source: "stream" as const, song: streamed(1) },
    { source: "library" as const, track: librarySong(2) },
    { source: "stream" as const, song: streamed(2) },
  ];
  const mix = discoverMix(
    portishead,
    newSongs(10).map((song) => ({ ...song, artworkUrl: `https://lh3/${song.videoId}` })),
    share,
  )!;
  const ids = (blended: ReturnType<typeof blendDiscoverMix>) =>
    blended.songs.map((song) => (song.source === "stream" ? song.song.videoId : song.track.id));

  test("plays them in its familiar share, in the share's order, marked familiar", () => {
    const blended = blendDiscoverMix(mix, { level: 3 });
    assert.deepEqual(ids(blended), ["v0", "v1", 1, "v2", "v101", "v3", "v4", 2, "v5", "v102"]);
    assert.deepEqual(
      blended.songs.flatMap((song) =>
        song.source === "stream" && song.familiar === true ? [song.song.videoId] : [],
      ),
      ["v101", "v102"],
    );
  });

  test("counts them as familiar for its tile: mostly familiar, the first familiar song's cover", () => {
    const covers = discoverMix(
      portishead,
      newSongs(10).map((song) => ({ ...song, artworkUrl: `https://lh3/${song.videoId}` })),
      [
        { source: "stream", song: { ...streamed(9), artworkUrl: "https://lh3/heard" } },
        ...share,
        ...familiar([11, 12, 13, 14].map(librarySong)),
      ],
    )!;
    assert.equal(
      discoverMixCaption(blendDiscoverMix(covers, { level: 1 })).artworkUrl,
      "https://lh3/heard",
    );
    assert.equal(
      discoverMixCaption(blendDiscoverMix(covers, { level: 4 })).artworkUrl,
      "https://lh3/v0",
    );
  });

  test("leaves out new songs the owner played or added to a playlist since the build, keeping its familiar ones", () => {
    const keep = discoverMixKeep({
      dontPlayExplicit: false,
      library: null,
      knownVideos: new Set(["v0", "v3", "v101"]),
    });
    const blended = blendDiscoverMix(mix, { level: 3, keep });
    assert.equal(blended.songs.length, 10);
    assert.deepEqual(ids(blended), ["v1", "v2", 1, "v4", "v101", "v5", "v6", 2, "v7", "v102"]);
  });
});

describe("A blended mix's songs as they play", () => {
  const mix = blendDiscoverMix(discoverMix(portishead, newSongs(10), familiar(librarySongs(4)))!, {
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
