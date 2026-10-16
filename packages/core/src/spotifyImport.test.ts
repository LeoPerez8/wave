import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  linkImportView,
  planLinkImport,
  spotifySearchQuery,
  spotifyYtMatch,
  type SpotifySong,
  type YtSong,
} from "./index.ts";

const spotify = (title: string, fields: Partial<SpotifySong> = {}): SpotifySong => ({
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 369_000,
  ...fields,
});

const yt = (videoId: string, title: string, fields: Partial<YtSong> = {}): YtSong => ({
  videoId,
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 369_000,
  artworkUrl: null,
  explicit: false,
  ...fields,
});

describe("linkImportView for Spotify", () => {
  const source = {
    title: "  Daft   Punk Essentials ",
    artworkUrl: "https://i.scdn.co/image/essentials",
    songs: [
      spotify("Instant Crush"),
      spotify("Get Lucky", { artists: ["Daft Punk", "Pharrell Williams"] }),
      spotify("Touch"),
    ],
    truncated: false,
    total: 3,
  };
  const library = [
    { id: 7, title: "Get Lucky", artist: "Daft Punk feat. Pharrell Williams", durationMs: 369_500 },
  ];
  const read = (playlist: typeof source) =>
    ({
      status: "read",
      playlist,
      plan: planLinkImport<YtSong, (typeof library)[number]>(
        { service: "spotify", playlist },
        library,
      ),
    }) as const;

  test("before any song is searched, the card counts the songs and those the Library has", () => {
    assert.deepEqual(linkImportView(read(source)), {
      name: "Daft Punk Essentials",
      artworkUrl: "https://i.scdn.co/image/essentials",
      line: "3 songs · 1 in your Library",
      source: null,
      note: null,
      canImport: true,
      retry: false,
    });
  });

  test("songs listed twice (re-releases under another Spotify id) show Spotify's count and go in once", () => {
    const prayer = spotify("Livin' On A Prayer", {
      artists: ["Bon Jovi"],
      album: "Slippery When Wet",
      durationMs: 249_000,
    });
    const spirit = spotify("Smells Like Teen Spirit", {
      artists: ["Nirvana"],
      album: "Nevermind",
      durationMs: 301_000,
    });
    const once = read({ ...source, songs: [...source.songs, prayer, prayer], total: 5 });
    assert.equal(linkImportView(once).line, "4 songs · 1 in your Library");
    assert.equal(linkImportView(once).source, "5 songs on Spotify · 1 listed twice goes in once");
    const twice = read({
      ...source,
      songs: [prayer, spirit, ...source.songs, spirit, prayer],
      total: 7,
    });
    assert.equal(linkImportView(twice).source, "7 songs on Spotify · 2 listed twice go in once");
  });

  test("items that aren't songs, such as podcast episodes, are counted too", () => {
    const view = linkImportView(read({ ...source, total: 5 }));
    assert.equal(view.source, "5 songs on Spotify · 2 aren't songs");
    assert.equal(
      linkImportView(read({ ...source, songs: [...source.songs, spotify("Touch")], total: 5 }))
        .source,
      "5 songs on Spotify · 1 listed twice goes in once · 1 isn't a song",
    );
  });

  test("a playlist only partly read says so", () => {
    assert.equal(
      linkImportView(read({ ...source, truncated: true })).note,
      "It goes on past 3 songs. Only those are imported.",
    );
  });

  test("Spotify's failures say what happened", () => {
    const cases = [
      ["missing", "This playlist doesn't exist or isn't public.", false],
      ["unreachable", "Couldn't reach Spotify. Check your connection and try again.", true],
      ["spotifyFailed", "Couldn't read this playlist. Spotify didn't answer as expected.", true],
      ["song", "This is a link to a song, not a playlist.", false],
      ["notPlaylist", "This link isn't to a playlist.", false],
    ] as const;
    for (const [reason, line, retry] of cases) {
      const view = linkImportView({ status: "failed", reason });
      assert.deepEqual([view.line, view.retry, view.canImport], [line, retry, false], reason);
    }
  });
});

