import assert from "node:assert/strict";
import { test } from "node:test";
import type { YtAlbumSong } from "@wave/core";
import { createDiscover, type DiscoverDeps } from "./discover.ts";
import type { YtRadioRead } from "./ytPages.ts";

const song = (videoId: string, artist = `Artist ${videoId}`): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: [artist],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

/** A radio of [count] songs, video ids [prefix]00…, each of its own artist. */
const radio = (prefix: string, count: number): YtRadioRead => ({
  status: "ok",
  songs: Array.from({ length: count }, (_, n) =>
    song(`${prefix}${String(n).padStart(11 - prefix.length, "0")}`),
  ),
  continuation: null,
});

const setup = (overrides: Partial<DiscoverDeps> = {}) => {
  const asked: string[] = [];
  const world = { day: "2026-11-18", online: true };
  const discover = createDiscover({
    played: () => [
      { id: 1, name: "Daft Punk", countedPlays: 40 },
      { id: 2, name: "Justice", countedPlays: 10 },
    ],
    library: () => ({
      trackIds: [1, 2, 3],
      artists: [
        { id: 1, name: "Daft Punk", songCount: 3 },
        { id: 2, name: "Justice", songCount: 1 },
      ],
    }),
    known: (found) => found.videoId.startsWith("known"),
    pages: {
      findArtist: async (name) => {
        asked.push(`findArtist ${name}`);
        return world.online
          ? { status: "ok", browseId: `UC${name.replace(" ", "")}` }
          : { status: "offline", browseId: null };
      },
      artistRadio: async (browseId) => {
        asked.push(`artistRadio ${browseId}`);
        return browseId === "UCDaftPunk" ? radio("daft", 12) : radio("just", 5);
      },
    },
    today: () => world.day,
    random: () => 0,
    ...overrides,
  });
  return { discover, asked, world };
};

test("Artist mixes grow from the most played artists' radios, songs the owner knows left out", async () => {
  const { discover } = setup({
    pages: {
      findArtist: async (name) => ({ status: "ok", browseId: `UC${name.replace(" ", "")}` }),
      artistRadio: async (browseId) =>
        browseId === "UCDaftPunk"
          ? {
              ...radio("daft", 12),
              songs: [song("known000001"), ...radio("daft", 12).songs],
            }
          : radio("just", 5),
    },
  });
  const read = await discover.mixes();
  assert.equal(read.status, "ok");
  // Justice's radio gave five new songs: too few to be a mix.
  assert.deepEqual(
    read.mixes.map((mix) => mix.name),
    ["Daft Punk"],
  );
  const mix = read.mixes[0]!;
  assert.equal(mix.songs.length, 12);
  // A known song may come back only in the familiar share, which Discover's level blends in.
  assert.ok(
    mix.songs.every(
      (found) =>
        found.source === "stream" &&
        (found.familiar === true || !found.song.videoId.startsWith("known")),
    ),
  );
  assert.deepEqual(discover.mix(mix.id)?.songs, mix.songs);
});

test("the mixes are built once a day", async () => {
  const { discover, asked, world } = setup();
  await discover.mixes();
  const reads = asked.length;
  await discover.mixes();
  assert.equal(asked.length, reads);
  world.day = "2026-11-19";
  await discover.mixes();
  assert.ok(asked.length > reads);
});

test("offline, Discover has no mixes and says so; back online, it builds them", async () => {
  const { discover, world } = setup();
  world.online = false;
  assert.deepEqual(await discover.mixes(), { status: "offline", mixes: [] });
  world.online = true;
  const read = await discover.mixes();
  assert.equal(read.status, "ok");
  assert.equal(read.mixes.length, 1);
});

test("the Magic Queue row is nine of the Library's songs, all of them when fewer", () => {
  const few = setup();
  assert.deepEqual([...few.discover.picks()].sort(), [1, 2, 3]);
  const many = setup({
    library: () => ({
      trackIds: Array.from({ length: 30 }, (_, n) => n + 1),
      artists: [],
    }),
  });
  const picks = many.discover.picks();
  assert.equal(picks.length, 9);
  assert.equal(new Set(picks).size, 9);
});

test("Genre mixes grow from tagged Library families and remain playable by id", async () => {
  const { discover } = setup({
    library: () => ({
      trackIds: [1, 2, 3, 4, 5],
      artists: [{ id: 1, name: "Daft Punk", songCount: 5 }],
      songs: Array.from({ length: 5 }, (_, n) => ({
        id: n + 1,
        title: `Local ${n}`,
        artist: "Daft Punk",
        artistIds: [1],
        durationMs: 200_000,
        addedAt: 0,
        genre: "Electronic",
      })),
    }),
  });
  const read = await discover.mixes();
  const genre = read.mixes.find((mix) => mix.id === "genre:electronic");
  assert.ok(genre, "five tagged songs qualify the Electronic family");
  assert.ok(genre.songs.length >= 10);
  assert.deepEqual([genre.row, genre.name], ["genre-mixes", "Electronic"]);
  assert.deepEqual(discover.mix(genre.id), genre);
});

