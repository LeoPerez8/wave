import assert from "node:assert/strict";
import fs from "node:fs";
import fsPromises, {
  mkdtemp,
  mkdir,
  writeFile,
  rename,
  rm,
  symlink,
  realpath,
} from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mock, test } from "node:test";
import { openTestDatabase } from "@wave/client/testing";
import { tracks } from "@wave/client/db/schema";
import { selectLyricsCandidates } from "@wave/client/db/lyricsSearchIndex";
import { createScanner } from "./scanner.ts";

test("opening indexes Music, reads changes incrementally and keeps renamed songs", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wave-scan-"));
  const music = join(folder, "Music");
  await mkdir(music);
  await writeFile(join(music, "One.flac"), "music");
  const reads: string[] = [];
  const db = await openTestDatabase();
  const scanner = createScanner({
    db,
    platform: process.platform,
    musicFolder: music,
    readTags: async (path) => {
      reads.push(path);
      return { title: "Pink Moon", artist: "Nick Drake", durationMs: 124000 };
    },
  });
  try {
    await scanner.refresh();
    assert.equal(scanner.songs(0, 20).total, 1);
    const id = scanner.songs(0, 20).items[0]!.id;
    await scanner.refresh();
    assert.equal(reads.length, 1);
    await rename(join(music, "One.flac"), join(music, "Renamed.flac"));
    await scanner.refresh();
    assert.equal(scanner.songs(0, 20).items[0]!.id, id);
    assert.equal(scanner.status().filesFound, 1);
  } finally {
    scanner.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("a Music directory link is indexed once and hidden folders and link loops are ignored", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wave-links-"));
  const actual = join(folder, "Actual");
  const music = join(folder, "Music");
  await mkdir(actual);
  await mkdir(join(actual, ".hidden"));
  await writeFile(join(actual, "One.flac"), "music");
  await writeFile(join(actual, ".hidden", "Two.flac"), "music");
  await symlink(actual, music, process.platform === "win32" ? "junction" : "dir");
  await symlink(actual, join(actual, "Loop"), process.platform === "win32" ? "junction" : "dir");
  const scanner = createScanner({
    db: await openTestDatabase(),
    platform: process.platform,
    musicFolder: music,
    readTags: async () => ({ artist: "Nick Drake", durationMs: 124000 }),
  });
  try {
    await scanner.refresh();
    assert.equal(scanner.songs(0, 20).total, 1);
    assert.equal(
      scanner.songs(0, 20).items[0]!.path,
      (await realpath(join(actual, "One.flac"))).replaceAll("\\", "/"),
    );
  } finally {
    await scanner.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("folder settings add roots, exclude and include subfolders and keep one root", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wave-folders-"));
  const music = join(folder, "Music");
  const other = join(folder, "Other");
  await mkdir(music);
  await mkdir(other);
  await mkdir(join(other, "Album"));
  await writeFile(join(other, "Album", "One.flac"), "music");
  const scanner = createScanner({
    db: await openTestDatabase(),
    platform: process.platform,
    musicFolder: music,
    readTags: async () => ({ artist: "Nick Drake", durationMs: 124000 }),
  });
  try {
    await scanner.refresh();
    await scanner.addRoot(other);
    assert.equal(scanner.songs(0, 20).total, 1);
    await scanner.exclude(join(other, "Album"));
    assert.equal(scanner.songs(0, 20).total, 0);
    await scanner.include(join(other, "Album"));
    assert.equal(scanner.songs(0, 20).total, 1);
    await assert.rejects(scanner.removeRoot(other), /at least one/);
  } finally {
    scanner.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("watching picks up nested file changes and a disconnected root returns without refresh", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wave-watch-"));
  const music = join(folder, "Music");
  await mkdir(music);
  const scanner = createScanner({
    db: await openTestDatabase(),
    platform: process.platform,
    musicFolder: music,
    quietMs: 40,
    retryMs: 80,
    readTags: async () => ({ title: "Pink Moon", artist: "Nick Drake", durationMs: 124000 }),
  });
  const until = async (condition: () => boolean) => {
    const deadline = Date.now() + 5000;
    while (!condition() && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(condition(), JSON.stringify(scanner.status()));
  };
  try {
    await scanner.refresh();
    await mkdir(join(music, "Album"));
    await writeFile(join(music, "Album", "One.flac"), "music");
    await until(() => scanner.songs(0, 20).total === 1);
    const id = scanner.songs(0, 20).items[0]!.id;
    await rename(music, join(folder, "Unplugged"));
    await until(() => scanner.songs(0, 20).items[0]?.unavailable === true);
    // A mounted filesystem can return at the same path with different directory inodes.
    await mkdir(join(music, "Album"), { recursive: true });
    await writeFile(join(music, "Album", "One.flac"), "music");
    await until(() => scanner.songs(0, 20).items[0]?.unavailable === false);
    assert.equal(scanner.songs(0, 20).items[0]!.id, id);
    await writeFile(join(music, "Album", "Two.flac"), "more music");
    await until(() => scanner.songs(0, 20).total === 2);
    await rm(join(music, "Album", "Two.flac"));
    await until(() => scanner.songs(0, 20).total === 1);
    await rm(join(music, "Album", "One.flac"));
    await until(() => scanner.songs(0, 20).total === 0);
  } finally {
    scanner.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("removing songs from the Library keeps their files out of later scans until included", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wave-remove-"));
  const music = join(folder, "Music");
  await mkdir(music);
  await writeFile(join(music, "One.flac"), "music");
  await writeFile(join(music, "Two.flac"), "music");
  const scanner = createScanner({
    db: await openTestDatabase(),
    platform: process.platform,
    musicFolder: music,
    readTags: async () => ({ artist: "Nick Drake", durationMs: 124000 }),
  });
  try {
    await scanner.refresh();
    const [one] = scanner.songs(0, 20).items.filter((song) => song.path!.endsWith("One.flac"));
    const before = scanner.status().revision;
    await scanner.removeSongs([one!.id]);
    assert.deepEqual(
      scanner.songs(0, 20).items.map((song) => song.path!.split("/").at(-1)),
      ["Two.flac"],
    );
    assert.ok(scanner.status().revision > before);
    await scanner.refresh();
    assert.equal(scanner.songs(0, 20).total, 1);
    assert.deepEqual(scanner.exclusions().items, [one!.path]);
    await scanner.include(one!.path!);
    assert.equal(scanner.songs(0, 20).total, 2);
  } finally {
    await scanner.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("a downloaded file joins the Library at once, with its video and its lyrics", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wave-import-"));
  const music = join(folder, "Music");
  await mkdir(join(music, "Elis Regina"), { recursive: true });
  const db = await openTestDatabase();
  const scanner = createScanner({
    db,
    platform: process.platform,
    musicFolder: music,
    readTags: async () => ({
      title: "Águas de Março",
      artist: "Elis Regina",
      durationMs: 212000,
      lyrics: "É pau, é pedra, é o fim do caminho",
    }),
  });
  try {
    await scanner.refresh();
    const path = join(music, "Elis Regina", "01 Águas de Março.m4a");
    await writeFile(path, "music");
    const before = scanner.status().revision;
    await scanner.importFile(path, { videoId: "abcdefghijk", fills: null });
    const row = db
      .select({ videoId: tracks.videoId, hasLyrics: tracks.hasLyrics })
      .from(tracks)
      .all();
    assert.deepEqual(row, [{ videoId: "abcdefghijk", hasLyrics: true }]);
    assert.ok(scanner.status().revision > before);
    assert.equal(selectLyricsCandidates(db, "fim do caminho").length, 1, "Search finds its lyrics");
    // The next scan finds it unchanged.
    await scanner.refresh();
    assert.equal(scanner.songs(0, 20).total, 1);
  } finally {
    await scanner.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("a scan indexes each song's lyrics for Search, a sidecar .lrc beating unsynced tags", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wave-lyrics-"));
  const music = join(folder, "Music");
  await mkdir(music);
  await writeFile(join(music, "Tagged.flac"), "music");
  await writeFile(join(music, "Sidecar.mp3"), "music");
  await writeFile(
    join(music, "SIDECAR.LRC"),
    "[ar:Nick Drake]\n[00:01.00]Pink moon is on its way\n",
  );
  await writeFile(join(music, "Plain.ogg"), "music");
  let tagged: string | null = "Did I see you down\nUnder a harvest moon";
  const db = await openTestDatabase();
  const scanner = createScanner({
    db,
    platform: process.platform,
    musicFolder: music,
    readTags: async (path) => ({
      title: path.split(/[\\/]/).at(-1)!,
      artist: "Nick Drake",
      durationMs: 124000,
      lyrics: path.endsWith("Tagged.flac") ? tagged : "Unsynced tags lose to a synced sidecar",
    }),
  });
  const found = (query: string) =>
    selectLyricsCandidates(db, query).map(
      (hit) => scanner.songs(0, 20).items.find((song) => song.id === hit.trackId)?.title,
    );
  try {
    await scanner.refresh();
    assert.deepEqual(found("harvest moon"), ["Tagged.flac"]);
    assert.deepEqual(found("pink moon"), ["Sidecar.mp3"]);
    assert.deepEqual(found("unsynced tags"), ["Plain.ogg"]);
    assert.deepEqual(found("nick drake"), [], "header tags aren't lyrics");
    tagged = null;
    await writeFile(join(music, "Tagged.flac"), "music, retagged");
    await scanner.refresh();
    assert.deepEqual(found("harvest moon"), [], "lyrics taken out of the tags leave Search");
  } finally {
    scanner.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("a broken link or a subfolder that can't be read leaves its music folder available", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wave-unreadable-"));
  const music = join(folder, "Music");
  const locked = join(music, "Locked");
  await mkdir(locked, { recursive: true });
  await writeFile(join(music, "One.flac"), "music");
  await writeFile(join(locked, "Two.flac"), "music");
  await symlink(
    join(folder, "Gone"),
    join(music, "Broken"),
    process.platform === "win32" ? "junction" : "dir",
  );
  let retries = 0;
  const scanner = createScanner({
    db: await openTestDatabase(),
    platform: process.platform,
    musicFolder: music,
    quietMs: 10,
    retryMs: 30,
    readTags: async () => ({ artist: "Nick Drake", durationMs: 124000 }),
  });
  const names = () => scanner.songs(0, 20).items.map((song) => song.path!.split("/").at(-1));
  const readFolder = fsPromises.readdir;
  try {
    await scanner.refresh();
    assert.deepEqual(names(), ["One.flac", "Two.flac"]);
    assert.equal(scanner.folders().items[0]!.available, true);
    assert.equal(scanner.songs(0, 20).items[0]!.unavailable, false);

    const lockedPath = await realpath(locked);
    mock.method(fsPromises, "readdir", (async (path: string, ...rest: unknown[]) => {
      if (typeof path === "string" && (await realpath(path).catch(() => path)) === lockedPath)
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
      return (readFolder as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof fsPromises.readdir);
    syncBuiltinESMExports();
    await writeFile(join(music, "Three.flac"), "music");
    await scanner.refresh();
    // The folder that can't be read keeps its song; the rest of the scan goes on.
    assert.deepEqual(names(), ["One.flac", "Three.flac", "Two.flac"]);
    assert.equal(scanner.folders().items[0]!.available, true);
    assert.ok(scanner.songs(0, 20).items.every((song) => !song.unavailable));
    // The watch's own scan for Three.flac ends first.
    await new Promise((resolve) => setTimeout(resolve, 150));
    scanner.subscribe(() => {
      retries += 1;
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(retries, 0, "nothing rescans while the root itself can be read");
  } finally {
    mock.restoreAll();
    syncBuiltinESMExports();
    await scanner.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("removing songs from the Library tells the listeners the song list changed", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wave-remove-heard-"));
  const music = join(folder, "Music");
  await mkdir(music);
  await writeFile(join(music, "One.flac"), "music");
  const scanner = createScanner({
    db: await openTestDatabase(),
    platform: process.platform,
    musicFolder: music,
    readTags: async () => ({ artist: "Nick Drake", durationMs: 124000 }),
  });
  try {
    await scanner.refresh();
    let heard = 0;
    scanner.subscribe(() => {
      heard += 1;
    });
    await scanner.removeSongs([scanner.songs(0, 20).items[0]!.id]);
    assert.equal(heard, 1);
  } finally {
    await scanner.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test(
  "on Windows the recursive watch stays inside the music folder",
  { skip: process.platform !== "win32" },
  async () => {
    const folder = await mkdtemp(join(tmpdir(), "wave-watch-scope-"));
    const music = join(folder, "Music");
    await mkdir(music);
    const watched: { path: string; recursive: boolean }[] = [];
    const watchFolder = fs.watch;
    mock.method(fs, "watch", ((path: string, options: { recursive?: boolean }, heard: never) => {
      watched.push({ path: String(path), recursive: options.recursive === true });
      return watchFolder(path, options, heard);
    }) as typeof fs.watch);
    syncBuiltinESMExports();
    const scanner = createScanner({
      db: await openTestDatabase(),
      platform: process.platform,
      musicFolder: music,
      readTags: async () => ({ artist: "Nick Drake", durationMs: 124000 }),
    });
    try {
      await scanner.refresh();
      const root = await realpath(music);
      const parent = await realpath(folder);
      assert.deepEqual(
        watched.filter((watch) => watch.recursive).map((watch) => watch.path),
        [root],
      );
      // The parent is still watched, for the root itself coming and going.
      assert.ok(watched.some((watch) => !watch.recursive && watch.path === parent));
    } finally {
      mock.restoreAll();
      syncBuiltinESMExports();
      await scanner.dispose();
      await rm(folder, { recursive: true, force: true });
    }
  },
);
