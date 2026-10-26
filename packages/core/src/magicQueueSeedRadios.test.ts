import assert from "node:assert/strict";
import { test } from "node:test";
import {
  magicBatchRadios,
  magicListSeedSongs,
  parseMagicSession,
  seededRandom,
  startMagicQueue,
  type MagicSeed,
  type MagicSeedSong,
  type MagicSession,
  type MagicSong,
} from "./index.ts";

const seedSong = (id: string, artist: string, plays = 0): MagicSeedSong => ({
  id: `song:${id}`,
  title: id,
  artists: [artist],
  durationMs: 200_000,
  plays,
});
const magicSong = (id: string): MagicSong => ({
  trackId: id,
  artists: [],
  genre: null,
  style: null,
});
const start = (seed: MagicSeed, songs: readonly MagicSeedSong[]): MagicSession => {
  const started = startMagicQueue(seed, [magicSong("1")], {
    id: "s",
    random: () => 0,
    radio: { artists: [], profile: null, songs },
  });
  assert.ok(started !== null);
  return started.session;
};
const album: MagicSeed = { kind: "album", id: "9", title: "Album" };
const playlist: MagicSeed = { kind: "playlist", id: "4", title: "Mix" };
const nextBatch = (session: MagicSession): MagicSession => ({
  ...session,
  batches: session.batches + 1,
});

test("an album's batch reads up to 3 song radios by different artists", () => {
  const session = start(album, [
    seedSong("a1", "A", 5),
    seedSong("a2", "A"),
    seedSong("b1", "B"),
    seedSong("c1", "C"),
    seedSong("d1", "D"),
  ]);
  const { seeds } = magicBatchRadios(session, seededRandom("x"));
  assert.equal(seeds.length, 3);
  assert.equal(new Set(seeds.map((seed) => seed.artists[0])).size, 3);
  for (const seed of seeds) assert.equal(seed.kind ?? "song", "song");
});

test("the same batch keeps its draw; the next one draws other songs while there are some", () => {
  let session = start(playlist, [
    seedSong("a1", "A"),
    seedSong("a2", "A"),
    seedSong("b1", "B"),
    seedSong("b2", "B"),
    seedSong("c1", "C"),
    seedSong("c2", "C"),
  ]);
  const first = magicBatchRadios(session, seededRandom("1"));
  session = first.session;
  const again = magicBatchRadios(session, seededRandom("other"));
  assert.deepEqual(
    again.seeds.map((seed) => seed.id),
    first.seeds.map((seed) => seed.id),
  );
  assert.equal(again.session, session);
  const second = magicBatchRadios(nextBatch(session), seededRandom("2"));
  const before = new Set(first.seeds.map((seed) => seed.id));
  assert.equal(second.seeds.length, 3);
  for (const seed of second.seeds) assert.ok(!before.has(seed.id), `${seed.id} again`);
});

test("a playlist of one artist reads a different song's radio each batch", () => {
  let session = start(playlist, [
    seedSong("s1", "Solo", 9),
    seedSong("s2", "Solo"),
    seedSong("s3", "Solo"),
  ]);
  const seen: string[] = [];
  for (let batch = 0; batch < 3; batch++) {
    const drawn = magicBatchRadios(session, seededRandom(`b${batch}`));
    assert.equal(drawn.seeds.length, 1);
    assert.ok(!seen.includes(drawn.seeds[0]!.id));
    seen.push(drawn.seeds[0]!.id);
    session = nextBatch(drawn.session);
  }
});

test("a song or artist seed reads its own radio every batch", () => {
  const started = startMagicQueue({ kind: "artist", id: "7", title: "Band" }, [magicSong("1")], {
    id: "s",
    random: () => 0,
    radio: {
      artists: ["Band"],
      profile: null,
      song: { id: "artist:7", title: "Band", artists: ["Band"], durationMs: null, kind: "artist" },
    },
  });
  assert.ok(started !== null);
  const drawn = magicBatchRadios(nextBatch(started.session), seededRandom("x"));
  assert.deepEqual(
    drawn.seeds.map((seed) => [seed.id, seed.kind]),
    [["artist:7", "artist"]],
  );
});

test("a saved list session keeps its songs and draws; an old one reads back without them", () => {
  const drawn = magicBatchRadios(
    start(album, [seedSong("a1", "A"), seedSong("b1", "B")]),
    seededRandom("x"),
  );
  const restored = parseMagicSession(JSON.parse(JSON.stringify(drawn.session)));
  assert.deepEqual(restored, drawn.session);
  assert.deepEqual(
    magicBatchRadios(restored!, seededRandom("y")).seeds.map((seed) => seed.id),
    drawn.seeds.map((seed) => seed.id),
  );
  const { seedSongs: _songs, seedDraws: _draws, seedRadios: _radios, ...old } = drawn.session;
  const legacy = parseMagicSession(JSON.parse(JSON.stringify(old)));
  assert.ok(legacy !== null);
  assert.equal(legacy.seedSongs, undefined);
  assert.deepEqual(magicBatchRadios(legacy, seededRandom("z")).seeds, []);
  const broken = parseMagicSession({ ...drawn.session, seedSongs: [{ id: 3 }] });
  assert.equal(broken?.seedSongs, undefined);
});

test("a long playlist keeps its 200 most played songs to draw from", () => {
  const songs = Array.from({ length: 250 }, (_, index) =>
    seedSong(`p${index}`, `Artist ${index}`, index),
  );
  const session = start(playlist, songs);
  assert.equal(session.seedSongs?.length, 200);
  assert.ok(!session.seedSongs?.some((song) => song.plays < 50));
});

test("a playlist's streamed songs are seeds too, each with its counted plays", () => {
  const seeds = magicListSeedSongs(
    [
      {
        source: "library",
        track: { id: 7, title: "Local", artists: ["A"], durationMs: 200_000, videoId: "v-local" },
      },
      {
        source: "stream",
        song: {
          videoId: "v-airbag",
          title: "Airbag",
          artists: ["Radiohead"],
          album: "OK Computer",
          durationMs: 284_000,
          artworkUrl: null,
          explicit: false,
        },
      },
      {
        source: "library",
        track: { id: 8, title: "Never played", artists: ["B"], durationMs: null },
      },
    ],
    new Map([
      ["7", 2],
      ["yt:v-airbag", 9],
    ]),
  );
  assert.deepEqual(seeds, [
    {
      id: "song:7",
      title: "Local",
      artists: ["A"],
      durationMs: 200_000,
      videoId: "v-local",
      plays: 2,
    },
    {
      id: "song:yt:v-airbag",
      title: "Airbag",
      artists: ["Radiohead"],
      durationMs: 284_000,
      videoId: "v-airbag",
      plays: 9,
    },
    { id: "song:8", title: "Never played", artists: ["B"], durationMs: null, plays: 0 },
  ]);
  // The most played is drawn first most often, streamed or not.
  const firsts = new Map<string, number>();
  for (let i = 0; i < 200; i++) {
    const first = magicBatchRadios(start(playlist, seeds), seededRandom(String(i))).seeds[0]!.id;
    firsts.set(first, (firsts.get(first) ?? 0) + 1);
  }
  assert.ok(
    (firsts.get("song:yt:v-airbag") ?? 0) > (firsts.get("song:7") ?? 0),
    String([...firsts]),
  );
});
