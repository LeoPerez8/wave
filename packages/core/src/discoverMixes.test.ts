import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistMixSeeds,
  blendDiscoverMix,
  discoverMix,
  discoverMixCaption,
  discoverMixReadsMore,
  discoverMixesDue,
  discoverMixesBuilt,
  parseDiscoverMixes,
  storedDiscoverMixes,
  discoverMixSongs,
  playedFinder,
  recordingKey,
} from "./index.ts";

const yt = (
  videoId: string,
  title: string,
  artists: string[],
  extra: { album?: string | null; durationMs?: number | null; video?: boolean } = {},
) => ({
  videoId,
  title,
  artists,
  album: extra.album ?? null,
  albumId: null,
  durationMs: extra.durationMs === undefined ? 200_000 : extra.durationMs,
  artworkUrl: null,
  explicit: false,
  video: extra.video ?? false,
});

const key = (
  title: string,
  albumArtist: string,
  album: string | null = null,
  trackNumber: number | null = null,
) => recordingKey({ title, album, albumArtist, discNumber: null, trackNumber });

describe("A song the owner has played", () => {
  const played = playedFinder([
    key("Glory Box", "Portishead", "Dummy", 11),
    key("Hyperballad (feat. Someone)", "Björk", "Post", 6),
    key("Starlight (Remastered 2011)", "Muse", "Black Holes and Revelations", 2),
    key("Teardrop", "Various Artists", "Mezzanine Hits", 3),
    key("Roads", "Beth Gibbons & Portishead"),
  ]);

  test("is found by its title and album artist, as the plays recorded them", () => {
    assert.equal(played(yt("a", "Glory Box", ["Portishead"])), true);
    assert.equal(played(yt("b", "glory box", ["PORTISHEAD"], { album: "Roseland NYC" })), true);
    assert.equal(played(yt("c", "Roads", ["Portishead"])), true);
  });

  test("is found despite featured credits and remaster notes", () => {
    assert.equal(played(yt("a", "Hyperballad", ["Björk"])), true);
    assert.equal(played(yt("b", "Starlight", ["Muse"])), true);
  });

  test("on a compilation, is found by its album", () => {
    assert.equal(
      played(yt("a", "Teardrop", ["Massive Attack"], { album: "Mezzanine Hits" })),
      true,
    );
    assert.equal(played(yt("b", "Teardrop", ["Massive Attack"], { album: "Mezzanine" })), false);
  });

  test("isn't a namesake by another artist, or another song by the artist", () => {
    assert.equal(played(yt("a", "Glory Box", ["Bunny Rugs"])), false);
    assert.equal(played(yt("b", "Sour Times", ["Portishead"])), false);
    assert.equal(playedFinder([])(yt("c", "Glory Box", ["Portishead"])), false);
  });
});

