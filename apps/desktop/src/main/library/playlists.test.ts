import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { createPlaylist as storePlaylist } from "@wave/client/db/playlists";
import type { LibraryDatabase } from "@wave/client/db/database";
import { framingSquare, type FramingSquare } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { libraryLayer } from "../database.ts";
import { browseLibrary } from "./browse.ts";
import { togglePlaylistSort } from "./browseSort.ts";
import { createPlaylists, type PlaylistImageCodec } from "./playlists.ts";

/** Photos as text: `IMG 800x600` is an 800 by 600 photo; anything else isn't an image. */
const codec: PlaylistImageCodec = {
  original: (bytes) => {
    const match = /^IMG (\d+)x(\d+)$/.exec(Buffer.from(bytes).toString());
    return match === null
      ? undefined
      : { jpeg: bytes, width: Number(match[1]), height: Number(match[2]) };
  },
  squares: (_jpeg, square: FramingSquare, sides) =>
    sides.map((side) =>
      Buffer.from(`SQUARE ${square.left},${square.top},${square.side} at ${side}`),
    ),
};

/** A Library in a real SQLite file, as main opens it, and the playlists service over it. */
const setUp = async (
  run: (context: {
    readonly db: LibraryDatabase;
    readonly folder: string;
    readonly playlists: ReturnType<typeof createPlaylists>;
    readonly picked: { files: string[]; image: string | undefined };
    readonly changes: () => number;
    readonly kept: string[];
    readonly played: { songs: unknown[]; index: number; context: unknown }[];
  }) => Promise<void>,
  platform = "win32",
) => {
  const folder = mkdtempSync(join(tmpdir(), "wave-playlists-"));
  const runtime = ManagedRuntime.make(libraryLayer(join(folder, "wave.db")));
  try {
    const db = (await runtime.runPromise(
      Effect.gen(function* () {
        return yield* Database;
      }),
    )) as unknown as LibraryDatabase;
    let changes = 0;
    let clock = 0;
    const picked = { files: [] as string[], image: undefined as string | undefined };
    const kept: string[] = [];
    const played: { songs: unknown[]; index: number; context: unknown }[] = [];
    const playlists = createPlaylists({
      db,
      platform,
      imageFolder: join(folder, "playlist-images"),
      codec,
      pickImage: async () => picked.image,
      pickPlaylists: async () => picked.files,
      changed: () => void changes++,
      // Each edit a second after the last, so the newest removal is told apart.
      now: () => (clock += 1_000),
      keepStreams: (streams) => kept.push(...streams.map((song) => song.videoId)),
      play: async (entries, index, context) => {
        played.push({ songs: [...entries], index, context });
        return { kind: "playing", streamed: 0, leftOut: 0 };
      },
    });
    await run({ db, folder, playlists, picked, changes: () => changes, kept, played });
  } finally {
    await runtime.dispose();
    rmSync(folder, { recursive: true, force: true });
  }
};

const sidebar = (db: LibraryDatabase) =>
  browseLibrary(db, { kind: "playlists" }, 0, 50).items.map((row) => row.title);

const pageTitles = (db: LibraryDatabase, id: number) =>
  browseLibrary(db, { kind: "playlist", id }, 0, 50).items.map((row) => row.title);

const songs = (db: LibraryDatabase, ...titles: string[]) =>
  titles.map((title) => addTrack(db as unknown as TestDatabase, { title, album: "Pink Moon" }));

test("New Playlist, Rename and Delete show in the playlists list at once", async () => {
  await setUp(async ({ db, playlists, changes }) => {
    const [road] = songs(db, "Road");
    const name = playlists.newName("en");
    assert.equal(name, "New Playlist");
    const made = playlists.create(name);
    assert.deepEqual(sidebar(db), ["New Playlist"]);
    assert.equal(playlists.newName("pt-BR"), "Nova Playlist");
    assert.equal(playlists.newName("en"), "New Playlist 2");
    assert.deepEqual(playlists.checkName("new playlist"), { ok: false, problem: "taken" });
    assert.deepEqual(playlists.checkName(" New Playlist ", made.id), {
      ok: true,
      name: "New Playlist",
    });
    assert.deepEqual(playlists.checkName("   "), { ok: false, problem: "empty" });

    playlists.rename(made.id, "Evening");
    assert.deepEqual(sidebar(db), ["Evening"]);
    assert.throws(() => playlists.rename(made.id, ""), /rejected/);

    // New Playlist from Add to Playlist takes the songs along.
    const withSongs = playlists.create("Morning", {
      scope: { kind: "songs" },
      ids: [road!],
    });
    assert.equal(withSongs.added, 1);
    assert.deepEqual(pageTitles(db, withSongs.id), ["Road"]);
    assert.deepEqual(sidebar(db), ["Evening", "Morning"]);

    playlists.delete(made.id);
    assert.deepEqual(sidebar(db), ["Morning"]);
    assert.equal(playlists.info(made.id), null);
    assert.equal(changes(), 4);
  });
});

