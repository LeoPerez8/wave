import assert from "node:assert/strict";
import { test } from "node:test";
import { artistGraph, playlistRecommendations, type PlaylistRecommendationTrack } from "./index.ts";

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

test("a downloaded video's Library representation wins even when its edited tags differ from the catalog", () => {
  const seed = track("seed");
  const downloaded = track("downloaded", {
    title: "My edited title",
    videoId: "same-video",
    downloaded: true,
  });
  const catalog = [
    {
      song: { ...downloaded, title: "Original title", videoId: "same-video" },
      firstSeenAt: 0,
      lastSeenAt: 0,
      radios: [],
    },
  ];
  const sources = { library: [seed, downloaded], catalog, graph: null, now: 0 };
  assert.deepEqual(
    playlistRecommendations([seed], sources).map((x) => x.track.id),
    ["downloaded"],
  );
  assert.deepEqual(
    playlistRecommendations(
      [{ ...downloaded, source: "stream", id: "yt:same-video", title: "Original title" }],
      sources,
    ).map((x) => x.track.id),
    ["seed"],
  );
});

test("a playlist ranks five compatible distinct recordings through the shared engine and artist graph", () => {
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
    track("same-album"),
    track("same-artist", { album: "Kid A" }),
    track("near", { artists: ["Portishead"], album: "Dummy" }),
    track("genre", { artists: ["Slowdive"], album: "Souvlaki" }),
    track("fifth", { artists: ["Blur"] }),
    track("unrelated", { artists: ["Metal Band"], genre: "Heavy Metal" }),
    track("missing", { available: false }),
    track("wrong-album-genre", { genre: "Heavy Metal" }),
  ];
  const result = playlistRecommendations([seed], { library, catalog: [], graph, now: 100 });
  assert.deepEqual(
    result.map((x) => x.track.id),
    ["same-album", "same-artist", "near", "fifth", "genre"],
  );
});

test("an untagged playlist preserves its artists' genre shares when deciding compatibility", () => {
  const seed = track("yt:seed", {
    source: "stream",
    videoId: "seed",
    artists: ["Seed Artist"],
    genre: null,
  });
  const library = [
    track("metal", { artists: ["Metal Artist"], genre: "Metal" }),
    track("pop", { artists: ["Pop Artist"], genre: "Pop" }),
  ];
  const profile = new Map([
    ["pop", 0.9],
    ["metal", 0.1],
  ]);
  assert.deepEqual(
    playlistRecommendations([seed], {
      library,
      catalog: [],
      graph: null,
      now: 0,
      profileOf: (name) => (name === "Seed Artist" ? profile : undefined),
    }).map((offer) => offer.track.id),
    ["pop"],
  );
});

test("cross-source recordings and catalog duplicates never occupy two slots or repeat playlist membership", () => {
  const seed = track("seed");
  const local = track("local", { title: "Let Down" });
  const catalog = [
    { ...seed, videoId: "seed-copy" },
    { ...local, videoId: "local-copy" },
    track("a", { source: "stream", videoId: "a", title: "Lucky" }),
    track("b", { source: "stream", videoId: "b", title: "Lucky (Remastered 2011)" }),
    track("live", { source: "stream", videoId: "live", title: "Lucky (Live)", durationMs: 240000 }),
  ].map((song) => ({ song, firstSeenAt: 0, lastSeenAt: 0, radios: [] }));
  const sources = { library: [seed, local], catalog, graph: null, now: 100 };
  assert.deepEqual(
    playlistRecommendations([seed], sources).map((x) => x.track.id),
    ["local", "yt:a", "yt:live"],
  );
  assert.deepEqual(
    playlistRecommendations([seed], { ...sources, online: false }).map((x) => x.track.id),
    ["local"],
  );
  assert.deepEqual(playlistRecommendations([], sources), []);
});

test("every qualifying favorite or download gets a slot before ordinary songs, but unrelated favorites stay out", () => {
  const seed = track("seed");
  const library = [
    seed,
    track("ordinary"),
    track("favorite", { artists: ["Slowdive"], favorite: true }),
    track("download", { artists: ["Blur"], downloaded: true }),
    track("unrelated", {
      artists: ["Metal Band"],
      genre: "Heavy Metal",
      favorite: true,
      downloaded: true,
    }),
  ];
  const picks = playlistRecommendations([seed], { library, catalog: [], graph: null, now: 0 });
  assert.deepEqual(
    picks.map((x) => x.track.id),
    ["download", "favorite", "ordinary"],
  );
});

