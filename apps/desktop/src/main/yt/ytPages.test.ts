import assert from "node:assert/strict";
import { test } from "node:test";
import type { YtAlbumSong } from "@wave/core";
import { createYtPages, type YtPagesCall } from "./ytPages.ts";

const songOf = (videoId: string, title = `Song ${videoId}`, artists = ["Daft Punk"]) => ({
  videoId,
  title,
  artists,
  album: "Random Access Memories",
  albumId: "MPREb_ram",
  durationMs: 240_000,
  artworkUrl: "https://lh3.googleusercontent.com/cover=w120-h120",
  explicit: false,
  videoType: "MUSIC_VIDEO_TYPE_ATV",
});

const coded = (code: string) => Object.assign(new Error("no"), { code });

/** YtPages over a JVM that answers with `answer`, with YT Music on unless `on` says otherwise. */
const setup = (answer: (method: string, params: unknown) => unknown, on = true) => {
  const calls: string[] = [];
  const kept: YtAlbumSong[] = [];
  const call: YtPagesCall = async (method, params) => {
    calls.push(`${method} ${JSON.stringify(params)}`);
    return answer(method, params) as never;
  };
  const pages = createYtPages({ call, keep: (songs) => kept.push(...songs), enabled: () => on });
  return { pages, calls, kept };
};

test("an artist page comes back with its songs, albums and singles, and its songs can stream", async () => {
  const { pages, kept } = setup(() => ({
    name: "Daft Punk",
    artworkUrl: "https://lh3.googleusercontent.com/daft",
    songs: [songOf("khnokW3Mw24", "Instant Crush"), { title: "no video id" }],
    albums: [
      {
        kind: "album",
        browseId: "MPREb_ram",
        title: "Random Access Memories",
        artists: ["Daft Punk"],
        year: 2013,
        artworkUrl: null,
      },
      { kind: "album", title: "no browse id" },
    ],
    singles: [],
    similar: [{ name: "Justice", browseId: "UCjustice", audience: 536_000, artworkUrl: null }],
  }));
  const read = await pages.artist("UC_kRDKYrUlrbtrSiyu5Tflg");
  assert.equal(read.status, "ok");
  assert.equal(read.page?.name, "Daft Punk");
  assert.deepEqual(
    read.page?.songs.map((song) => song.title),
    ["Instant Crush"],
  );
  assert.deepEqual(
    read.page?.albums.map((album) => album.title),
    ["Random Access Memories"],
  );
  assert.deepEqual(
    read.page?.similar?.map((artist) => artist.name),
    ["Justice"],
  );
  assert.deepEqual(
    kept.map((song) => song.videoId),
    ["khnokW3Mw24"],
  );
});

test("offline, a page says so and has nothing; with YT Music off, nothing is asked", async () => {
  const offline = setup(() => {
    throw coded("ERR_YT_OFFLINE");
  });
  assert.deepEqual(await offline.pages.artist("UCx"), { status: "offline", page: null });
  const off = setup(() => songOf("x"), false);
  assert.deepEqual(await off.pages.songRadio("khnokW3Mw24"), {
    status: "disabled",
    songs: [],
    continuation: null,
  });
  assert.deepEqual(off.calls, []);
});

test("an artist is found by their exact name, the most followed of namesakes", async () => {
  const { pages } = setup(() => [
    { name: "Daft Punk Tribute", browseId: "UCtribute", audience: 9_000_000 },
    { name: "Daft Punk", browseId: "UCsmall", audience: 10 },
    { name: "Daft Punk", browseId: "UCdaftpunk", audience: 9_000 },
  ]);
  assert.deepEqual(await pages.findArtist("Daft Punk"), {
    status: "ok",
    browseId: "UCdaftpunk",
  });
  assert.deepEqual(await pages.findArtist("Unknown Artist"), { status: "ok", browseId: null });
});

