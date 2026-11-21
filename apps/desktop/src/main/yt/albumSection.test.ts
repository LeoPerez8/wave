import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import type { YtAlbumSong, YtArtistAlbum, YtArtistPage } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../database.ts";
import { browseLibrary } from "../library/browse.ts";
import { createAlbumSection, type AlbumSectionDeps } from "./albumSection.ts";
import { createArtistSection } from "./artistSection.ts";
import type { YtAlbumRead } from "./ytPages.ts";

/** Runs [use] over a desktop Library file, as main opens it. */
const inLibrary = async (use: (db: TestDatabase) => Promise<void>): Promise<void> => {
  const folder = mkdtempSync(join(tmpdir(), "wave-album-section-"));
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = (yield* Database) as unknown as TestDatabase;
        yield* Effect.promise(() => use(db));
      }).pipe(Effect.provide(libraryLayer(join(folder, "wave.db")))),
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

const song = (videoId: string, title: string): YtAlbumSong => ({
  videoId,
  title,
  artists: ["Portishead"],
  album: "Dummy",
  albumId: "MPREdummy",
  durationMs: 240_000,
  artworkUrl: null,
  explicit: false,
});

const DUMMY: YtArtistAlbum = {
  kind: "album",
  browseId: "MPREdummy",
  title: "Dummy",
  artists: ["Portishead"],
  year: 1994,
  artworkUrl: null,
};

const page: YtArtistPage<YtAlbumSong> = {
  name: "Portishead",
  songs: [song("sourtimes1", "Sour Times")],
  albums: [DUMMY],
  singles: [],
  allSongs: [song("sourtimes1", "Sour Times")],
};

/** Dummy's release: Mysterons and Glory Box are the Library's, Sour Times and Roads aren't. */
const release: YtAlbumRead = {
  status: "ok",
  album: {
    title: "Dummy",
    artists: ["Portishead"],
    year: 1994,
    artworkUrl: null,
    songs: [
      song("mysterons1", "Mysterons"),
      song("sourtimes1", "Sour Times"),
      song("roads00001", "Roads"),
      song("glorybox01", "Glory Box"),
    ],
  },
};

/** Dummy in the Library: its first and last songs. */
const seedDummy = (db: TestDatabase): number => {
  addTrack(db, { title: "Mysterons", artist: "Portishead", album: "Dummy", durationMs: 240_000 });
  addTrack(db, { title: "Glory Box", artist: "Portishead", album: "Dummy", durationMs: 240_000 });
  return browseLibrary(db, { kind: "albums" }, 0, 10).items.find((row) => row.title === "Dummy")!
    .id;
};

const sectionOver = (db: TestDatabase, change: Partial<AlbumSectionDeps> = {}) => {
  const asked: string[] = [];
  const online = change.online ?? (() => true);
  const artist = createArtistSection({
    db,
    enabled: () => true,
    online,
    always: () => false,
    now: () => 1_000_000_000_000,
    keep: () => {},
    search: async (query) => {
      asked.push(`search:${query}`);
      return [{ name: "Portishead", browseId: "UCportishead", audience: 1, artworkUrl: null }];
    },
    page: async (browseId) => {
      asked.push(`page:${browseId}`);
      return page;
    },
  });
  const section = createAlbumSection({
    db,
    enabled: () => true,
    online,
    always: () => false,
    now: () => 1_000_000_000_000,
    artist,
    release: async (browseId) => {
      asked.push(`release:${browseId}`);
      return release;
    },
    ...change,
  });
  return { section, asked };
};

/** Asks what the section waits for until it waits for nothing. */
const settle = async (section: ReturnType<typeof sectionOver>["section"], id: number) => {
  for (let i = 0; i < 5 && section.view(id, "online")?.asks; i++)
    await section.ask(id, "online", false);
};

