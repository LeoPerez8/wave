import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import type { YtAlbumSong, YtArtistAlbum, YtArtistCandidate, YtArtistPage } from "@wave/core";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../database.ts";
import type { LibraryDatabase } from "@wave/client/db/database";
import { browseLibrary } from "../library/browse.ts";
import { toggleBrowseSort } from "../library/browseSort.ts";
import { createArtistSection, type ArtistSectionDeps } from "./artistSection.ts";

/** Runs [use] over a desktop Library file, as main opens it. */
const inLibrary = async (use: (db: TestDatabase) => Promise<void>): Promise<void> => {
  const folder = mkdtempSync(join(tmpdir(), "wave-artist-section-"));
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

const song = (videoId: string, title: string, album: string): YtAlbumSong => ({
  videoId,
  title,
  artists: ["Portishead"],
  album,
  albumId: null,
  durationMs: 240_000,
  artworkUrl: null,
  explicit: false,
});

const release = (browseId: string, title: string, year: number): YtArtistAlbum => ({
  kind: "album",
  browseId,
  title,
  artists: ["Portishead"],
  year,
  artworkUrl: null,
});

const PORTISHEAD: YtArtistCandidate = {
  name: "Portishead",
  browseId: "UCportishead",
  audience: 1_000_000,
  artworkUrl: null,
};

/** Portishead's page: Glory Box is in the Library, Roads and Machine Gun aren't. */
const page: YtArtistPage<YtAlbumSong> = {
  name: "Portishead",
  songs: [song("glorybox01", "Glory Box", "Dummy")],
  albums: [release("MPREdummy", "Dummy", 1994), release("MPREthird", "Third", 2008)],
  singles: [release("MPREsingle", "Chase the Tear", 2009)],
  allSongs: [
    song("glorybox01", "Glory Box", "Dummy"),
    song("roads00001", "Roads", "Dummy"),
    song("machinegun", "Machine Gun", "Third"),
  ],
};

/** A section over [db] whose YouTube Music answers from [answers], counting what it's asked. */
const sectionOver = (db: TestDatabase, change: Partial<ArtistSectionDeps> = {}) => {
  const asked: string[] = [];
  const kept: string[] = [];
  const section = createArtistSection({
    db,
    enabled: () => true,
    online: () => true,
    always: () => false,
    now: () => 1_000_000_000_000,
    keep: (songs) => kept.push(...songs.map((s) => s.videoId)),
    search: async (query) => {
      asked.push(`search:${query}`);
      return [PORTISHEAD];
    },
    page: async (browseId) => {
      asked.push(`page:${browseId}`);
      return page;
    },
    ...change,
  });
  return { section, asked, kept };
};

const seedPortishead = (db: TestDatabase): number => {
  addTrack(db, { title: "Glory Box", artist: "Portishead", album: "Dummy", durationMs: 240_000 });
  return browseLibrary(db, { kind: "artists" }, 0, 10).items.find(
    (row) => row.title === "Portishead",
  )!.id;
};

test("the page opens on Library and asks YouTube Music nothing", () =>
  inLibrary(async (db) => {
    const id = seedPortishead(db);
    const { section, asked } = sectionOver(db);

    const view = section.view(id, null, 0, 50)!;

    assert.equal(view.toggle, "library");
    assert.equal(view.asks, false);
    assert.equal(view.songs.total, 0);
    assert.deepEqual(asked, []);
  }));

test("Online shows every song and release of the artist the Library lacks, saved for next time", () =>
  inLibrary(async (db) => {
    const id = seedPortishead(db);
    const { section, asked, kept } = sectionOver(db);

    assert.equal(section.view(id, "online", 0, 50)!.asks, true);
    const asking = section.ask(id);
    assert.equal(section.view(id, "online", 0, 50)!.note, "loading");
    await asking;
    const view = section.view(id, "online", 0, 50)!;

    assert.deepEqual(asked, ["search:Portishead", "page:UCportishead"]);
    assert.equal(view.toggle, "online");
    assert.equal(view.note, null);
    assert.equal(view.asks, false);
    assert.deepEqual(
      view.songs.items.map((row) => [row.title, row.videoId]),
      [
        ["Glory Box", undefined],
        ["Roads", "roads00001"],
        ["Machine Gun", "machinegun"],
      ],
    );
    assert.deepEqual(
      view.albums.map((album) => album.title),
      ["Third"],
      "Dummy is the Library's album already",
    );
    assert.deepEqual(
      view.singles.map((album) => album.title),
      ["Chase the Tear"],
    );
    assert.ok(kept.includes("roads00001"), "the songs it shows can stream");

    // Opened again, the saved answer stands: Online, and nothing is asked.
    const again = sectionOver(db);
    const reopened = again.section.view(id, null, 0, 1)!;
    assert.equal(reopened.toggle, "online");
    assert.deepEqual(
      reopened.songs.items.map((row) => row.title),
      ["Glory Box"],
    );
    assert.equal(reopened.songs.total, 3);
    assert.deepEqual(again.asked, []);
    assert.ok(again.kept.includes("machinegun"));
  }));

test("Library hides what YouTube Music added, with no request", () =>
  inLibrary(async (db) => {
    const id = seedPortishead(db);
    const { section, asked } = sectionOver(db);
    await section.ask(id);
    asked.length = 0;

    const view = section.view(id, "library", 0, 50)!;

    assert.equal(view.toggle, "library");
    assert.equal(view.songs.total, 0);
    assert.deepEqual(view.albums, []);
    assert.deepEqual(asked, []);
  }));

test("offline, Online shows the quiet line and saves nothing", () =>
  inLibrary(async (db) => {
    const id = seedPortishead(db);
    const { section, asked } = sectionOver(db, { online: () => false });

    await section.ask(id);
    const view = section.view(id, "online", 0, 50)!;

    assert.equal(view.note, "offline");
    assert.equal(view.asks, false, "it waits for Online to be picked again");
    assert.deepEqual(asked, []);
    assert.equal(sectionOver(db).section.view(id, null, 0, 50)!.toggle, "library");
  }));

test("an artist YouTube Music doesn't have shows Not found online", () =>
  inLibrary(async (db) => {
    const id = seedPortishead(db);
    const { section } = sectionOver(db, { search: async () => [] });

    await section.ask(id);

    assert.equal(section.view(id, "online", 0, 50)!.note, "notFound");
  }));

test("with YT Music off, or for Unknown Artist, the page has no section", () =>
  inLibrary(async (db) => {
    const id = seedPortishead(db);
    addTrack(db, { title: "Untitled", artist: "Unknown Artist" });
    const unknown = browseLibrary(db, { kind: "artists" }, 0, 10).items.find(
      (row) => row.title === "Unknown Artist",
    )!.id;

    assert.equal(sectionOver(db, { enabled: () => false }).section.view(id, null, 0, 50), null);
    assert.equal(sectionOver(db).section.view(unknown, null, 0, 50), null);
  }));

test("with Online the songs are one Popular list in YouTube Music's order, and Play follows it", () =>
  inLibrary(async (db) => {
    // Sour Times isn't on YouTube Music's list; Machine Gun is its third song and a Library file.
    addTrack(db, {
      title: "Sour Times",
      artist: "Portishead",
      album: "Dummy",
      durationMs: 250_000,
    });
    addTrack(db, {
      title: "Machine Gun",
      artist: "Portishead",
      album: "Third",
      durationMs: 240_000,
    });
    const id = seedPortishead(db);
    const { section } = sectionOver(db);
    const libraryIds = new Map(
      browseLibrary(db, { kind: "artist", id }, 0, 10).items.map((row) => [row.title, row.id]),
    );
    const inLibraryOrder = browseLibrary(db, { kind: "artist", id }, 0, 10).items.map((row) =>
      String(row.id),
    );

    const before = section.view(id, "library", 0, 50)!;
    assert.equal(before.popular, false);
    assert.equal(before.songs.total, 0);
    assert.deepEqual(section.queue(id, "library"), { ids: inLibraryOrder, listStart: 3 });

    await section.ask(id);
    const view = section.view(id, "online", 0, 50)!;

    assert.equal(view.popular, true);
    assert.deepEqual(
      view.songs.items.map((row) => [row.title, row.videoId ?? row.id]),
      [
        ["Glory Box", libraryIds.get("Glory Box")],
        ["Roads", "roads00001"],
        ["Machine Gun", libraryIds.get("Machine Gun")],
        ["Sour Times", libraryIds.get("Sour Times")],
      ],
    );
    assert.equal(view.ranked, 3, "Sour Times follows the ranked songs with no rank");
    assert.deepEqual(section.queue(id, "online"), {
      ids: [
        String(libraryIds.get("Glory Box")),
        "yt:roads00001",
        String(libraryIds.get("Machine Gun")),
        String(libraryIds.get("Sour Times")),
      ],
      listStart: 0,
    });
    assert.deepEqual(section.queue(id, "library"), { ids: inLibraryOrder, listStart: 3 });
  }));

test("with Online and another sort, the Library's songs keep that sort and the rest follow", () =>
  inLibrary(async (db) => {
    addTrack(db, {
      title: "Sour Times",
      artist: "Portishead",
      album: "Dummy",
      durationMs: 250_000,
    });
    const id = seedPortishead(db);
    const { section } = sectionOver(db);
    await section.ask(id);
    assert.equal(section.view(id, "online", 0, 50)!.popular, true);

    // Song name, Z to A: two clicks on the Title header.
    toggleBrowseSort(db as unknown as LibraryDatabase, "artist", "title");
    toggleBrowseSort(db as unknown as LibraryDatabase, "artist", "title");
    const view = section.view(id, "online", 0, 50)!;
    assert.equal(view.popular, false);
    assert.deepEqual(
      view.songs.items.map((row) => row.title),
      ["Roads", "Machine Gun"],
    );
    const sorted = browseLibrary(db, { kind: "artist", id }, 0, 10).items;
    assert.deepEqual(
      sorted.map((row) => row.title),
      ["Sour Times", "Glory Box"],
    );
    assert.deepEqual(section.queue(id, "online"), {
      ids: [...sorted.map((row) => String(row.id)), "yt:roads00001", "yt:machinegun"],
      listStart: 2,
    });
  }));

test("the artist page's songs keep Popular order whatever the sort, and its Play follows them", () =>
  inLibrary(async (db) => {
    for (const [title, album] of [
      ["Sour Times", "Dummy"],
      ["Machine Gun", "Third"],
    ] as const)
      addTrack(db, { title, artist: "Portishead", album, durationMs: 240_000 });
    const id = seedPortishead(db);
    const { section } = sectionOver(db);
    const ids = new Map(
      browseLibrary(db, { kind: "artist", id }, 0, 10).items.map((row) => [row.title, row.id]),
    );
    const titles = (limit: number, pick: "library" | "online") =>
      section.pageSongs(id, pick, limit).songs.map((row) => row.title);

    // No Popular list saved yet: by song name.
    assert.equal(section.pageSongs(id, "library", 5).popular, false);
    assert.deepEqual(titles(5, "library"), ["Glory Box", "Machine Gun", "Sour Times"]);

    await section.ask(id);
    // Song name, Z to A, for the Songs view: the page keeps Popular.
    toggleBrowseSort(db as unknown as LibraryDatabase, "artist", "title");
    toggleBrowseSort(db as unknown as LibraryDatabase, "artist", "title");

    const library = section.pageSongs(id, "library", 5);
    assert.equal(library.popular, true);
    assert.equal(library.total, 3);
    assert.equal(library.ranked, 2);
    assert.deepEqual(titles(5, "library"), ["Glory Box", "Machine Gun", "Sour Times"]);

    const online = section.pageSongs(id, "online", 2);
    assert.equal(online.total, 4, "with Online the count takes in Roads");
    assert.equal(online.ranked, 3);
    assert.deepEqual(titles(2, "online"), ["Glory Box", "Roads"]);
    assert.deepEqual(section.pageQueue(id, "online"), [
      String(ids.get("Glory Box")),
      "yt:roads00001",
      String(ids.get("Machine Gun")),
      String(ids.get("Sour Times")),
    ]);
    assert.deepEqual(
      section.pageQueue(id, "library"),
      ["Glory Box", "Machine Gun", "Sour Times"].map((title) => String(ids.get(title))),
    );
  }));

test("with YT Music off, the artist page's songs are the Library's", () =>
  inLibrary(async (db) => {
    const id = seedPortishead(db);
    const songs = sectionOver(db, { enabled: () => false }).section.pageSongs(id, null, 5);
    assert.deepEqual(
      songs.songs.map((row) => row.title),
      ["Glory Box"],
    );
    assert.equal(songs.total, 1);
    assert.equal(songs.popular, false);
  }));