describe("A mix's songs", () => {
  const nothing = {
    known: () => false,
    taken: new Set<string>(),
  };
  const ids = (songs: readonly { videoId: string }[]) => songs.map((song) => song.videoId);

  test("are the radio's songs in its order, across its pages", () => {
    assert.deepEqual(
      ids(
        discoverMixSongs(
          [[yt("a", "A", ["X"]), yt("b", "B", ["X"])], [yt("c", "C", ["Y"])]],
          nothing,
        ),
      ),
      ["a", "b", "c"],
    );
  });

  test("leave out music videos and songs the owner knows", () => {
    const songs = discoverMixSongs(
      [
        [
          yt("video", "Unfinished Sympathy", ["Massive Attack"], { video: true }),
          yt("owned", "Teardrop", ["Massive Attack"]),
          yt("played", "Roads", ["Portishead"]),
          yt("new", "Angel", ["Massive Attack"]),
        ],
      ],
      {
        known: (song) => song.title === "Teardrop" || song.title === "Roads",
        taken: new Set(),
      },
    );
    assert.deepEqual(ids(songs), ["new"]);
  });

  test("leave out songs an earlier mix has, and a song the radio plays twice", () => {
    const songs = discoverMixSongs(
      [
        [
          yt("a", "Angel", ["Massive Attack"]),
          yt("b", "Karmacoma", ["Massive Attack"]),
          yt("a", "Angel", ["Massive Attack"]),
        ],
        [yt("c", "angel", ["MASSIVE ATTACK"]), yt("d", "Protection", ["Massive Attack"])],
      ],
      { ...nothing, taken: new Set(["b"]) },
    );
    assert.deepEqual(ids(songs), ["a", "d"]);
  });

  test("read a page at a time, go on from those kept, asking about each new song once", () => {
    const asked: string[] = [];
    const filter = {
      ...nothing,
      known: (song: { videoId: string }) => {
        asked.push(song.videoId);
        return false;
      },
    };
    const first = discoverMixSongs([[yt("a", "Angel", ["Massive Attack"])]], filter);
    const second = discoverMixSongs(
      [
        [
          yt("a", "Angel", ["Massive Attack"]),
          yt("c", "angel", ["MASSIVE ATTACK"]),
          yt("d", "Protection", ["Massive Attack"]),
        ],
      ],
      filter,
      first,
    );
    assert.deepEqual(ids(second), ["a", "d"]);
    assert.deepEqual(asked, ["a", "d"]);
    const full = Array.from({ length: 49 }, (_, n) => yt(`v${n}`, `Song ${n}`, ["X"]));
    const more = [yt("w", "One More", ["X"]), yt("z", "Too Many", ["X"])];
    assert.equal(discoverMixSongs([more], nothing, [...first, ...full]).length, 50);
  });

  test("are fifty at most", () => {
    const page = Array.from({ length: 60 }, (_, n) => yt(`v${n}`, `Song ${n}`, ["X"]));
    assert.equal(discoverMixSongs([page], nothing).length, 50);
  });
});

describe("A mix", () => {
  /** A mix's tile with every song new (level 5), as mixes were before levels. */
  const captionOf = (mix: Parameters<typeof blendDiscoverMix>[0]) =>
    discoverMixCaption(blendDiscoverMix(mix, { level: 5 }));
  const songs = (count: number) =>
    Array.from({ length: count }, (_, n) => ({ ...yt(`v${n}`, `Song ${n}`, ["X"]), video: false }));
  const portishead = {
    kind: "artist" as const,
    id: "artist:portishead",
    name: "Portishead",
    from: "plays" as const,
  };
  test("is named after its seed and says how many songs it has", () => {
    const mix = discoverMix(portishead, songs(12));
    assert.deepEqual(mix && { id: mix.id, caption: captionOf(mix) }, {
      id: "artist:portishead",
      caption: { title: "Portishead mix", artists: "X", line: "12 songs", artworkUrl: null },
    });
  });

  test("from a similar artist, is named after that artist", () => {
    const [seed] = artistMixSeeds(
      {
        played: [],
        library: [{ id: 1, name: "Air", songCount: 1 }],
        similar: [
          {
            of: "Air",
            artists: [
              { name: "Air", browseId: "UCair" },
              { name: "Zero 7", browseId: "UCzero7" },
            ],
          },
        ],
      },
      () => 0,
    ).filter((candidate) => candidate.from === "similar");
    const mix = seed && discoverMix(seed, songs(12));
    assert.deepEqual(mix && { id: mix.id, title: captionOf(mix).title }, {
      id: "artist:zero 7",
      title: "Zero 7 mix",
    });
  });

  test("from a genre, is named after the genre, with its seed artist first", () => {
    const foo = {
      kind: "artist" as const,
      id: "artist:foo fighters",
      name: "Foo Fighters",
      from: "library" as const,
      genre: "Rock",
    };
    const mix = discoverMix(
      foo,
      songs(12).map((song, n) => ({ ...song, artists: [n === 0 ? "Muse" : "Queen"] })),
    );
    assert.deepEqual(mix && captionOf(mix), {
      title: "Rock mix",
      artists: "Foo Fighters, Muse, Queen",
      line: "12 songs",
      artworkUrl: null,
    });
  });

  test("keeps its genre and its seed's artists", () => {
    assert.deepEqual(discoverMix({ ...portishead, genre: "Trip Hop" }, songs(10))?.seed, {
      kind: "artist",
      name: "Portishead",
      genre: "Trip Hop",
      artists: ["Portishead"],
    });
    assert.deepEqual(discoverMix(portishead, songs(10))?.seed, {
      kind: "artist",
      name: "Portishead",
      artists: ["Portishead"],
    });
  });

  test("names the first three artists it plays, each once", () => {
    const leads = ["Massive Attack", "Tricky", "massive attack", "Björk", "Moloko"];
    const mix = discoverMix(
      portishead,
      songs(12).map((song, n) => ({ ...song, artists: [leads[n] ?? "Goldfrapp", "Guest"] })),
    );
    assert.equal(mix && captionOf(mix).artists, "Massive Attack, Tricky, Björk");
  });

  test("keeps its songs without telling videos apart", () => {
    const mix = discoverMix(portishead, songs(10));
    assert.equal(mix?.songs.length, 10);
    assert.equal(mix && "video" in mix.songs[0]!, false);
  });

  test("with fewer than ten songs, isn't one", () => {
    assert.equal(discoverMix(portishead, songs(9)), null);
  });
});

