import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  discoverMix,
  discoverMixCaption,
  discoverMixReadsMore,
  discoverMixesDue,
  discoverMixesBuilt,
  parseDiscoverMixes,
  storedDiscoverMixes,
  discoverMixSeeds,
  discoverMixSongs,
  discoverSeedQuery,
  discoverSeedVideo,
  playedFinder,
  recordingKey,
} from "./index.ts";

const seedArtist = (id: number, name: string) => ({ id, name });
const seedSong = (id: number, title: string, artist: string, artistIds: number[] = []) => ({
  id,
  title,
  artist,
  artistIds,
  durationMs: 200_000,
});

/** The seeds from plays alone, with nothing in the Library to fill from. */
const playSeeds = (played: Parameters<typeof discoverMixSeeds>[0]["played"]) =>
  discoverMixSeeds({ played });

const seedNames = (seeds: ReturnType<typeof discoverMixSeeds>) =>
  seeds.map((seed) => `${seed.kind}: ${seed.name}`);

describe("Discover mixes' seeds", () => {
  test("are the three most played artists and the three most played songs, taking turns", () => {
    const seeds = playSeeds({
      artists: [
        seedArtist(1, "Massive Attack"),
        seedArtist(2, "Portishead"),
        seedArtist(3, "Björk"),
        seedArtist(4, "Tricky"),
      ],
      songs: [
        seedSong(10, "Glory Box", "Portishead", [2]),
        seedSong(11, "Hyperballad", "Björk", [3]),
        seedSong(12, "Windowlicker", "Aphex Twin", [5]),
        seedSong(13, "Midnight City", "M83", [6]),
        seedSong(14, "Teardrop", "Massive Attack", [1]),
        seedSong(15, "Kids", "MGMT", [7]),
        seedSong(16, "Breathe", "Telepopmusik", [8]),
      ],
    });
    assert.deepEqual(seedNames(seeds), [
      "artist: Massive Attack",
      "song: Windowlicker",
      "artist: Portishead",
      "song: Midnight City",
      "artist: Björk",
      "song: Kids",
    ]);
  });

  test("with too few songs, more artists make up the six, and the other way round", () => {
    assert.deepEqual(
      seedNames(
        playSeeds({
          artists: [
            seedArtist(1, "Air"),
            seedArtist(2, "Moby"),
            seedArtist(3, "Daft Punk"),
            seedArtist(4, "Justice"),
            seedArtist(5, "Phoenix"),
            seedArtist(6, "Cassius"),
          ],
          songs: [seedSong(10, "Sing It Back", "Moloko", [9])],
        }),
      ),
      [
        "artist: Air",
        "song: Sing It Back",
        "artist: Moby",
        "artist: Daft Punk",
        "artist: Justice",
        "artist: Phoenix",
      ],
    );
    assert.deepEqual(
      seedNames(
        playSeeds({
          artists: [seedArtist(1, "Air")],
          songs: [
            seedSong(10, "Sexy Boy", "Air", [1]),
            seedSong(11, "Porcelain", "Moby", [2]),
            seedSong(12, "One More Time", "Daft Punk", [3]),
            seedSong(13, "D.A.N.C.E.", "Justice", [4]),
            seedSong(14, "1901", "Phoenix", [5]),
            seedSong(15, "Feeling for You", "Cassius", [6]),
            seedSong(16, "Around the World", "Daft Punk", [3]),
          ],
        }),
      ),
      [
        "artist: Air",
        "song: Porcelain",
        "song: One More Time",
        "song: D.A.N.C.E.",
        "song: 1901",
        "song: Feeling for You",
      ],
    );
  });

  test("are still six when an artist added for want of songs takes one of the songs", () => {
    assert.deepEqual(
      seedNames(
        playSeeds({
          artists: [
            seedArtist(1, "Air"),
            seedArtist(2, "Moby"),
            seedArtist(3, "Daft Punk"),
            seedArtist(4, "Justice"),
            seedArtist(5, "Phoenix"),
            seedArtist(6, "Cassius"),
          ],
          songs: [seedSong(10, "D.A.N.C.E.", "Justice", [4]), seedSong(11, "1901", "Phoenix", [5])],
        }),
      ),
      [
        "artist: Air",
        "artist: Moby",
        "artist: Daft Punk",
        "artist: Justice",
        "artist: Phoenix",
        "artist: Cassius",
      ],
    );
  });

  test("short of six either way, are as many as fewer artists make", () => {
    assert.deepEqual(
      seedNames(
        playSeeds({
          artists: [
            seedArtist(1, "Air"),
            seedArtist(2, "Moby"),
            seedArtist(3, "Daft Punk"),
            seedArtist(4, "Justice"),
          ],
          songs: [
            seedSong(10, "D.A.N.C.E.", "Justice", [4]),
            seedSong(11, "Genesis", "Justice", [4]),
          ],
        }),
      ),
      ["artist: Air", "song: D.A.N.C.E.", "artist: Moby", "song: Genesis", "artist: Daft Punk"],
    );
  });

  test("leave out names that aren't an artist's, and each song seeds one mix", () => {
    assert.deepEqual(
      seedNames(
        playSeeds({
          artists: [
            seedArtist(1, "Various Artists"),
            seedArtist(2, "Unknown Artist"),
            seedArtist(3, "Air"),
          ],
          songs: [
            seedSong(10, "Porcelain", "Moby", [4]),
            seedSong(11, "porcelain", "MOBY", [4]),
            seedSong(12, "Sing It Back", "Moloko", [5]),
          ],
        }),
      ),
      ["artist: Air", "song: Porcelain", "song: Sing It Back"],
    );
  });

  test("are none with nothing played", () => {
    assert.deepEqual(discoverMixSeeds({ played: { artists: [], songs: [] } }), []);
  });
});