test("Discover hides cached rows when offline or YT Music is off and recovers quietly", async () => {
  const state = { online: true, enabled: true };
  const { discover } = setup({ online: () => state.online, enabled: () => state.enabled });
  assert.equal((await discover.mixes()).mixes.length, 1);
  state.online = false;
  assert.deepEqual(await discover.mixes(), { status: "offline", mixes: [] });
  state.online = true;
  state.enabled = false;
  assert.deepEqual(await discover.mixes(), { status: "disabled", mixes: [] });
  state.enabled = true;
  assert.equal((await discover.mixes()).mixes.length, 1);
});

test("Discover settings reblend familiar songs without reading radios again", async () => {
  const { discover, asked } = setup({
    library: () => ({
      trackIds: [1, 2, 3, 4, 5],
      artists: [{ id: 1, name: "Daft Punk", songCount: 5 }],
      songs: Array.from({ length: 5 }, (_, n) => ({
        id: n + 1,
        title: `Local ${n}`,
        artist: "Daft Punk",
        artistIds: [1],
        durationMs: 200_000,
        addedAt: 0,
        genre: "Electronic",
      })),
    }),
  });
  await discover.mixes();
  const count = asked.length;
  discover.setSettings({ level: 5, faithfulness: 1, popularity: 5 });
  const allNew = await discover.mixes();
  assert.ok(allNew.mixes[0]!.songs.every((song) => song.source === "stream"));
  discover.setSettings({ level: 1, faithfulness: 1, popularity: 5 });
  const familiar = await discover.mixes();
  assert.ok(familiar.mixes[0]!.songs.some((song) => song.source === "library"));
  assert.equal(asked.length, count, "slider changes use the day's cached radios");
  assert.deepEqual(discover.settings(), { level: 1, faithfulness: 1, popularity: 5 });
});

test("a mix row Home doesn't show isn't built and reads no radio", async () => {
  const rows = { shown: ["magic-queue", "genre-mixes"] as const };
  const { discover, asked } = setup({ rows: () => rows.shown });
  assert.deepEqual(await discover.mixes(), { status: "ok", mixes: [] });
  assert.deepEqual(asked, [], "no tagged family and no Artist mixes: nothing to read");
  (rows as { shown: readonly string[] }).shown = ["artist-mixes"];
  const read = await discover.mixes();
  assert.deepEqual(
    read.mixes.map((mix) => [mix.row, mix.name]),
    [["artist-mixes", "Daft Punk"]],
  );
});

test("a mix's page lists its Library songs among its new ones, a song downloaded since as its file", async () => {
  const library = {
    trackIds: [1, 2, 3, 4, 5],
    artists: [{ id: 1, name: "Daft Punk", songCount: 5 }],
    songs: Array.from({ length: 5 }, (_, n) => ({
      id: n + 1,
      title: `Local ${n}`,
      artist: "Daft Punk",
      artistIds: [1],
      durationMs: 200_000,
      addedAt: 0,
      genre: "Electronic",
    })),
  };
  const downloaded = new Map<string, number>();
  const { discover } = setup({
    library: () => library,
    readSettings: () => ({ level: 1, faithfulness: 1, popularity: 5 }),
    track: (id) => library.trackIds.includes(id),
    find: (song) => downloaded.get(song.videoId) ?? null,
  });
  const mix = (await discover.mixes()).mixes[0]!;
  const firstNew = mix.songs.findIndex((song) => song.source === "stream");
  const familiar = mix.songs.flatMap((song) => (song.source === "library" ? [song.track.id] : []));
  assert.ok(firstNew >= 0 && familiar.length > 0, "the level blends Library songs in");

  // As last built: the Library songs where Core's blend put them, the new ones streamed.
  assert.deepEqual(
    discover.placed(mix.id),
    mix.songs.map((song) =>
      song.source === "stream" ? song : { source: "library", track: song.track.id },
    ),
  );

  // A new song downloaded since plays its file; a Library song gone from the Library is left out.
  const song = mix.songs[firstNew]!;
  assert.equal(song.source, "stream");
  if (song.source === "stream") downloaded.set(song.song.videoId, 77);
  library.trackIds = library.trackIds.filter((id) => id !== familiar[0]);
  const placed = discover.placed(mix.id)!;
  assert.equal(placed.length, mix.songs.length - 1);
  assert.ok(placed.some((found) => found.source === "library" && found.track === 77));
  assert.ok(!placed.some((found) => found.source === "library" && found.track === familiar[0]));

  assert.equal(discover.placed("artist:gone"), undefined);
});