test("Remove from Playlist puts songs in the Graveyard; Undo, Restore and Remove from Graveyard", async () => {
  await setUp(async ({ db, playlists }) => {
    const [road, pink, parasite] = songs(db, "Road", "Pink Moon", "Parasite");
    const { playlistId: id } = storePlaylist(
      db,
      "Evening",
      [road!, pink!, parasite!].map((trackId) => ({ source: "library", trackId })),
      0,
    );
    assert.equal(playlists.removeSongs(id, [pink!, parasite!]), 2);
    assert.deepEqual(pageTitles(db, id), ["Road"]);
    playlists.undoRemove();
    assert.deepEqual(pageTitles(db, id), ["Road", "Pink Moon", "Parasite"]);
    // Undo puts back only once.
    playlists.undoRemove();
    assert.deepEqual(pageTitles(db, id), ["Road", "Pink Moon", "Parasite"]);

    playlists.removeSongs(id, [pink!]);
    playlists.removeSongs(id, [road!]);
    assert.deepEqual(playlists.info(id), {
      name: "Evening",
      hasImage: false,
      graveyard: 2,
      collaborative: false,
    });
    const graveyard = playlists.graveyard(id, 0, 50);
    assert.equal(graveyard.total, 2);
    assert.deepEqual(
      graveyard.items.map((row) => row.title),
      ["Road", "Pink Moon"],
    );
    assert.ok(graveyard.items[0]!.removedAt > graveyard.items[1]!.removedAt);
    assert.equal(playlists.graveyard(id, 1, 1).items[0]?.title, "Pink Moon");

    playlists.restore(id, graveyard.items[1]!.itemId);
    assert.deepEqual(pageTitles(db, id), ["Pink Moon", "Parasite"]);
    playlists.forget(id, graveyard.items[0]!.itemId);
    assert.equal(playlists.graveyard(id, 0, 50).total, 0);

    playlists.removeSongs(id, [pink!, parasite!]);
    playlists.forget(id);
    assert.equal(playlists.info(id)?.graveyard, 0);
  });
});

test("Move Up and Move Down move a song one place among the songs its page shows", async () => {
  await setUp(async ({ db, playlists }) => {
    const [road, pink, parasite] = songs(db, "Road", "Pink Moon", "Parasite");
    const { playlistId: id } = storePlaylist(
      db,
      "Evening",
      [road!, pink!, parasite!].map((trackId) => ({ source: "library", trackId })),
      0,
    );
    playlists.move(id, parasite!, "up");
    assert.deepEqual(pageTitles(db, id), ["Road", "Parasite", "Pink Moon"]);
    playlists.move(id, road!, "down");
    assert.deepEqual(pageTitles(db, id), ["Parasite", "Road", "Pink Moon"]);
    // The ends stay where they are.
    playlists.move(id, parasite!, "up");
    playlists.move(id, pink!, "down");
    assert.deepEqual(pageTitles(db, id), ["Parasite", "Road", "Pink Moon"]);
  });
});

test("dragging songs places them before a row, or at the end, in the playlist's own order", async () => {
  await setUp(async ({ db, playlists, changes }) => {
    const [road, pink, parasite, river, place] = songs(
      db,
      "Road",
      "Pink Moon",
      "Parasite",
      "River Man",
      "Place to Be",
    );
    const { playlistId: id } = storePlaylist(
      db,
      "Evening",
      [road!, pink!, parasite!, river!, place!].map((trackId) => ({ source: "library", trackId })),
      0,
    );
    const scope = { kind: "playlist", id } as const;
    playlists.place(id, { scope, ids: [parasite!] }, road!);
    assert.deepEqual(pageTitles(db, id), [
      "Parasite",
      "Road",
      "Pink Moon",
      "River Man",
      "Place to Be",
    ]);
    playlists.place(id, { scope, ids: [parasite!] }, null);
    assert.deepEqual(pageTitles(db, id), [
      "Road",
      "Pink Moon",
      "River Man",
      "Place to Be",
      "Parasite",
    ]);
    // A selection moves together, in the order the playlist had it.
    playlists.place(id, { scope, ids: [parasite!, pink!] }, river!);
    assert.deepEqual(pageTitles(db, id), [
      "Road",
      "Pink Moon",
      "Parasite",
      "River Man",
      "Place to Be",
    ]);
    // Dropped on one of its own rows, it lands before the next row it doesn't hold.
    playlists.place(id, { scope, ids: [road!, parasite!] }, parasite!);
    assert.deepEqual(pageTitles(db, id), [
      "Pink Moon",
      "Road",
      "Parasite",
      "River Man",
      "Place to Be",
    ]);
    playlists.place(id, { scope, all: true, except: [pink!, river!] }, null);
    assert.deepEqual(pageTitles(db, id), [
      "Pink Moon",
      "River Man",
      "Road",
      "Parasite",
      "Place to Be",
    ]);
    assert.equal(changes(), 5);
  });
});

