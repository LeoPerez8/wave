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