describe("The saved mixes", () => {
  const angel = {
    videoId: "a",
    title: "Angel",
    artists: ["Massive Attack"],
    album: "Mezzanine",
    albumId: "MPREb_1",
    durationMs: 379_000,
    artworkUrl: "https://lh3.googleusercontent.com/x",
    explicit: false,
  };
  const saved = {
    builtAt: 1_700_000_000_000,
    playSeeds: true,
    mixes: [
      {
        id: "artist:portishead",
        seed: { kind: "artist" as const, name: "Portishead" },
        songs: [angel, { ...angel, videoId: "b", album: null, albumId: null, durationMs: null }],
      },
    ],
  };

  test("read back as they were saved", () => {
    assert.deepEqual(parseDiscoverMixes(storedDiscoverMixes(saved)), saved);
  });

  const playSeed = artistMixSeeds(
    { played: [{ id: 1, name: "Portishead", countedPlays: 3 }] },
    () => 0,
  );

  test("read back as they were saved", () => {
    assert.deepEqual(parseDiscoverMixes(storedDiscoverMixes(saved)), saved);
  });

  test("keep each mix's genre and seed artists", () => {
    const rock = {
      ...saved,
      mixes: [
        {
          ...saved.mixes[0]!,
          id: "artist:foo fighters",
          seed: {
            kind: "artist" as const,
            name: "Foo Fighters",
            genre: "Rock",
            artists: ["Foo Fighters"],
          },
        },
      ],
    };
    assert.deepEqual(parseDiscoverMixes(storedDiscoverMixes(rock)), rock);
    const garbled = JSON.stringify({
      version: 3,
      ...rock,
      mixes: [
        {
          ...rock.mixes[0],
          seed: { kind: "artist", name: "Foo Fighters", genre: 7, artists: [1] },
        },
      ],
    });
    assert.deepEqual(parseDiscoverMixes(garbled)?.mixes[0]?.seed, {
      kind: "artist",
      name: "Foo Fighters",
    });
  });

  test("saved before Artist mixes (Discover mixes' song, varied and genre seeds), are none, so the next visit builds", () => {
    const now = new Date(2026, 9, 18, 12).getTime();
    const before = JSON.stringify({ ...saved, builtAt: now });
    assert.equal(parseDiscoverMixes(before), null);
    assert.equal(discoverMixesDue(parseDiscoverMixes(before), { now, played: true }), true);
  });

  test("saved before familiar songs could stream (only Library songs familiar), are none, so the next visit builds", () => {
    const before = JSON.stringify({ version: 2, ...saved });
    assert.equal(parseDiscoverMixes(before), null);
  });

  test("a refresh with no usable mixes cannot replace the saved mixes", () => {
    assert.equal(discoverMixesBuilt([], 1_700_000_000_000, playSeed), null);
  });

  test("a usable refresh saves its mixes and starts today's interval", () => {
    const now = new Date(2026, 9, 16, 12).getTime();
    const built = discoverMixesBuilt(saved.mixes, now, playSeed);
    assert.deepEqual(built?.mixes, saved.mixes);
    assert.equal(built?.builtAt, now);
    assert.equal(discoverMixesDue(built ?? null, { now, played: true }), false);
  });

  test("are none when nothing, or nothing readable, is saved", () => {
    assert.equal(parseDiscoverMixes(null), null);
    assert.equal(parseDiscoverMixes("{"), null);
    assert.equal(parseDiscoverMixes(JSON.stringify({ version: 3, mixes: [] })), null);
  });

  test("an empty cache doesn't postpone rebuilding until tomorrow", () => {
    const now = new Date(2026, 9, 16, 12).getTime();
    const cached = parseDiscoverMixes(JSON.stringify({ version: 3, builtAt: now, mixes: [] }));
    assert.equal(discoverMixesDue(cached, { now, played: true }), true);
  });

  test("a cache whose mixes are all unreadable is rebuilt too", () => {
    const now = new Date(2026, 9, 16, 12).getTime();
    const cached = parseDiscoverMixes(
      JSON.stringify({ version: 3, builtAt: now, mixes: [{ ...saved.mixes[0], songs: [] }] }),
    );
    assert.equal(discoverMixesDue(cached, { now, played: true }), true);
  });

  test("leave out a song or a mix that can't be read", () => {
    const stored = JSON.stringify({
      version: 3,
      builtAt: 5,
      playSeeds: true,
      mixes: [
        { ...saved.mixes[0], songs: [angel, { ...angel, videoId: 7 }, { title: "x" }] },
        { id: "song:3", seed: { kind: "album", name: "x" }, songs: [angel] },
        { id: "song:4", seed: { kind: "song", name: "Roads" }, songs: [] },
        "mix",
      ],
    });
    assert.deepEqual(parseDiscoverMixes(stored), {
      builtAt: 5,
      playSeeds: true,
      mixes: [{ ...saved.mixes[0], songs: [angel] }],
    });
  });
});