test("dragging moves a streamed entry among the Library songs", async () => {
  await setUp(async ({ db, playlists }) => {
    const [road] = songs(db, "Road");
    const stream = {
      videoId: "abcdefghijk",
      title: "Pink Moon",
      artists: ["Nick Drake"],
      album: "Pink Moon",
      albumId: "MPREb_pinkmoon",
      durationMs: 124_000,
      artworkUrl: null,
      explicit: false,
    };
    const { playlistId: id } = storePlaylist(
      db,
      "Mixed",
      [
        { source: "unsearched", song: { ...stream, title: "Still searching" } },
        { source: "library", trackId: road! },
        { source: "stream", song: stream },
      ],
      0,
    );
    const scope = { kind: "playlist", id } as const;
    const streamed = browseLibrary(db, scope, 0, 50).items[1]!.id;
    assert.ok(streamed < 0);
    playlists.place(id, { scope, ids: [streamed] }, road!);
    assert.deepEqual(pageTitles(db, id), ["Pink Moon", "Road"]);
    playlists.place(id, { scope, ids: [road!] }, streamed);
    assert.deepEqual(pageTitles(db, id), ["Road", "Pink Moon"]);
  });
});

test("a sorted playlist can't be rearranged: its own order stays as it was", async () => {
  await setUp(async ({ db, playlists }) => {
    const [road, pink, parasite] = songs(db, "Road", "Pink Moon", "Parasite");
    const { playlistId: id } = storePlaylist(
      db,
      "Evening",
      [road!, pink!, parasite!].map((trackId) => ({ source: "library", trackId })),
      0,
    );
    togglePlaylistSort(db, id, "title");
    playlists.move(id, parasite!, "up");
    playlists.place(id, { scope: { kind: "playlist", id }, ids: [parasite!] }, road!);
    assert.deepEqual(pageTitles(db, id), ["Parasite", "Pink Moon", "Road"]);
    togglePlaylistSort(db, id, "custom");
    assert.deepEqual(pageTitles(db, id), ["Road", "Pink Moon", "Parasite"]);
  });
});

/** Gives the Library's songs Windows paths, as the desktop's scan files them. */
const onDriveC = (db: LibraryDatabase) => db.run(sql`UPDATE tracks SET path = 'C:' || path`);

