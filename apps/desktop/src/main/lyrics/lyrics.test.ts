import assert from "node:assert/strict";
import { test } from "node:test";
import { addTrack, openTestDatabase, type TestDatabase } from "@wave/client/testing";
import { keepSavedLyrics } from "@wave/client/db/savedLyrics";
import { ytTrackId, type LyricsSources, type NonDSongDetails } from "@wave/core";
import { sql } from "drizzle-orm";

import { createLyrics, LOOKUPS_SETTING } from "./lyrics.ts";

const DAY = 24 * 60 * 60 * 1000;

/** A Library with the synced-settings table `database.ts` makes. */
const library = async () => {
  const db = await openTestDatabase();
  db.run(
    sql`CREATE TABLE IF NOT EXISTS desktop_synced_preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
  );
  return db;
};

const NONE: LyricsSources = { embedded: null, sidecar: null };

/** LRCLIB's answer with one result for "Road" by Nick Drake. */
const lrclibRoad = (lyrics: { synced?: string; plain?: string }) => [
  {
    trackName: "Road",
    artistName: "Nick Drake",
    albumName: "Pink Moon",
    duration: 120,
    instrumental: false,
    plainLyrics: lyrics.plain ?? null,
    syncedLyrics: lyrics.synced ?? null,
  },
];

/** The service over [db] with each source scripted; `asked` records what was asked. */
const lyricsOver = (
  db: TestDatabase,
  sources: {
    readonly file?: (path: string) => Promise<LyricsSources>;
    readonly lrclib?: (url: string) => Promise<unknown>;
    readonly ytMusic?: (videoId: string) => Promise<string | null>;
    readonly songs?: Readonly<Record<string, NonDSongDetails>>;
    readonly ytMusicOn?: boolean;
    readonly now?: () => number;
  } = {},
) => {
  const asked: string[] = [];
  const service = createLyrics({
    db,
    readFile: (path) => {
      asked.push(`file ${path}`);
      return sources.file?.(path) ?? Promise.resolve(NONE);
    },
    lrclib: (url, headers) => {
      asked.push(`lrclib ${decodeURIComponent(new URL(url).search)}`);
      assert.ok(headers["User-Agent"]?.startsWith("Wave"));
      return sources.lrclib?.(url) ?? Promise.resolve([]);
    },
    ytMusic: (videoId) => {
      asked.push(`ytMusic ${videoId}`);
      return sources.ytMusic?.(videoId) ?? Promise.resolve(null);
    },
    ytSong: (videoId) => sources.songs?.[videoId],
    ytMusicOn: () => sources.ytMusicOn ?? true,
    now: sources.now ?? (() => 1_000),
  });
  return { service, asked };
};

const road = (db: TestDatabase) =>
  addTrack(db, { title: "Road", artist: "Nick Drake", album: "Pink Moon", durationMs: 120_000 });

test("a Library song's own lyrics show, and nothing is asked online", async () => {
  const db = await library();
  const id = road(db);
  const { service, asked } = lyricsOver(db, {
    file: () => Promise.resolve({ embedded: "Plain words", sidecar: "[00:01.00]Synced words" }),
  });
  assert.deepEqual(await service.song(String(id)), {
    kind: "synced",
    lines: [{ timeMs: 1000, text: "Synced words" }],
  });
  assert.deepEqual(asked, ["file /Music/Pink Moon/Road.mp3"]);
});

test("a Library song without lyrics is found on LRCLIB, and kept for the session", async () => {
  const db = await library();
  const id = road(db);
  const { service, asked } = lyricsOver(db, {
    lrclib: () => Promise.resolve(lrclibRoad({ synced: "[00:02.00]Found it" })),
  });
  const expected = { kind: "synced", lines: [{ timeMs: 2000, text: "Found it" }] };
  assert.deepEqual(await service.song(String(id)), expected);
  assert.deepEqual(await service.song(String(id)), expected);
  assert.deepEqual(asked, [
    "file /Music/Pink Moon/Road.mp3",
    "lrclib ?track_name=Road&artist_name=Nick Drake",
    "file /Music/Pink Moon/Road.mp3",
  ]);
});

test("a search that finds nothing is remembered for a week", async () => {
  const db = await library();
  const id = road(db);
  let now = 1_000;
  const { service, asked } = lyricsOver(db, { now: () => now });
  assert.deepEqual(await service.song(String(id)), { kind: "none" });
  now += 6 * DAY;
  assert.deepEqual(await service.song(String(id)), { kind: "none" });
  assert.equal(asked.filter((it) => it.startsWith("lrclib")).length, 1);
  now += 2 * DAY;
  await service.song(String(id));
  assert.equal(asked.filter((it) => it.startsWith("lrclib")).length, 2);
});

test("a source that can't be reached fails, and asking again searches again", async () => {
  const db = await library();
  const id = road(db);
  let reachable = false;
  const { service } = lyricsOver(db, {
    lrclib: () =>
      reachable
        ? Promise.resolve(lrclibRoad({ plain: "Line one\nLine two" }))
        : Promise.reject(new Error("offline")),
  });
  assert.deepEqual(await service.song(String(id)), { kind: "failed" });
  reachable = true;
  assert.deepEqual(await service.song(String(id)), {
    kind: "unsynced",
    lines: ["Line one", "Line two"],
  });
});

test("with Fix songs online off, nothing is asked online", async () => {
  const db = await library();
  const id = road(db);
  db.run(
    sql`INSERT INTO desktop_synced_preferences (key, value) VALUES (${LOOKUPS_SETTING}, 'off')`,
  );
  const { service, asked } = lyricsOver(db);
  assert.deepEqual(await service.song(String(id)), { kind: "none" });
  assert.deepEqual(await service.song(ytTrackId("4D7u5KF7SP8")), { kind: "none" });
  assert.deepEqual(asked, ["file /Music/Pink Moon/Road.mp3"]);
});

const getLucky: NonDSongDetails = {
  title: "Get Lucky",
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 248_000,
};

test("a YT Music song LRCLIB lacks gets YT Music's lyrics, saved against its video", async () => {
  const db = await library();
  const { service, asked } = lyricsOver(db, {
    songs: { "4D7u5KF7SP8": getLucky },
    ytMusic: () => Promise.resolve("Like the legend\r\nof the phoenix\r\n"),
  });
  const expected = { kind: "unsynced", lines: ["Like the legend", "of the phoenix"] };
  assert.deepEqual(await service.song(ytTrackId("4D7u5KF7SP8")), expected);
  assert.deepEqual(await service.song(ytTrackId("4D7u5KF7SP8")), expected);
  assert.deepEqual(asked, [
    "lrclib ?track_name=Get Lucky&artist_name=Daft Punk",
    "ytMusic 4D7u5KF7SP8",
  ]);
});

test("a YT Music song's saved lyrics show without asking, even with YT Music off", async () => {
  const db = await library();
  keepSavedLyrics(db, "4D7u5KF7SP8", {
    kind: "found",
    lyrics: { synced: true, text: "[00:03.00]Saved" },
  });
  const { service, asked } = lyricsOver(db, { ytMusicOn: false });
  assert.deepEqual(await service.song(ytTrackId("4D7u5KF7SP8")), {
    kind: "synced",
    lines: [{ timeMs: 3000, text: "Saved" }],
  });
  assert.deepEqual(asked, []);
});

test("a song nothing knows has no lyrics", async () => {
  const db = await library();
  const { service, asked } = lyricsOver(db);
  assert.deepEqual(await service.song("999"), { kind: "none" });
  assert.deepEqual(await service.song(ytTrackId("4D7u5KF7SP8")), { kind: "none" });
  assert.deepEqual(await service.song("nonsense"), { kind: "none" });
  assert.deepEqual(asked, []);
});

test("asking twice while a search runs makes one search", async () => {
  const db = await library();
  const id = road(db);
  let answer: (value: unknown) => void = () => undefined;
  const { service, asked } = lyricsOver(db, {
    lrclib: () => new Promise((resolve) => (answer = resolve)),
  });
  const first = service.song(String(id));
  const second = service.song(String(id));
  await new Promise((resolve) => setTimeout(resolve, 10));
  answer(lrclibRoad({ plain: "Once" }));
  assert.deepEqual(await first, await second);
  assert.equal(asked.filter((it) => it.startsWith("lrclib")).length, 1);
});
