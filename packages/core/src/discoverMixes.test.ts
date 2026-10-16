import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  discoverMix,
  discoverMixCaption,
  discoverMixReadsMore,
  discoverMixesDue,
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

const seedNames = (seeds: ReturnType<typeof discoverMixSeeds>) =>
  seeds.map((seed) => `${seed.kind}: ${seed.name}`);

describe("Discover mixes' seeds", () => {
  test("are the three most played artists and the three most played songs, taking turns", () => {
    const seeds = discoverMixSeeds({
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
        discoverMixSeeds({
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
        discoverMixSeeds({
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
        discoverMixSeeds({
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
        discoverMixSeeds({
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
        discoverMixSeeds({
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
    assert.deepEqual(discoverMixSeeds({ artists: [], songs: [] }), []);
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
  const portishead = { kind: "artist" as const, id: "artist:portishead", name: "Portishead" };
  const gloryBox = {
    kind: "song" as const,
    id: "song:10",
    name: "Glory Box",
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

  test("are none when nothing, or nothing readable, is saved", () => {
    assert.equal(parseDiscoverMixes(null), null);
    assert.equal(parseDiscoverMixes("{"), null);
    assert.equal(parseDiscoverMixes(JSON.stringify({ mixes: [] })), null);
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
      mixes: [{ ...saved.mixes[0], songs: [angel] }],
    });
  });
});

describe("The mixes are built again", () => {
  const at = (day: number, hour: number) => new Date(2026, 9, day, hour).getTime();

  test("when none were built", () => {
    assert.equal(discoverMixesDue(null, at(16, 9)), true);
  });

  test("once a day: not on the day they were built, but from the next", () => {
    assert.equal(discoverMixesDue(at(16, 0), at(16, 23)), false);
    assert.equal(discoverMixesDue(at(16, 23), at(17, 0)), true);
    assert.equal(discoverMixesDue(at(10, 12), at(16, 12)), true);
  });

  test("when they were built later than now (the clock went back)", () => {
    assert.equal(discoverMixesDue(at(17, 9), at(16, 9)), true);
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