test("more than five priority recordings are ordered by compatibility and renewed status is respected", () => {
  const seed = track("seed");
  const library = [
    seed,
    track("ordinary"),
    track("favorite-near", { favorite: true, album: "Kid A" }),
    track("favorite-album", { favorite: true }),
    ...["a", "b", "c", "d", "e"].map((id) =>
      track(id, { downloaded: true, artists: ["Slowdive"] }),
    ),
  ];
  const sources = { library, catalog: [], graph: null, now: 0 };
  assert.deepEqual(
    playlistRecommendations([seed], sources).map((x) => x.track.id),
    ["favorite-album", "favorite-near", "a", "b", "c"],
  );
  const updated = library.map((t) => ({ ...t, favorite: t.id === "ordinary", downloaded: false }));
  assert.equal(
    playlistRecommendations([seed], { ...sources, library: updated })[0]?.track.id,
    "ordinary",
  );
});

test("dismissing Taylor Swift mildly lowers only this playlist while keeping her favorite and baseline graph", () => {
  const seed = track("seed", { artists: ["Lorde"], genre: "Pop", album: "Melodrama" });
  const taylor = track("taylor", { artists: ["Taylor Swift"], genre: "Pop", favorite: true });
  const related = track("related", { artists: ["Taylor Swift"], genre: "Pop", favorite: true });
  const other = track("other", { artists: ["Carly Rae Jepsen"], genre: "Pop", favorite: true });
  const graph = artistGraph({
    catalog: [],
    plays: [],
    pages: [
      {
        name: "Lorde",
        similar: [
          { name: "Taylor Swift", browseId: "UCtaylor", audience: null },
          { name: "Carly Rae Jepsen", browseId: "UCcarly", audience: null },
        ],
      },
    ],
  });
  const beforeGraph = structuredClone(graph);
  const sources = { library: [seed, taylor, related, other], catalog: [], graph, now: 0 };
  const before = playlistRecommendations([seed], sources);
  const after = playlistRecommendations([seed], {
    ...sources,
    feedback: [{ track: taylor, value: -1 }],
  });
  assert.ok(
    after.find((x) => x.track.id === "related")!.score <
      before.find((x) => x.track.id === "related")!.score,
  );
  assert.ok(after.some((x) => x.track.id === "taylor")); // mild, never an artist/genre ban
  assert.equal(after[0]?.track.id, "other");
  assert.equal(taylor.favorite, true);
  assert.deepEqual(playlistRecommendations([seed], sources), before);
  assert.deepEqual(graph, beforeGraph);
});

test("accepting a previously dismissed recording offsets its negative signal and strengthens related picks", () => {
  const seed = track("seed");
  const song = track("accepted", { artists: ["Slowdive"] });
  const related = track("related", { artists: ["Slowdive"] });
  const sources = { library: [seed, song, related], catalog: [], graph: null, now: 0 };
  const baseline = playlistRecommendations([seed], sources);
  const after = playlistRecommendations([seed], {
    ...sources,
    feedback: [
      { track: song, value: -1 },
      { track: song, value: 1 },
    ],
  });
  assert.deepEqual(after, baseline);
  const positive = playlistRecommendations([seed], {
    ...sources,
    feedback: [{ track: song, value: 1 }],
  });
  assert.ok(
    positive.find((x) => x.track.id === "related")!.score >
      baseline.find((x) => x.track.id === "related")!.score,
  );
});

test("stepped ranking preserves complete offers and bounds visits even for one prolific artist", async () => {
  const { playlistRecommendationsSteps } = await import("./playlistRecommendations.ts");
  let visits = 0;
  const library = Array.from({ length: 1400 }, (_, i) => {
    const song = track(String(i));
    return {
      ...song,
      get genre() {
        visits++;
        return song.genre ?? null;
      },
    };
  });
  const sources = { library, catalog: [], graph: null, now: 0 };
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

test("untagged playlist fallback yields across every seed instead of one large artist walk", async () => {
  const { playlistRecommendationsSteps } = await import("./playlistRecommendations.ts");
  let visits = 0;
  const seeds = Array.from({ length: 1400 }, (_, i) => ({
    ...track(`seed-${i}`, { genre: null }),
    get artists() {
      visits++;
      return ["Radiohead"];
    },
  }));
  const steps = playlistRecommendationsSteps(seeds, {
    library: [track("next")],
    catalog: [],
    graph: null,
    now: 0,
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
