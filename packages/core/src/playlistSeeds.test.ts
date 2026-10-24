import assert from "node:assert/strict";
import { test } from "node:test";
import {
  drawPlaylistSeeds,
  parsePlaylistSeedHistory,
  playlistSeedHistoryWith,
  seededRandom,
  storedPlaylistSeedHistory,
  type PlaylistRecommendationTrack,
} from "./index.ts";

const track = (
  id: string,
  artist: string,
  fields: Partial<PlaylistRecommendationTrack> = {},
): PlaylistRecommendationTrack => ({
  id,
  source: "library",
  videoId: "",
  title: id,
  artists: [artist],
  album: null,
  albumId: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
  ...fields,
});

const playlist = [
  track("a1", "Alpha", { addedAt: 1 }),
  track("a2", "Alpha", { addedAt: 2 }),
  track("b1", "Beta", { addedAt: 3 }),
  track("b2", "Beta", { addedAt: 4 }),
  track("c1", "Gamma", { addedAt: 5 }),
  track("c2", "Gamma", { addedAt: 6 }),
  track("d1", "Delta", { addedAt: 7 }),
];

test("a renewal draws 3 seed songs by different artists", () => {
  for (let run = 0; run < 30; run++) {
    const { seeds } = drawPlaylistSeeds(playlist, { recent: [], random: seededRandom(`${run}`) });
    assert.equal(seeds.length, 3);
    assert.equal(new Set(seeds.map((seed) => seed.artists[0])).size, 3);
  }
});

test("successive renewals draw different seed songs while the playlist has them", () => {
  let recent: readonly string[] = [];
  const seen: string[] = [];
  for (let renewal = 0; renewal < 2; renewal++) {
    const draw = drawPlaylistSeeds(playlist, { recent, random: seededRandom(`r${renewal}`) });
    for (const seed of draw.seeds) {
      assert.ok(!seen.includes(seed.id), `${seed.id} drawn again in renewal ${renewal}`);
      seen.push(seed.id);
    }
    recent = draw.recent;
  }
  assert.equal(seen.length, 6);
});

test("the most recently added songs are drawn most often", () => {
  const counts = new Map<string, number>();
  const songs = [track("old", "A", { addedAt: 1 }), track("new", "B", { addedAt: 9 })];
  for (let run = 0; run < 600; run++) {
    const { seeds } = drawPlaylistSeeds(songs, { recent: [], random: seededRandom(`n${run}`) });
    const first = seeds[0]!.id;
    counts.set(first, (counts.get(first) ?? 0) + 1);
  }
  assert.ok((counts.get("new") ?? 0) > 1.5 * (counts.get("old") ?? 0));
});

test("a playlist's draws are kept apart from another's, the latest playlists first", () => {
  let history = parsePlaylistSeedHistory(null);
  history = playlistSeedHistoryWith(history, 1, ["a1", "b1"]);
  history = playlistSeedHistoryWith(history, 2, ["x"]);
  const reread = parsePlaylistSeedHistory(storedPlaylistSeedHistory(history));
  assert.deepEqual(reread.get(1), ["a1", "b1"]);
  assert.deepEqual(reread.get(2), ["x"]);
  assert.deepEqual(parsePlaylistSeedHistory("not json").size, 0);
  let many = parsePlaylistSeedHistory(null);
  for (let id = 0; id < 250; id++) many = playlistSeedHistoryWith(many, id, [String(id)]);
  assert.ok(many.size <= 200);
  assert.deepEqual(many.get(249), ["249"]);
  assert.equal(many.get(0), undefined);
});

test("a renewal replaces the previous draw even while its songs remain in the playlist", () => {
  const first = drawPlaylistSeeds(playlist, { recent: [], random: seededRandom("keep") });
  const again = drawPlaylistSeeds(playlist, {
    recent: first.recent,
    random: seededRandom("other"),
  });
  assert.ok(again.seeds.every((seed) => !first.seeds.some((old) => old.id === seed.id)));
  assert.notDeepEqual(again.recent, first.recent);
});
