import assert from "node:assert/strict";
import { test } from "node:test";
import {
  artistGraph,
  playlistRecommendations,
  type PlaylistRecommendationSources,
  type PlaylistRecommendationTrack,
  type RadioRankingPage,
  type YtAlbumSong,
} from "./index.ts";

const track = (
  id: string,
  fields: Partial<PlaylistRecommendationTrack> = {},
): PlaylistRecommendationTrack => ({
  id,
  source: "library",
  videoId: "",
  title: id,
  artists: ["Radiohead"],
  album: "OK Computer",
  albumId: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
  genre: "Alternative Rock",
  ...fields,
});

const song = (videoId: string, artist: string, fields: Partial<YtAlbumSong> = {}): YtAlbumSong => ({
  videoId,
  title: videoId,
  artists: [artist],
  album: null,
  albumId: null,
  durationMs: 200000,
  artworkUrl: null,
  explicit: false,
  ...fields,
});

const radio = (id: string, songs: readonly YtAlbumSong[]): RadioRankingPage => ({
  id,
  artists: ["Radiohead"],
  songs,
});

const ids = (
  playlist: readonly PlaylistRecommendationTrack[],
  sources: PlaylistRecommendationSources,
) => playlistRecommendations(playlist, sources).map((offer) => offer.track.id);

test("suggestions follow the seeds' radios in order, leaving the playlist's own songs out", () => {
  const seed = track("seed", { videoId: "seed-video" });
  const pages = [
    radio("song:seed", [
      song("seed-video", "Radiohead"),
      song("a", "Portishead"),
      song("b", "Massive Attack"),
      song("c", "Björk"),
    ]),
  ];
  assert.deepEqual(ids([seed], { library: [seed], pages, graph: null }), ["yt:a", "yt:b", "yt:c"]);
});

test("a radio song the Library has is offered as the Library song, even with edited tags", () => {
  const seed = track("seed");
  const downloaded = track("downloaded", {
    title: "My edited title",
    videoId: "same-video",
    artists: ["Portishead"],
    downloaded: true,
  });
  const pages = [radio("song:seed", [song("same-video", "Portishead", { title: "Original" })])];
  assert.deepEqual(ids([seed], { library: [seed, downloaded], pages, graph: null }), [
    "downloaded",
  ]);
});

test("the five suggestions never hold more than 2 songs by one artist", () => {
  const seed = track("seed");
  const pages = [
    radio("song:seed", [
      song("p1", "Portishead"),
      song("p2", "Portishead"),
      song("p3", "Portishead"),
      song("p4", "Portishead"),
      song("m1", "Massive Attack"),
      song("m2", "Massive Attack", { artists: ["Massive Attack", "Portishead"] }),
      song("t1", "Tricky"),
      song("b1", "Björk"),
    ]),
  ];
  assert.deepEqual(ids([seed], { library: [seed], pages, graph: null }), [
    "yt:p1",
    "yt:p2",
    "yt:m1",
    "yt:t1",
    "yt:b1",
  ]);
});

test("a dismissed song never comes back, while its artist's other songs still can", () => {
  const seed = track("seed");
  const pages = [
    radio("song:seed", [song("a", "Portishead"), song("b", "Portishead"), song("c", "Tricky")]),
  ];
  const dismissed = {
    ...song("a", "Portishead"),
    id: "yt:a",
    source: "stream" as const,
  };
  const offers = ids([seed], {
    library: [seed],
    pages,
    graph: null,
    feedback: [{ track: dismissed, value: -1 }],
  });
  assert.deepEqual(offers.toSorted(), ["yt:b", "yt:c"]);
  // Accepted again later (as another representation), the recording isn't banned.
  assert.deepEqual(
    ids([seed], {
      library: [seed],
      pages,
      graph: null,
      feedback: [
        { track: dismissed, value: -1 },
        { track: dismissed, value: 1 },
      ],
    })[0],
    "yt:a",
  );
});

test("a playlist whose songs have no genre still gets suggestions", () => {
  const seed = track("yt:seed", {
    source: "stream",
    videoId: "seed",
    artists: ["Unknown Artist One"],
    genre: null,
  });
  const pages = [radio("song:yt:seed", [song("x", "Someone"), song("y", "Someone Else")])];
  assert.deepEqual(ids([seed], { library: [], pages, graph: null }), ["yt:x", "yt:y"]);
});

test("similarity to the playlist's artists and genres weighs on the radio order", () => {
  const seed = track("seed", { genre: "Pop", artists: ["Lorde"] });
  const other = track("other", { genre: "Pop", artists: ["Robyn"] });
  const profiles = new Map([
    ["Metal Band", new Map([["metal", 1]])],
    ["Pop Singer", new Map([["pop", 1]])],
  ]);
  const pages = [
    radio("song:seed", [song("metal", "Metal Band"), song("pop", "Pop Singer")]),
    radio("song:other", [song("unknown", "Nobody Knows"), song("robyn", "Robyn")]),
  ];
  const result = ids([seed, other], {
    library: [seed, other],
    pages,
    graph: null,
    profileOf: (name) => profiles.get(name),
  });
  // A playlist artist and a playlist genre climb past an unknown genre; a known unrelated one falls.
  assert.deepEqual(result, ["yt:robyn", "yt:pop", "yt:unknown", "yt:metal"]);
});