test("an M3U8 from another player on Windows imports by Core's rules", async () => {
  await setUp(async ({ db, folder, playlists, picked, changes }) => {
    const [road, pink] = songs(db, "Road", "Pink Moon");
    songs(db, "Parasite");
    onDriveC(db);
    const { playlistId: evening } = storePlaylist(
      db,
      "Evening",
      [{ source: "library", trackId: pink! }],
      0,
    );
    const files = join(folder, "Exported");
    mkdirSync(files);
    // Foobar2000 writes backslashes, any case, and a BOM.
    writeFileSync(
      join(files, "Night Drive.m3u8"),
      "\uFEFF#EXTM3U\r\n#EXTINF:241,Nick Drake - Road\r\nc:\\music\\PINK MOON\\Road.mp3\r\n" +
        "file:///C:/Music/Pink%20Moon/Pink%20Moon.mp3\r\n#EXTINF:200,Lost Song\r\nD:\\Elsewhere\\Lost.mp3\r\n",
    );
    writeFileSync(join(files, "Evening.m3u"), "C:\\Music\\Pink Moon\\Road.mp3\n");
    writeFileSync(join(files, "Morning.m3u8"), "Z:\\Nowhere\\Gone.mp3\n");
    writeFileSync(join(files, "notes.txt"), "C:\\Music\\Pink Moon\\Road.mp3\n");
    picked.files = ["Night Drive.m3u8", "Evening.m3u", "Morning.m3u8", "notes.txt"].map((name) =>
      join(files, name),
    );

    const choice = await playlists.chooseImport();
    assert.deepEqual(choice, {
      files: [
        { name: "Night Drive.m3u8", clash: null },
        { name: "Evening.m3u", clash: "Evening" },
        { name: "Morning.m3u8", clash: null },
        { name: "notes.txt", clash: null },
      ],
    });
    const result = playlists.runImport(["keepBoth", "replace", "keepBoth", "keepBoth"]);
    assert.deepEqual(result.outcomes, [
      { kind: "imported", name: "Night Drive", songs: 2, missing: ["Lost Song"], replaced: false },
      { kind: "imported", name: "Evening", songs: 1, missing: [], replaced: true },
      { kind: "nothingFound", file: "Morning.m3u8", missing: ["Gone.mp3"] },
      { kind: "notPlaylist", file: "notes.txt" },
    ]);
    assert.equal(result.playlistId, evening);
    assert.deepEqual(sidebar(db), ["Evening", "Night Drive"]);
    const night = browseLibrary(db, { kind: "playlists" }, 0, 50).items[1]!.id;
    assert.deepEqual(pageTitles(db, night), ["Road", "Pink Moon"]);
    assert.deepEqual(pageTitles(db, evening), ["Road"]);
    assert.equal(changes(), 1);
    assert.ok(road);
    // The picked files are imported once.
    assert.throws(() => playlists.runImport([]), /Nothing to import/);

    // Keep Both names the new one apart.
    picked.files = [join(files, "Evening.m3u")];
    await playlists.chooseImport();
    playlists.runImport(["keepBoth"]);
    assert.deepEqual(sidebar(db), ["Evening", "Evening 2", "Night Drive"]);

    picked.files = [];
    assert.equal(await playlists.chooseImport(), null);
  });
});

test("a playlist's image: Change Image, Adjust Image, Remove Image, and a deleted playlist's", async () => {
  await setUp(async ({ db, folder, playlists, picked }) => {
    const made = playlists.create("Evening");
    const images = join(folder, "playlist-images");
    const photo = join(folder, "photo.jpg");
    writeFileSync(photo, "IMG 800x600");

    picked.image = undefined;
    assert.equal(await playlists.pickImage(made.id), null);
    picked.image = photo;
    const edit = await playlists.pickImage(made.id);
    assert.deepEqual(
      { ...edit, photo: edit?.photo.slice(0, 23) },
      {
        photo: "data:image/jpeg;base64,",
        width: 800,
        height: 600,
        framing: { zoom: 1, centerX: 0.5, centerY: 0.5 },
      },
    );
    assert.throws(() => playlists.saveImage(made.id + 1, edit!.framing), /No photo/);
    const framing = { zoom: 2, centerX: 0.25, centerY: 0.5 };
    playlists.saveImage(made.id, framing);
    assert.deepEqual(playlists.info(made.id), {
      name: "Evening",
      hasImage: true,
      graveyard: 0,
      collaborative: false,
    });
    const square = framingSquare({ width: 800, height: 600 }, framing);
    const large = await playlists.image(made.id, true);
    assert.equal(
      Buffer.from(large!.split(",")[1]!, "base64").toString(),
      `SQUARE ${square.left},${square.top},${square.side} at 1200`,
    );
    const thumb = await playlists.image(made.id, false);
    assert.match(Buffer.from(thumb!.split(",")[1]!, "base64").toString(), /at 300$/);
    assert.ok(
      browseLibrary(db, { kind: "playlists" }, 0, 1).items[0]?.imageKey,
      "the list knows the image, to read it",
    );
    assert.equal(readdirSync(images).length, 3);

    // Adjust Image starts from the original at the last framing, and keeps the original.
    const adjust = await playlists.adjustImage(made.id);
    assert.deepEqual(adjust?.framing, framing);
    playlists.saveImage(made.id, { zoom: 1, centerX: 0.5, centerY: 0.5 });
    assert.equal(readdirSync(images).length, 3);

    // A photo that isn't one fails, and Cancel forgets the picked one.
    writeFileSync(photo, "not a photo");
    await assert.rejects(playlists.pickImage(made.id), /image/);
    playlists.cancelImage();
    assert.throws(() => playlists.saveImage(made.id, framing), /No photo/);

    playlists.removeImage(made.id);
    assert.equal(playlists.info(made.id)?.hasImage, false);
    assert.equal(await playlists.image(made.id, true), null);
    assert.equal(readdirSync(images).length, 0);

    writeFileSync(photo, "IMG 300x300");
    await playlists.pickImage(made.id);
    playlists.saveImage(made.id, { zoom: 1, centerX: 0.5, centerY: 0.5 });
    playlists.delete(made.id);
    assert.equal(readdirSync(images).length, 0);
    assert.ok(existsSync(photo), "the picked photo itself stays");
  });
});