test("a radio page leaves out music videos and keeps where it goes on", async () => {
  const { pages, kept } = setup(() => ({
    songs: [
      { ...songOf("aaaaaaaaaaa"), video: false },
      { ...songOf("bbbbbbbbbbb"), video: true },
    ],
    continuation: "next-page",
  }));
  const radio = await pages.songRadio("khnokW3Mw24");
  assert.deepEqual(
    radio.songs.map((song) => song.videoId),
    ["aaaaaaaaaaa"],
  );
  assert.equal(radio.continuation, "next-page");
  assert.deepEqual(
    kept.map((song) => song.videoId),
    ["aaaaaaaaaaa"],
  );
});

test("Related leaves out the song playing in any version", async () => {
  const { pages } = setup(() => ({
    songs: [
      songOf("aaaaaaaaaaa", "Get Lucky (Live)"),
      songOf("ccccccccccc", "Killer Queen", ["Queen"]),
    ],
    artists: [{ name: "Justice", browseId: "UCjustice", audience: null }],
  }));
  const related = await pages.related("5NV6Rdv1a3I", { title: "Get Lucky", artist: "Daft Punk" });
  assert.deepEqual(
    related.songs.map((song) => song.title),
    ["Killer Queen"],
  );
  assert.deepEqual(
    related.artists.map((artist) => artist.browseId),
    ["UCjustice"],
  );
});

test("a song without a video id is found by its title and artists, the same recording only", async () => {
  const { pages, calls } = setup(() => ({
    songs: [
      songOf("aaaaaaaaaaa", "Get Lucky (Remix)"),
      { ...songOf("bbbbbbbbbbb", "Get Lucky"), durationMs: 248_000 },
    ],
  }));
  assert.equal(
    await pages.findSong({ title: "Get Lucky", artists: ["Daft Punk"], durationMs: 248_000 }),
    "bbbbbbbbbbb",
  );
  assert.deepEqual(calls, [`search ${JSON.stringify({ query: "Get Lucky Daft Punk" })}`]);
});

test("an artist read whole has every song of theirs, from the Songs shelf's playlist", async () => {
  const { pages, calls, kept } = setup((method, params) => {
    if (method === "artist")
      return {
        name: "Daft Punk",
        songs: [songOf("khnokW3Mw24", "Instant Crush")],
        songsPlaylistId: "OLAK5uy_all",
        albums: [],
        singles: [],
      };
    if (method === "playlist")
      return {
        title: "Daft Punk songs",
        songs: [songOf("khnokW3Mw24", "Instant Crush")],
        continuation: "next",
      };
    if (method === "playlistMore" && (params as { continuation: string }).continuation === "next")
      return { songs: [songOf("5NV6Rdv1a3I", "Get Lucky")], continuation: null };
    throw new Error(`unexpected ${method}`);
  });
  const page = await pages.artistWhole("UC_kRDKYrUlrbtrSiyu5Tflg");
  assert.deepEqual(
    page.allSongs?.map((song) => song.title),
    ["Instant Crush", "Get Lucky"],
  );
  assert.equal(page.allSongsCut, undefined);
  assert.deepEqual(calls, [
    'artist {"browseId":"UC_kRDKYrUlrbtrSiyu5Tflg"}',
    'playlist {"playlistId":"OLAK5uy_all"}',
    'playlistMore {"continuation":"next"}',
  ]);
  assert.ok(
    kept.some((song) => song.videoId === "5NV6Rdv1a3I"),
    "its songs can stream",
  );
});

test("an artist read whole without a songs playlist keeps its top songs; offline it fails", async () => {
  const whole = setup(() => ({ name: "Daft Punk", songs: [songOf("khnokW3Mw24")], albums: [] }));
  assert.deepEqual(
    (await whole.pages.artistWhole("UCdaft")).allSongs?.map((song) => song.videoId),
    ["khnokW3Mw24"],
  );
  const offline = setup((method) => {
    if (method === "artist")
      return { name: "Daft Punk", songs: [], songsPlaylistId: "OLAK5uy_all", albums: [] };
    throw coded("ERR_YT_OFFLINE");
  });
  await assert.rejects(offline.pages.artistWhole("UCdaft"), { code: "ERR_YT_OFFLINE" });
  const off = setup(() => ({}), false);
  await assert.rejects(off.pages.artistWhole("UCdaft"), { code: "ERR_YT_DISABLED" });
});