describe("Discover mixes' seeds from the Library", () => {
  const nothingPlayed = { artists: [], songs: [] };
  const libraryArtist = (id: number, name: string, songCount: number) => ({ id, name, songCount });
  const librarySong = (
    id: number,
    title: string,
    artist: string,
    artistIds: number[],
    addedAt: number,
  ) => ({ ...seedSong(id, title, artist, artistIds), addedAt });

  test("with nothing played, are its artists with the most songs and its newest songs", () => {
    const seeds = discoverMixSeeds({
      played: nothingPlayed,
      library: {
        artists: [
          libraryArtist(1, "Air", 4),
          libraryArtist(2, "Moby", 30),
          libraryArtist(3, "Daft Punk", 12),
          libraryArtist(4, "Justice", 20),
          libraryArtist(5, "Phoenix", 2),
          libraryArtist(6, "Cassius", 1),
        ],
        songs: [
          librarySong(10, "Sexy Boy", "Air", [1], 100),
          librarySong(11, "Porcelain", "Moby", [2], 900),
          librarySong(12, "1901", "Phoenix", [5], 300),
          librarySong(13, "Feeling for You", "Cassius", [6], 500),
          librarySong(14, "One More Time", "Daft Punk", [3], 800),
          librarySong(15, "Kelly Watch the Stars", "Air", [1], 400),
        ],
      },
    });
    assert.deepEqual(seedNames(seeds), [
      "artist: Moby",
      "song: Feeling for You",
      "artist: Justice",
      "song: Kelly Watch the Stars",
      "artist: Daft Punk",
      "song: 1901",
    ]);
  });

  test("with every song by its few artists, are fewer artists and more songs", () => {
    const seeds = discoverMixSeeds({
      played: nothingPlayed,
      library: {
        artists: [libraryArtist(1, "Air", 60), libraryArtist(2, "Moby", 44)],
        songs: [
          librarySong(10, "Sexy Boy", "Air", [1], 700),
          librarySong(11, "Porcelain", "Moby", [2], 600),
          librarySong(12, "Natural Blues", "Moby", [2], 500),
          librarySong(13, "Why Does My Heart Feel So Bad?", "Moby", [2], 400),
          librarySong(14, "Extreme Ways", "Moby", [2], 300),
          librarySong(15, "Lift Me Up", "Moby", [2], 200),
          librarySong(16, "In This World", "Moby", [2], 100),
        ],
      },
    });
    assert.deepEqual(seedNames(seeds), [
      "artist: Air",
      "song: Porcelain",
      "song: Natural Blues",
      "song: Why Does My Heart Feel So Bad?",
      "song: Extreme Ways",
      "song: Lift Me Up",
    ]);
  });

  test("with some plays, fill in after the seeds plays make, under the same rules", () => {
    const seeds = discoverMixSeeds({
      played: {
        artists: [seedArtist(1, "Air")],
        songs: [
          seedSong(10, "Sexy Boy", "Air", [1]),
          seedSong(20, "Porcelain", "Moby feat. Daft Punk", [2, 3]),
        ],
      },
      library: {
        artists: [
          libraryArtist(1, "Air", 50),
          libraryArtist(2, "Moby", 40),
          libraryArtist(3, "Daft Punk", 30),
          libraryArtist(4, "Various Artists", 25),
          libraryArtist(5, "Justice", 20),
          libraryArtist(6, "Phoenix", 10),
        ],
        songs: [
          librarySong(20, "Porcelain", "Moby feat. Daft Punk", [2, 3], 900),
          librarySong(21, "Talisman", "Air", [1], 800),
          librarySong(22, "Genesis", "Justice", [5], 700),
          librarySong(23, "1901", "Phoenix", [6], 600),
          librarySong(24, "Feeling for You", "Cassius", [7], 500),
          librarySong(25, "Sing It Back", "Moloko", [8], 400),
        ],
      },
    });
    assert.deepEqual(
      seeds.map((seed) => `${seed.from} ${seed.kind}: ${seed.name}`),
      [
        "plays artist: Air",
        "plays song: Porcelain",
        "library artist: Justice",
        "library song: Feeling for You",
        "library artist: Phoenix",
        "library song: Sing It Back",
      ],
    );
  });

  test("with plays enough for six, are the plays' seeds alone", () => {
    const played = {
      artists: [seedArtist(1, "Air"), seedArtist(2, "Moby"), seedArtist(3, "Daft Punk")],
      songs: [
        seedSong(10, "D.A.N.C.E.", "Justice", [4]),
        seedSong(11, "1901", "Phoenix", [5]),
        seedSong(12, "Feeling for You", "Cassius", [6]),
      ],
    };
    const seeds = discoverMixSeeds({
      played,
      library: {
        artists: [libraryArtist(7, "Moloko", 99)],
        songs: [librarySong(30, "Sing It Back", "Moloko", [7], 900)],
      },
    });
    assert.deepEqual(seeds, discoverMixSeeds({ played }));
    assert.ok(seeds.every((seed) => seed.from === "plays"));
    assert.equal(seeds.length, 6);
  });
});

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