describe("spotifySearchQuery", () => {
  test("asks YouTube Music for the song's title and artists, and nothing else", () => {
    assert.equal(
      spotifySearchQuery(spotify("Get Lucky", { artists: ["Daft Punk", "Pharrell Williams"] })),
      "Get Lucky Daft Punk Pharrell Williams",
    );
  });
});

describe("spotifyYtMatch", () => {
  test("takes the first result that is the same recording, skipping covers and other songs", () => {
    const original = yt("orig", "Giorgio by Moroder", { durationMs: 544_000 });
    assert.equal(
      spotifyYtMatch(spotify("Giorgio by Moroder", { durationMs: 544_626 }), [
        yt("cover", "Giorgio by Moroder", {
          artists: ["The Moroder Tribute Band"],
          durationMs: 544_000,
        }),
        yt("other", "Instant Crush", { durationMs: 337_000 }),
        original,
        yt("later", "Giorgio by Moroder", { durationMs: 545_000 }),
      ]),
      original,
    );
  });

  test("a remix isn't the song", () => {
    assert.equal(
      spotifyYtMatch(spotify("Lose Yourself to Dance", { durationMs: 353_000 }), [
        yt("remix", "Lose Yourself to Dance (Remix)", { durationMs: 353_000 }),
        yt("dashed", "Lose Yourself to Dance - Purple Disco Machine Remix", {
          durationMs: 352_000,
        }),
      ]),
      null,
    );
  });

  test("a remix is found as itself, not as the original", () => {
    const remix = yt("remix", "Lose Yourself to Dance (Purple Disco Machine Remix)", {
      durationMs: 410_000,
    });
    assert.equal(
      spotifyYtMatch(
        spotify("Lose Yourself to Dance - Purple Disco Machine Remix", { durationMs: 410_500 }),
        [yt("orig", "Lose Yourself to Dance", { durationMs: 410_000 }), remix],
      ),
      remix,
    );
  });

  test("a live version isn't the studio song, even as long", () => {
    assert.equal(
      spotifyYtMatch(spotify("Around the World"), [
        yt("live", "Around the World (Live)"),
        yt("album", "Around the World", { album: "Alive 2007 (Live)" }),
      ]),
      null,
    );
  });

  test("a song with a featured artist matches however each side credits the guest", () => {
    const credited = yt("feat", "Get Lucky", { artists: ["Daft Punk", "Pharrell Williams"] });
    assert.equal(
      spotifyYtMatch(spotify("Get Lucky (feat. Pharrell Williams)"), [credited]),
      credited,
    );
    const inTitle = yt("title", "Get Lucky (feat. Pharrell Williams)");
    assert.equal(
      spotifyYtMatch(spotify("Get Lucky", { artists: ["Daft Punk", "Pharrell Williams"] }), [
        inTitle,
      ]),
      inTitle,
    );
  });

  test("a version with a guest the song doesn't have isn't the song", () => {
    assert.equal(
      spotifyYtMatch(spotify("Get Lucky"), [yt("feat", "Get Lucky (feat. Nile Rodgers)")]),
      null,
    );
  });

  test("another edit, as told by its length, isn't the song", () => {
    assert.equal(
      spotifyYtMatch(spotify("Get Lucky", { durationMs: 369_000 }), [
        yt("radio", "Get Lucky", { durationMs: 248_000 }),
        yt("unknown", "Get Lucky", { durationMs: null }),
      ]),
      null,
    );
  });

  test("a song by someone else with the same title isn't the song", () => {
    assert.equal(
      spotifyYtMatch(spotify("Contact"), [yt("other", "Contact", { artists: ["Thirty Seconds"] })]),
      null,
    );
  });

  test("a remaster note is the same recording, as the Library match decides", () => {
    const plain = yt("plain", "Bohemian Rhapsody", {
      artists: ["Queen"],
      album: "A Night At The Opera",
      durationMs: 355_000,
    });
    assert.equal(
      spotifyYtMatch(
        spotify("Bohemian Rhapsody - Remastered 2011", {
          artists: ["Queen"],
          album: "A Night At The Opera (2011 Remaster)",
          durationMs: 354_320,
        }),
        [plain],
      ),
      plain,
    );
  });

  test("Spotify's dashed note matches YouTube Music's bracketed one", () => {
    const bracketed = yt("b", "Sunflower (Spider-Man: Into the Spider-Verse)", {
      artists: ["Post Malone", "Swae Lee"],
      durationMs: 158_000,
    });
    assert.equal(
      spotifyYtMatch(
        spotify("Sunflower - Spider-Man: Into the Spider-Verse", {
          artists: ["Post Malone", "Swae Lee"],
          durationMs: 158_040,
        }),
        [bracketed],
      ),
      bracketed,
    );
  });

  test("Spotify's \"(with X)\" credit, or a note naming only the song's artists, is a credit, not the title", () => {
    const plain = yt("p", "One Kiss", {
      artists: ["Calvin Harris", "Dua Lipa"],
      durationMs: 215_000,
    });
    assert.equal(
      spotifyYtMatch(
        spotify("One Kiss (with Dua Lipa)", {
          artists: ["Calvin Harris", "Dua Lipa"],
          durationMs: 214_846,
        }),
        [plain],
      ),
      plain,
    );
    const named = yt("n", "Drip Too Hard", { artists: ["Lil Baby", "Gunna"], durationMs: 147_000 });
    assert.equal(
      spotifyYtMatch(
        spotify("Drip Too Hard (Lil Baby & Gunna)", {
          artists: ["Lil Baby", "Gunna"],
          durationMs: 145_542,
        }),
        [named],
      ),
      named,
    );
  });

  test("an album's edition (deluxe, bonus tracks) says nothing about the recording", () => {
    const single = yt("s", "Californication", {
      artists: ["Red Hot Chili Peppers"],
      album: "Californication (Deluxe Version)",
      durationMs: 330_000,
    });
    assert.equal(
      spotifyYtMatch(
        spotify("Californication", {
          artists: ["Red Hot Chili Peppers"],
          album: "Californication (Deluxe Edition)",
          durationMs: 329_733,
        }),
        [single],
      ),
      single,
    );
  });

  test('a soundtrack\'s "From …" note is where the song comes from, not another version', () => {
    const plain = yt("p", "I See Fire", { artists: ["Ed Sheeran"], durationMs: 301_000 });
    assert.equal(
      spotifyYtMatch(
        spotify('I See Fire - From "The Hobbit - The Desolation Of Smaug"', {
          artists: ["Ed Sheeran"],
          durationMs: 300_840,
        }),
        [plain],
      ),
      plain,
    );
  });

  test('an artist matches with or without "The", and inside a duo\'s credit', () => {
    const iris = yt("i", "Iris", { artists: ["Goo Goo Dolls"], durationMs: 290_000 });
    assert.equal(
      spotifyYtMatch(spotify("Iris", { artists: ["The Goo Goo Dolls"], durationMs: 289_533 }), [
        iris,
      ]),
      iris,
    );
    const duo = yt("d", "Can't Hold Us (feat. Ray Dalton)", {
      artists: ["Macklemore & Ryan Lewis"],
      durationMs: 259_000,
    });
    assert.equal(
      spotifyYtMatch(
        spotify("Can't Hold Us (feat. Ray Dalton)", {
          artists: ["Macklemore", "Ryan Lewis", "Ray Dalton"],
          durationMs: 258_342,
        }),
        [duo],
      ),
      duo,
    );
  });

  test("a song without an artist matches nothing", () => {
    assert.equal(spotifyYtMatch(spotify("Intro", { artists: [] }), [yt("x", "Intro")]), null);
  });
});