test("an Artists search lists the artists it found", async () => {
  const { pages, calls } = setup(() => [
    { name: "Justice", browseId: "UCjustice", audience: 536_000, artworkUrl: null },
    { name: "no browse id" },
  ]);
  assert.deepEqual(
    (await pages.searchArtists("Justice")).map((artist) => artist.browseId),
    ["UCjustice"],
  );
  assert.deepEqual(calls, ['searchArtists {"query":"Justice"}']);
});

test("Search's artists and albums come from one Artists and one Albums search, checked", async () => {
  const { pages, calls } = setup((method) =>
    method === "searchArtists"
      ? [
          { name: "Daft Punk", browseId: "UCdaft", audience: 9_000_000, artworkUrl: null },
          { name: "no browse id" },
        ]
      : [
          { kind: "album", browseId: "MPREb_ram", title: "Random Access Memories" },
          { kind: "album", browseId: "../x", title: "a bad id" },
        ],
  );
  const read = await pages.catalog("daft punk");
  assert.equal(read.status, "ok");
  assert.deepEqual(
    read.artists.map((artist) => artist.browseId),
    ["UCdaft"],
  );
  assert.deepEqual(
    read.albums.map((album) => album.browseId),
    ["MPREb_ram"],
  );
  assert.deepEqual(calls.sort(), [
    'searchAlbums {"query":"daft punk"}',
    'searchArtists {"query":"daft punk"}',
  ]);
});

test("Search's artists and albums are nothing offline, and nothing is asked with YT Music off", async () => {
  const offline = setup(() => {
    throw coded("ERR_YT_OFFLINE");
  });
  assert.deepEqual(await offline.pages.catalog("daft punk"), {
    status: "offline",
    artists: [],
    albums: [],
  });
  const off = setup(() => [], false);
  assert.equal((await off.pages.catalog("daft punk")).status, "disabled");
  assert.deepEqual(off.calls, []);
});

test("an album page's songs carry the album, so a download saves them as one album; its last read is kept", async () => {
  const { pages, kept } = setup(() => ({
    title: "Random Access Memories",
    artists: ["Daft Punk"],
    year: 2013,
    artworkUrl: "https://lh3.googleusercontent.com/ram=w544-h544",
    tracks: [
      { videoId: "khnokW3Mw24", title: "Give Life Back to Music", artists: ["Daft Punk"] },
      { videoId: "5NV6Rdv1a3I", title: "Get Lucky", artists: ["Daft Punk"] },
    ],
  }));
  assert.equal(pages.albumSongs("MPREb_ram"), null);
  const read = await pages.album("MPREb_ram");
  assert.deepEqual(
    read.album?.songs.map((song) => [song.videoId, song.album, song.albumId, song.artworkUrl]),
    [
      [
        "khnokW3Mw24",
        "Random Access Memories",
        "MPREb_ram",
        "https://lh3.googleusercontent.com/ram=w544-h544",
      ],
      [
        "5NV6Rdv1a3I",
        "Random Access Memories",
        "MPREb_ram",
        "https://lh3.googleusercontent.com/ram=w544-h544",
      ],
    ],
  );
  assert.deepEqual(
    kept.map((song) => song.albumId),
    ["MPREb_ram", "MPREb_ram"],
  );
  assert.equal(pages.albumSongs("MPREb_ram")?.title, "Random Access Memories");
  assert.deepEqual(
    pages.albumSongs("MPREb_ram")?.songs.map((song) => song.videoId),
    ["khnokW3Mw24", "5NV6Rdv1a3I"],
  );
});