describe("A song seed's radio", () => {
  const gloryBox = seedSong(10, "Glory Box", "Portishead", [2]);

  test("is searched for by title and artist", () => {
    assert.equal(discoverSeedQuery(gloryBox), "Glory Box Portishead");
  });

  test("starts from the first search result that is the song", () => {
    assert.equal(
      discoverSeedVideo(gloryBox, [
        yt("a", "Glory Box (Live)", ["Portishead"]),
        yt("b", "Glory Box", ["Bunny Rugs"]),
        yt("c", "Glory Box", ["Portishead"], { durationMs: 301_000 }),
        yt("d", "Glory Box", ["Portishead"]),
        yt("e", "Glory Box", ["Portishead"]),
      ]),
      "d",
    );
  });

  test("has nothing to start from when no result is the song", () => {
    assert.equal(discoverSeedVideo(gloryBox, [yt("a", "Roads", ["Portishead"])]), null);
  });
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
    inLibrary: () => false,
    played: () => false,
    taken: new Set<string>(),
    seedVideo: null,
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

  test("leave out the seed, music videos, Library songs and songs played", () => {
    const songs = discoverMixSongs(
      [
        [
          yt("seed", "Glory Box", ["Portishead"]),
          yt("video", "Unfinished Sympathy", ["Massive Attack"], { video: true }),
          yt("owned", "Teardrop", ["Massive Attack"]),
          yt("played", "Roads", ["Portishead"]),
          yt("new", "Angel", ["Massive Attack"]),
        ],
      ],
      {
        inLibrary: (song) => song.title === "Teardrop",
        played: (song) => song.title === "Roads",
        taken: new Set(),
        seedVideo: "seed",
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
      inLibrary: (song: { videoId: string }) => {
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
  const songs = (count: number) =>
    Array.from({ length: count }, (_, n) => ({ ...yt(`v${n}`, `Song ${n}`, ["X"]), video: false }));
  const portishead = {
    kind: "artist" as const,
    id: "artist:portishead",
    name: "Portishead",
    from: "plays" as const,
  };
  const gloryBox = {
    kind: "song" as const,
    id: "song:10",
    name: "Glory Box",
    from: "plays" as const,
    song: seedSong(10, "Glory Box", "Portishead", [2]),
  };

  test("is named after its seed and says how many songs it has", () => {
    const mix = discoverMix(portishead, songs(12));
    assert.deepEqual(mix && { id: mix.id, caption: discoverMixCaption(mix) }, {
      id: "artist:portishead",
      caption: { title: "Portishead mix", artists: "X", line: "12 songs" },
    });
    const songMix = discoverMix(gloryBox, songs(30));
    assert.deepEqual(songMix && discoverMixCaption(songMix), {
      title: "Glory Box mix",
      artists: "X",
      line: "30 songs",
    });
  });

  test("names the first three artists it plays, each once", () => {
    const leads = ["Massive Attack", "Tricky", "massive attack", "Björk", "Moloko"];
    const mix = discoverMix(
      portishead,
      songs(12).map((song, n) => ({ ...song, artists: [leads[n] ?? "Goldfrapp", "Guest"] })),
    );
    assert.equal(mix && discoverMixCaption(mix).artists, "Massive Attack, Tricky, Björk");
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

  const playSeed = discoverMixSeeds({
    played: { artists: [seedArtist(1, "Portishead")], songs: [] },
  });

  test("read back as they were saved", () => {
    assert.deepEqual(parseDiscoverMixes(storedDiscoverMixes(saved)), saved);
  });

  test("saved before seeds came from the Library, read back as built from plays", () => {
    const { playSeeds: _playSeeds, ...older } = saved;
    assert.deepEqual(parseDiscoverMixes(JSON.stringify(older)), saved);
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
    assert.equal(parseDiscoverMixes(JSON.stringify({ mixes: [] })), null);
  });

  test("an empty cache doesn't postpone rebuilding until tomorrow", () => {
    const now = new Date(2026, 9, 16, 12).getTime();
    const cached = parseDiscoverMixes(JSON.stringify({ builtAt: now, mixes: [] }));
    assert.equal(discoverMixesDue(cached, { now, played: true }), true);
  });

  test("a cache whose mixes are all unreadable is rebuilt too", () => {
    const now = new Date(2026, 9, 16, 12).getTime();
    const cached = parseDiscoverMixes(
      JSON.stringify({ builtAt: now, mixes: [{ ...saved.mixes[0], songs: [] }] }),
    );
    assert.equal(discoverMixesDue(cached, { now, played: true }), true);
  });

  test("leave out a song or a mix that can't be read", () => {
    const stored = JSON.stringify({
      builtAt: 5,
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
    const fromTheLibrary = discoverMixSeeds({
      played: { artists: [], songs: [] },
      library: { artists: [{ id: 1, name: "Air", songCount: 9 }], songs: [] },
    });
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