describe("The mixes are built again", () => {
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();
  const fromPlays = (builtAt: number) => ({ builtAt, playSeeds: true });
  const fromLibrary = (builtAt: number) => ({ builtAt, playSeeds: false });

  test("when none were built", () => {
    assert.equal(discoverMixesDue(null, { now: at(16, 9), played: false }), true);
  });

  test("once a day: not on the day they were built, but from the next", () => {
    const due = (builtAt: number, now: number) =>
      discoverMixesDue(fromPlays(builtAt), { now, played: true });
    assert.equal(due(at(16, 0), at(16, 23)), false);
    assert.equal(due(at(16, 23), at(17, 0)), true);
    assert.equal(due(at(10, 12), at(16, 12)), true);
  });

  test("when they were built later than now (the clock went back)", () => {
    assert.equal(discoverMixesDue(fromPlays(at(17, 9)), { now: at(16, 9), played: true }), true);
  });

  test("once counted plays arrive, when the last build had no seeds from plays", () => {
    const now = at(16, 10);
    assert.equal(discoverMixesDue(fromLibrary(at(16, 9)), { now, played: false }), false);
    assert.equal(discoverMixesDue(fromLibrary(at(16, 9)), { now, played: true }), true);
    assert.equal(discoverMixesDue(fromPlays(at(16, 9)), { now, played: true }), false);
  });

  test("a build seeded from the Library alone had no seeds from plays", () => {
    const now = at(16, 9);
    const mixes = [{ id: "artist:air", seed: { kind: "artist" as const, name: "Air" }, songs: [] }];
    const fromTheLibrary = artistMixSeeds(
      { played: [], library: [{ id: 1, name: "Air", songCount: 9 }] },
      () => 0,
    );
    const built = discoverMixesBuilt(mixes, now, fromTheLibrary);
    assert.equal(built?.playSeeds, false);
    assert.equal(discoverMixesDue(built ?? null, { now: at(16, 10), played: true }), true);
  });
});

describe("Reading a seed's radio", () => {
  test("goes on while the mix has fewer than 25 songs and the radio has more", () => {
    assert.equal(discoverMixReadsMore({ pages: 1, kept: 24, more: true }), true);
    assert.equal(discoverMixReadsMore({ pages: 1, kept: 25, more: true }), false);
    assert.equal(discoverMixReadsMore({ pages: 1, kept: 3, more: false }), false);
  });

  test("stops after three pages", () => {
    assert.equal(discoverMixReadsMore({ pages: 2, kept: 3, more: true }), true);
    assert.equal(discoverMixReadsMore({ pages: 3, kept: 3, more: true }), false);
  });
});