test("the album opens on Library and asks YouTube Music nothing", () =>
  inLibrary(async (db) => {
    const id = seedDummy(db);
    const { section, asked } = sectionOver(db);

    const view = section.view(id, null)!;

    assert.equal(view.toggle, "library");
    assert.equal(view.asks, false);
    assert.equal(view.tracks, null);
    assert.deepEqual(asked, []);
    assert.equal(browseLibrary(db, { kind: "album", id }, 0, 10).discs, undefined, "one disc");
  }));

test("Online joins the release's other songs among the Library's, each Library song once", () =>
  inLibrary(async (db) => {
    const id = seedDummy(db);
    const { section, asked } = sectionOver(db);

    assert.equal(section.view(id, "online")!.asks, true);
    await settle(section, id);
    const view = section.view(id, "online")!;

    assert.deepEqual(asked, ["search:Portishead", "page:UCportishead", "release:MPREdummy"]);
    assert.equal(view.note, null);
    assert.equal(view.release, "MPREdummy");
    assert.deepEqual(
      view.tracks!.map((row) => [row.title, row.videoId === undefined, row.trackNumber]),
      [
        ["Mysterons", true],
        ["Sour Times", false],
        ["Roads", false],
        ["Glory Box", true],
      ].map(([title, library], index) => [title, library, index + 1]),
    );
    assert.ok(view.tracks!.filter((row) => row.videoId === undefined).every((row) => row.id > 0));

    // Play plays the whole album in its order.
    const ids = section.queue(id, "online");
    assert.equal(ids.length, 4);
    assert.deepEqual(ids.slice(1, 3), ["yt:sourtimes1", "yt:roads00001"]);

    // Library shows the album as it is again, with nothing asked.
    asked.length = 0;
    assert.equal(section.view(id, "library")!.tracks, null);
    assert.equal(section.queue(id, "library").length, 2);
    assert.deepEqual(asked, []);
  }));

test("offline, Online shows the quiet line and asks nothing", () =>
  inLibrary(async (db) => {
    const id = seedDummy(db);
    const { section, asked } = sectionOver(db, { online: () => false });

    const view = section.view(id, "online")!;

    assert.equal(view.note, "offline");
    assert.equal(view.asks, false);
    assert.equal(view.tracks, null);
    assert.deepEqual(asked, []);
  }));

test("with YT Music off the album has no section", () =>
  inLibrary(async (db) => {
    const id = seedDummy(db);
    const { section } = sectionOver(db, { enabled: () => false });

    assert.equal(section.view(id, "online"), null);
  }));

test("a release page that got no answer is asked again when Online is picked again", () =>
  inLibrary(async (db) => {
    const id = seedDummy(db);
    let answer: YtAlbumRead = { status: "failed", album: null };
    const { section, asked } = sectionOver(db, {
      release: async (browseId) => {
        asked.push(`release:${browseId}`);
        return answer;
      },
    });
    await settle(section, id);
    const failed = section.view(id, "online")!;
    assert.equal(failed.note, "failed");
    assert.equal(failed.retry, "release");

    answer = release;
    await section.ask(id, "online", true);

    assert.equal(section.view(id, "online")!.tracks!.length, 4);
    assert.equal(asked.filter((ask) => ask.startsWith("release:")).length, 2);
  }));

test("a two-disc album's tracklist carries a head before each disc", () =>
  inLibrary(async (db) => {
    addTrack(db, { title: "One", artist: "Portishead", album: "Live", trackNumber: 1 });
    addTrack(db, { title: "Two", artist: "Portishead", album: "Live", trackNumber: 1 });
    db.run(sql`UPDATE tracks SET disc_number = 2 WHERE title = 'Two'`);
    const id = browseLibrary(db, { kind: "albums" }, 0, 10).items[0]!.id;

    const shown = browseLibrary(db, { kind: "album", id }, 0, 10);

    assert.deepEqual(
      shown.items.map((row) => row.title),
      ["One", "Two"],
    );
    assert.deepEqual(shown.discs, [
      { disc: 1, at: 0 },
      { disc: 2, at: 1 },
    ]);
  }));