test("Library songs by the seeds' artists or their neighbours join, and unrelated ones stay out", () => {
  const seed = track("seed");
  const graph = artistGraph({
    catalog: [],
    pages: [
      {
        name: "Radiohead",
        similar: [{ name: "Portishead", browseId: "UCportishead", audience: null }],
      },
    ],
    plays: [],
  });
  const library = [
    seed,
    track("same-artist", { album: "Kid A" }),
    track("near", { artists: ["Portishead"], album: "Dummy" }),
    track("unrelated", { artists: ["Metal Band"], genre: "Heavy Metal" }),
    track("missing", { available: false }),
  ];
  assert.deepEqual(ids([seed], { library, pages: [], graph }), ["same-artist", "near"]);
});

test("the drawn seeds' artists, not every playlist artist, bring Library songs outside the radios", () => {
  const radiohead = track("radiohead");
  const blur = track("blur", { artists: ["Blur"] });
  const library = [
    radiohead,
    blur,
    track("radiohead-2", { album: "Kid A" }),
    track("blur-2", { artists: ["Blur"], album: "Parklife" }),
  ];
  assert.deepEqual(ids([radiohead, blur], { library, pages: [], graph: null, seeds: [blur] }), [
    "blur-2",
  ]);
});

test("cross-source recordings and radio duplicates never occupy two slots or repeat membership", () => {
  const seed = track("seed", { title: "Airbag" });
  const local = track("local", { title: "Let Down", artists: ["Portishead"] });
  const pages = [
    radio("song:seed", [
      song("seed-copy", "Radiohead", { title: "Airbag", durationMs: 180000 }),
      song("local-copy", "Portishead", { title: "Let Down", durationMs: 180000 }),
      song("a", "Blur", { title: "Lucky" }),
      song("b", "Blur", { title: "Lucky (Remastered 2011)" }),
      song("live", "Blur", { title: "Lucky (Live)", durationMs: 240000 }),
    ]),
  ];
  const sources = { library: [seed, local], pages, graph: null };
  assert.deepEqual(ids([seed], sources), ["local", "yt:a", "yt:live"]);
  assert.deepEqual(ids([seed], { ...sources, online: false }), ["local"]);
  assert.deepEqual(ids([seed], { ...sources, ytMusicEnabled: false }), ["local"]);
  assert.deepEqual(ids([], sources), []);
});

test("favorites and downloads among the suggestions come first", () => {
  const seed = track("seed");
  const library = [
    seed,
    track("ordinary", { videoId: "o", artists: ["Blur"] }),
    track("favorite", { videoId: "f", artists: ["Slowdive"], favorite: true }),
    track("download", { videoId: "d", artists: ["Tricky"], downloaded: true }),
    track("unrelated", { artists: ["Metal Band"], favorite: true, downloaded: true }),
  ];
  const pages = [
    radio("song:seed", [
      song("o", "Blur"),
      song("f", "Slowdive"),
      song("d", "Tricky"),
      song("s", "X"),
    ]),
  ];
  assert.deepEqual(ids([seed], { library, pages, graph: null }), [
    "favorite",
    "download",
    "ordinary",
    "yt:s",
  ]);
});

test("feedback stays with the playlist: a dismissal mildly lowers its artist without banning them", () => {
  const seed = track("seed", { artists: ["Lorde"], genre: "Pop" });
  const pages = [
    radio("song:seed", [
      song("taylor", "Taylor Swift"),
      song("carly", "Carly Rae Jepsen"),
      song("taylor-2", "Taylor Swift"),
    ]),
  ];
  const taylor = { ...song("taylor", "Taylor Swift"), id: "yt:taylor", source: "stream" as const };
  const sources = { library: [seed], pages, graph: null };
  const before = playlistRecommendations([seed], sources);
  const after = playlistRecommendations([seed], {
    ...sources,
    feedback: [{ track: taylor, value: -1 }],
  });
  const score = (offers: typeof before, id: string) => offers.find((x) => x.track.id === id)!.score;
  assert.ok(score(after, "yt:taylor-2") < score(before, "yt:taylor-2"));
  assert.ok(after.some((x) => x.track.id === "yt:taylor-2"));
  assert.deepEqual(playlistRecommendations([seed], sources), before);
});

test("stepped ranking bounds each step's work over a large Library", async () => {
  const { playlistRecommendationsSteps } = await import("./playlistRecommendations.ts");
  let visits = 0;
  const library = Array.from({ length: 1400 }, (_, i) => {
    const local = track(String(i));
    return {
      ...local,
      get genre() {
        visits++;
        return local.genre ?? null;
      },
    };
  });
  const sources = { library, pages: [], graph: null };
  const expected = playlistRecommendations([track("seed")], sources);
  const steps = playlistRecommendationsSteps([track("seed")], sources);
  let max = 0;
  for (;;) {
    visits = 0;
    const next = steps.next();
    max = Math.max(max, visits);
    if (next.done) {
      assert.deepEqual(next.value, expected);
      break;
    }
  }
  assert.ok(max <= 16, `one generator operation visited ${max} tags`);
});

test("an untagged playlist's fallback yields across every song instead of one large artist walk", async () => {
  const { playlistRecommendationsSteps } = await import("./playlistRecommendations.ts");
  let visits = 0;
  const playlist = Array.from({ length: 1400 }, (_, i) => ({
    ...track(`seed-${i}`, { genre: null }),
    get artists() {
      visits++;
      return ["Radiohead"];
    },
  }));
  const steps = playlistRecommendationsSteps(playlist, {
    library: [track("next")],
    pages: [],
    graph: null,
  });
  let max = 0;
  for (;;) {
    visits = 0;
    const next = steps.next();
    max = Math.max(max, visits);
    if (next.done) {
      assert.equal(next.value[0]?.track.id, "next");
      break;
    }
  }
  assert.ok(max < 32, `one operation inspected ${max} seed credits`);
});
