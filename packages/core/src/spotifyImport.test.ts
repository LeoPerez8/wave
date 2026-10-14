import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  SPOTIFY_SEARCHES_AT_ONCE,
  findSpotifySongs,
  linkImportSummary,
  linkImportView,
  planSpotifyImport,
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

/** YouTube Music as a fake: [answers] by query, every query asked, and how many ran at once. */
const youTube = (answers: Record<string, readonly YtSong[]> = {}) => {
  const asked: string[] = [];
  let running = 0;
  let most = 0;
  const search = async (query: string) => {
    asked.push(query);
    running += 1;
    most = Math.max(most, running);
    await Promise.resolve();
    running -= 1;
    return { ok: true as const, songs: answers[query] ?? [] };
  };
  return { asked, search, most: () => most };
};

const noWait = async () => {};

/** A Spotify playlist of [songs] as read. */
const essentials = (songs: readonly SpotifySong[], fields = {}) => ({
  title: "  Daft   Punk Essentials ",
  artworkUrl: "https://i.scdn.co/image/essentials",
  songs,
  truncated: false,
  ...fields,
});

describe("findSpotifySongs", () => {
  const library = [
    { id: 7, title: "Get Lucky", artist: "Daft Punk feat. Pharrell Williams", durationMs: 369_500 },
  ];
  const lucky = spotify("Get Lucky", { artists: ["Daft Punk", "Pharrell Williams"] });
  const crush = spotify("Instant Crush", { durationMs: 337_000 });
  const touch = spotify("Touch", { durationMs: 498_000 });
  const crushOnYt = yt("crush", "Instant Crush", { durationMs: 337_000 });

  test("finds each song in the Library first, then on YouTube Music, in the playlist's order", async () => {
    const fake = youTube({ "Instant Crush Daft Punk": [crushOnYt] });
    const found = await findSpotifySongs({
      songs: [crush, lucky, touch],
      library,
      search: fake.search,
      wait: noWait,
    });
    assert.deepEqual(found, {
      ok: true,
      found: [
        { kind: "ytMusic", song: crushOnYt },
        { kind: "library", trackId: 7 },
        { kind: "notFound" },
      ],
    });
    assert.deepEqual(fake.asked, ["Instant Crush Daft Punk", "Touch Daft Punk"]);
  });

  test("a song listed twice is searched once, and a song without an artist isn't searched", async () => {
    const fake = youTube({ "Instant Crush Daft Punk": [crushOnYt] });
    const found = await findSpotifySongs({
      songs: [crush, spotify("Local file", { artists: [] }), crush],
      library: [],
      search: fake.search,
      wait: noWait,
    });
    assert.deepEqual(fake.asked, ["Instant Crush Daft Punk"]);
    assert.ok(found.ok);
    assert.deepEqual(
      found.found.map((find) => find.kind),
      ["ytMusic", "notFound", "ytMusic"],
    );
  });

  test("reports progress: the Library's songs at once, then each song as it's found or not", async () => {
    const progress: [number, number][] = [];
    await findSpotifySongs({
      songs: [crush, lucky, touch],
      library,
      search: youTube().search,
      wait: noWait,
      onProgress: (done, total) => progress.push([done, total]),
    });
    assert.deepEqual(progress, [
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  test(`asks YouTube Music at most ${SPOTIFY_SEARCHES_AT_ONCE} searches at once`, async () => {
    const fake = youTube();
    await findSpotifySongs({
      songs: Array.from({ length: 20 }, (_, n) => spotify(`Song ${n}`)),
      library: [],
      search: fake.search,
      wait: noWait,
    });
    assert.equal(fake.asked.length, 20);
    assert.equal(fake.most(), SPOTIFY_SEARCHES_AT_ONCE);
  });

  test("once cancelled, it asks nothing more", async () => {
    const controller = new AbortController();
    const asked: string[] = [];
    const found = await findSpotifySongs({
      songs: Array.from({ length: 20 }, (_, n) => spotify(`Song ${n}`)),
      library: [],
      search: async (query) => {
        asked.push(query);
        controller.abort();
        return { ok: true, songs: [] };
      },
      wait: noWait,
      signal: controller.signal,
    });
    assert.deepEqual(found, { ok: false, reason: "cancelled" });
    assert.ok(asked.length <= SPOTIFY_SEARCHES_AT_ONCE, `asked ${asked.length}`);
  });

  test("a search YouTube Music refuses is asked again after a pause", async () => {
    const pauses: number[] = [];
    let tries = 0;
    const found = await findSpotifySongs({
      songs: [crush],
      library: [],
      search: async () => {
        tries += 1;
        return tries < 3 ? { ok: false, reason: "failed" } : { ok: true, songs: [crushOnYt] };
      },
      wait: async (ms) => {
        pauses.push(ms);
      },
    });
    assert.deepEqual(found, { ok: true, found: [{ kind: "ytMusic", song: crushOnYt }] });
    assert.deepEqual(pauses, [2000, 5000]);
  });

  test("a search refused again and again stops the finding, and nothing more is asked", async () => {
    const asked: string[] = [];
    const pauses: number[] = [];
    const found = await findSpotifySongs({
      songs: Array.from({ length: 40 }, (_, n) => spotify(`Song ${n}`)),
      library: [],
      search: async (query) => {
        asked.push(query);
        return { ok: false, reason: "failed" };
      },
      wait: async (ms) => {
        pauses.push(ms);
      },
    });
    assert.deepEqual(found, { ok: false, reason: "failed" });
    assert.deepEqual([...new Set(pauses)], [2000, 5000, 10_000, 20_000]);
    // Each of the first searches is tried five times; no new song is searched after.
    assert.ok(asked.length <= SPOTIFY_SEARCHES_AT_ONCE * 5, `asked ${asked.length}`);
  });

  test("offline, or with YT Music turned off, it stops at once", async () => {
    for (const reason of ["offline", "disabled"] as const) {
      let tries = 0;
      const found = await findSpotifySongs({
        songs: [crush],
        library: [],
        search: async () => {
          tries += 1;
          return { ok: false, reason };
        },
        wait: noWait,
      });
      assert.deepEqual(found, { ok: false, reason });
      assert.equal(tries, 1);
    }
  });
});

describe("planSpotifyImport", () => {
  const crush = yt("crush", "Instant Crush");
  const touch = yt("touch", "Touch");

  test("the playlist keeps Spotify's order, Library songs as its tracks, without the songs not found", () => {
    const plan = planSpotifyImport(
      essentials([
        spotify("Instant Crush"),
        spotify("Get Lucky"),
        spotify("Doin' it Right", { artists: ["Daft Punk", "Panda Bear"] }),
        spotify("Touch"),
      ]),
      [
        { kind: "ytMusic", song: crush },
        { kind: "library", trackId: 7 },
        { kind: "notFound" },
        { kind: "ytMusic", song: touch },
      ],
    );
    assert.deepEqual(plan, {
      name: "Daft Punk Essentials",
      songs: [
        { source: "stream", song: crush },
        { source: "library", trackId: 7 },
        { source: "stream", song: touch },
      ],
      inLibrary: 1,
      notFound: [{ title: "Doin' it Right", artist: "Daft Punk & Panda Bear" }],
    });
  });

  test("two Spotify songs found as one goes in once", () => {
    const plan = planSpotifyImport(
      essentials([spotify("Instant Crush"), spotify("Instant Crush")]),
      [
        { kind: "ytMusic", song: crush },
        { kind: "ytMusic", song: crush },
      ],
    );
    assert.deepEqual(plan.songs, [{ source: "stream", song: crush }]);
  });
});

describe("linkImportView for Spotify", () => {
  const source = {
    title: "Daft Punk Essentials",
    artworkUrl: "https://i.scdn.co/image/essentials",
    songs: [spotify("Instant Crush"), spotify("Get Lucky"), spotify("Touch")],
    truncated: false,
  };

  test("while songs are found, the card shows the playlist and how far finding has got", () => {
    assert.deepEqual(
      linkImportView({ status: "finding", playlist: source, done: 12, total: 250 }),
      {
        name: "Daft Punk Essentials",
        artworkUrl: "https://i.scdn.co/image/essentials",
        line: "Finding songs… 12 of 250",
        note: null,
        canImport: false,
        retry: false,
      },
    );
  });

  test("once found, it counts the songs found, those the Library has and those not found", () => {
    const plan = planSpotifyImport(source, [
      { kind: "ytMusic", song: yt("crush", "Instant Crush") },
      { kind: "library", trackId: 7 },
      { kind: "notFound" },
    ]);
    const view = linkImportView({ status: "read", playlist: source, plan });
    assert.equal(view.line, "2 songs · 1 in your Library");
    assert.equal(view.note, "1 song wasn't found.");
    assert.equal(view.canImport, true);
  });

  test("a playlist only partly read says so beside the songs not found", () => {
    const cut = { ...source, truncated: true };
    const plan = planSpotifyImport(cut, [
      { kind: "notFound" },
      { kind: "library", trackId: 7 },
      { kind: "notFound" },
    ]);
    assert.equal(
      linkImportView({ status: "read", playlist: cut, plan }).note,
      "2 songs weren't found. It goes on past 3 songs. Only those are imported.",
    );
  });

  test("with no song found, there's nothing to import", () => {
    const plan = planSpotifyImport(source, [
      { kind: "notFound" },
      { kind: "notFound" },
      { kind: "notFound" },
    ]);
    const view = linkImportView({ status: "read", playlist: source, plan });
    assert.equal(view.line, "None of its songs were found.");
    assert.equal(view.canImport, false);
  });

  test("Spotify's failures say what happened", () => {
    const cases = [
      ["missing", "This playlist doesn't exist or isn't public.", false],
      ["unreachable", "Couldn't reach Spotify. Check your connection and try again.", true],
      ["spotifyFailed", "Couldn't read this playlist. Spotify didn't answer as expected.", true],
      ["song", "This is a link to a song, not a playlist.", false],
      ["notPlaylist", "This link isn't to a playlist.", false],
      ["searchFailed", "YouTube Music stopped answering while finding the songs.", true],
    ] as const;
    for (const [reason, line, retry] of cases) {
      const view = linkImportView({ status: "failed", reason });
      assert.deepEqual([view.line, view.retry, view.canImport], [line, retry, false], reason);
    }
  });
});

describe("linkImportSummary", () => {
  test("after Import, lists the songs not found by title and artist", () => {
    assert.deepEqual(
      linkImportSummary({
        name: "Daft Punk Essentials",
        songs: [],
        inLibrary: 0,
        notFound: [
          { title: "Doin' it Right", artist: "Daft Punk & Panda Bear" },
          { title: "Touch", artist: "Daft Punk" },
        ],
      }),
      {
        title: "2 songs weren't found",
        message:
          "Daft Punk Essentials was imported without them:\n\nDoin' it Right · Daft Punk & Panda Bear\nTouch · Daft Punk",
      },
    );
  });

  test("with every song found there's nothing to say", () => {
    assert.equal(linkImportSummary({ name: "Drive", songs: [], inLibrary: 0, notFound: [] }), null);
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
