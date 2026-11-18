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
  assert.ok(mix.songs.every((found) => !found.videoId.startsWith("known")));
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
