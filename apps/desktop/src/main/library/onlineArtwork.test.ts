import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { addTrack, openTestDatabase } from "@wave/client/testing";
import { createLibraryArtwork } from "./onlineArtwork.ts";

type Fetch = typeof globalThis.fetch;

/** A Deezer that knows one album and one artist, and counts what it is asked. */
const deezer = () => {
  const asked: string[] = [];
  const fetch = (async (input) => {
    const url = String(input);
    asked.push(url);
    if (url.includes("/search/track"))
      return Response.json({
        data: [
          {
            id: 1,
            title: "Road",
            artist: { name: "Nick Drake" },
            album: {
              id: 2,
              title: "Pink Moon",
              cover_xl: "https://cdn-images.dzcdn.net/cover.jpg",
            },
          },
        ],
      });
    if (url.includes("/search/artist"))
      return Response.json({
        data: [
          {
            name: "Nick Drake",
            nb_fan: 10,
            picture_medium: "https://cdn-images.dzcdn.net/artist.jpg",
          },
        ],
      });
    return new Response(new Uint8Array([255, 216, 255]));
  }) as Fetch;
  return { asked, fetch };
};

const offline = (async () => {
  throw new Error("offline");
}) as Fetch;

const codec = () => ({ thumb: Buffer.from([255, 216, 1]), medium: Buffer.from([255, 216, 2]) });
const THUMB = "data:image/jpeg;base64,/9gB";
const LARGE = "data:image/jpeg;base64,/9gC";

const library = async () => {
  const db = await openTestDatabase();
  const song = addTrack(db, { title: "Road", artist: "Nick Drake", album: "Pink Moon" });
  db.run(sql`UPDATE tracks SET path=NULL WHERE id=${song}`);
  const row = db.get<{ album: number; artist: number }>(
    sql`SELECT album_id AS album, artist_id AS artist FROM tracks WHERE id=${song}`,
  )!;
  const directory = await mkdtemp(join(tmpdir(), "wave-artwork-"));
  return {
    db,
    song,
    ...row,
    directory,
    done: () => rm(directory, { recursive: true, force: true }),
  };
};

test("a missing song and its album share one cover, kept on disk for the next start", async () => {
  const { db, song, album, directory, done } = await library();
  const service = deezer();
  try {
    const first = createLibraryArtwork({ db, directory, fetch: service.fetch, process: codec });
    assert.equal(await first("song", song, false), THUMB);
    assert.equal(service.asked.length, 2);
    const restarted = createLibraryArtwork({ db, directory, fetch: offline, process: codec });
    assert.equal(await restarted("album", album, true), LARGE);
    assert.equal(await first("album", album, false), THUMB);
    assert.equal(service.asked.length, 2);
  } finally {
    await done();
  }
});

test("an artist shows the photo found online", async () => {
  const { db, artist, directory, done } = await library();
  const service = deezer();
  try {
    const cover = createLibraryArtwork({ db, directory, fetch: service.fetch, process: codec });
    assert.equal(await cover("artist", artist, true), LARGE);
    assert.equal(await cover("artist", artist, false), THUMB);
    assert.equal(service.asked.filter((url) => url.includes("/search/artist")).length, 1);
  } finally {
    await done();
  }
});

test("with no network the placeholder stays, and a failure isn't asked again at once", async () => {
  const { db, song, album, artist, directory, done } = await library();
  let requests = 0;
  const fetch = (async () => {
    requests++;
    throw new Error("offline");
  }) as Fetch;
  try {
    const cover = createLibraryArtwork({ db, directory, fetch, process: codec });
    assert.equal(await cover("song", song, false), null);
    assert.equal(await cover("album", album, true), null);
    assert.equal(await cover("artist", artist, false), null);
    assert.equal(await cover("artist", artist, false), null);
    assert.equal(requests, 2);
  } finally {
    await done();
  }
});