test("the image call reads only Wave's own image files", async () => {
  await setUp(async ({ db, folder, playlists }) => {
    const made = playlists.create("Evening");
    const outside = join(folder, "secret.jpg");
    writeFileSync(outside, "private");
    db.run(
      sql`UPDATE playlists SET image_path=${outside}, image_thumb_path=${outside} WHERE id=${made.id}`,
    );
    assert.equal(await playlists.image(made.id, true), null);
    assert.equal(await playlists.adjustImage(made.id), null);
    playlists.removeImage(made.id);
    assert.ok(existsSync(outside), "a file outside Wave's folder is never deleted");
  });
});

test("mixed pages count only listable entries and keep the visible stream metadata", async () => {
  await setUp(async ({ db }) => {
    const [road] = songs(db, "Road");
    const stream = {
      videoId: "abcdefghijk",
      title: "Pink Moon",
      artists: ["Nick Drake"],
      album: "Pink Moon",
      albumId: "MPREb_pinkmoon",
      durationMs: 124_000,
      artworkUrl: null,
      explicit: false,
    };
    const { playlistId: id } = storePlaylist(
      db,
      "Mixed",
      [
        { source: "unsearched", song: { ...stream, title: "Still searching" } },
        { source: "library", trackId: road! },
        { source: "stream", song: stream },
      ],
      0,
    );
    const scope = { kind: "playlist", id } as const;
    const visible: string[] = [];
    const page = browseLibrary(db, scope, 1, 1, (songs) =>
      visible.push(...songs.map((song) => song.albumId!)),
    );
    assert.equal(page.total, 2);
    assert.deepEqual(
      page.items.map((row) => row.title),
      ["Pink Moon"],
    );
    assert.deepEqual(visible, ["MPREb_pinkmoon"]);
    assert.deepEqual(
      browseLibrary(db, scope, 0, 1).items.map((row) => row.id),
      [road],
    );
  });
});

test("a Graveyard lists its streamed songs too, and plays from the song chosen without restoring it", async () => {
  await setUp(async ({ db, playlists, kept, played }) => {
    const [road, pink] = songs(db, "Road", "Pink Moon");
    const stream = {
      videoId: "abcdefghijk",
      title: "Northern Sky",
      artists: ["Nick Drake"],
      album: "Bryter Layter",
      albumId: null,
      durationMs: 222_000,
      artworkUrl: null,
      explicit: false,
    };
    const { playlistId: id } = storePlaylist(
      db,
      "Evening",
      [
        { source: "library", trackId: road! },
        { source: "stream", song: stream },
        { source: "library", trackId: pink! },
      ],
      0,
    );
    const streamedRow = browseLibrary(db, { kind: "playlist", id }, 0, 50).items[1]!;
    playlists.removeSongs(id, [road!]);
    playlists.removeSongs(id, [streamedRow.id]);
    assert.equal(playlists.info(id)?.graveyard, 2);
    const graveyard = playlists.graveyard(id, 0, 50);
    assert.deepEqual(
      graveyard.items.map((row) => [row.title, row.videoId ?? null]),
      [
        ["Northern Sky", "abcdefghijk"],
        ["Road", null],
      ],
    );
    assert.equal(graveyard.items[0]!.id, streamedRow.id);
    assert.deepEqual(kept, ["abcdefghijk"]);

    await playlists.playGraveyard(id, graveyard.items[1]!.itemId);
    assert.deepEqual(played, [
      {
        songs: [{ itemId: graveyard.items[0]!.itemId, song: stream }, { trackId: road }],
        index: 1,
        context: { kind: "playlist", id: String(id) },
      },
    ]);
    // Playing it leaves it in the Graveyard.
    assert.deepEqual(pageTitles(db, id), ["Pink Moon"]);
    assert.equal(playlists.graveyard(id, 0, 50).total, 2);
    await assert.rejects(playlists.playGraveyard(id, 999_999));
  });
});