test("each kind obeys its Settings switch", async () => {
  const { db, song, artist, directory, done } = await library();
  const service = deezer();
  try {
    const cover = createLibraryArtwork({
      db,
      directory,
      fetch: service.fetch,
      process: codec,
      coversEnabled: () => false,
      photosEnabled: () => false,
    });
    assert.equal(await cover("song", song, false), null);
    assert.equal(await cover("artist", artist, false), null);
    assert.deepEqual(service.asked, []);
  } finally {
    await done();
  }
});

test("a song with a file, or with a cover of its own, is never looked up", async () => {
  const { db, directory, done } = await library();
  const service = deezer();
  const local = addTrack(db, { title: "Here", artist: "Nick Drake", album: "Bryter Layter" });
  try {
    const cover = createLibraryArtwork({ db, directory, fetch: service.fetch, process: codec });
    assert.equal(await cover("song", local, false), null);
    assert.equal(await cover("song", 9999, false), null);
    assert.deepEqual(service.asked, []);
  } finally {
    await done();
  }
});

test("songs without an album don't share a cover", async () => {
  const { db, directory, done } = await library();
  const service = deezer();
  const loose = addTrack(db, { title: "Road", artist: "Nick Drake", album: "Unknown Album" });
  const other = addTrack(db, { title: "Elsewhere", artist: "Nobody", album: "Unknown Album" });
  db.run(sql`UPDATE tracks SET path=NULL WHERE id IN (${loose}, ${other})`);
  try {
    const cover = createLibraryArtwork({ db, directory, fetch: service.fetch, process: codec });
    assert.equal(await cover("song", loose, false), THUMB);
    assert.equal(await cover("song", other, false), null);
  } finally {
    await done();
  }
});

test("a missing song with a video id takes its video's album cover, as a phone download does", async () => {
  const { db, song, album, directory, done } = await library();
  const service = deezer();
  db.run(sql`UPDATE tracks SET video_id='abcdefghijk' WHERE id=${song}`);
  const covers: string[] = [];
  const videoCover = async (videoId: string) => {
    covers.push(videoId);
    return "https://lh3.googleusercontent.com/album=w120-h120";
  };
  try {
    const cover = createLibraryArtwork({
      db,
      directory,
      fetch: service.fetch,
      process: codec,
      videoCover,
      ytMusicOn: () => true,
    });
    assert.equal(await cover("album", album, false), THUMB);
    assert.deepEqual(covers, ["abcdefghijk"]);
    assert.equal(service.asked.filter((url) => url.includes("/search/")).length, 0);
    assert.equal(service.asked.length, 1);
    assert.match(service.asked[0]!, /^https:\/\/lh3\.googleusercontent\.com\/album=/);
  } finally {
    await done();
  }
});

test("with YT Music off, or no album cover for the video, Deezer finds the cover", async () => {
  const { db, song, directory, done } = await library();
  const service = deezer();
  db.run(sql`UPDATE tracks SET video_id='abcdefghijk' WHERE id=${song}`);
  let asked = 0;
  try {
    const cover = createLibraryArtwork({
      db,
      directory,
      fetch: service.fetch,
      process: codec,
      videoCover: async () => {
        asked++;
        return null;
      },
      ytMusicOn: () => false,
    });
    assert.equal(await cover("song", song, false), THUMB);
    assert.equal(asked, 0);
    assert.equal(service.asked.filter((url) => url.includes("/search/track")).length, 1);
  } finally {
    await done();
  }
});

test("with both sources switched off nothing is asked and nothing is remembered", async () => {
  const { db, song, directory, done } = await library();
  const service = deezer();
  try {
    const off = createLibraryArtwork({
      db,
      directory,
      fetch: service.fetch,
      process: codec,
      coversEnabled: () => false,
    });
    assert.equal(await off("song", song, false), null);
    const on = createLibraryArtwork({ db, directory, fetch: service.fetch, process: codec });
    assert.equal(await on("song", song, false), THUMB);
  } finally {
    await done();
  }
});
