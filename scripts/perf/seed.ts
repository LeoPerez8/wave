// Seeds an emulator with a Library the reference phone's size (docs/agents/emulator-checks.md).
//   node scripts/perf/seed.ts [--serial <s>] [--scale <f>] [--songs <n>] [--artists <n>]
//        [--albums <n>] [--playlists <n>] [--entries <n>] [--videos <n>] [--plays <n>]
//        [--follows <n>] [--favorites <n>] [--stale] [--keep-music] [--no-launch]
//        [--local <dir>]
//
// Writes tagged MP3s under Music/Wave Seed and a database holding them (through the
// client's migrations and store), pushes both with `adb root`, and launches Wave on it.
// Every name in it is generated. --stale gives the database other modified times than
// the files', so the scan at launch reads every file again (the no-duplicates check).
// --local writes the files and the database to <dir> and touches no device.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";

import {
  REFERENCE_SIZE,
  buildReferenceDatabase,
  referenceCatalogue,
  referenceFixture,
  type ReferenceSize,
  type SeedSong,
} from "../../packages/client/src/db/referenceSeed.ts";
import { mp3File } from "./seedFiles.ts";

const PACKAGE = "dev.leoperez.wave";
const MUSIC = "/storage/emulated/0/Music";
const SEED_FOLDER = "Wave Seed";
const DATABASE = `/data/data/${PACKAGE}/files/SQLite`;
/** The files' modified time: whole seconds, which is what adb push keeps. */
const FILE_TIME_S = 1_735_689_600; // 2025-01-01

const { values } = parseArgs({
  options: {
    serial: { type: "string" },
    scale: { type: "string" },
    songs: { type: "string" },
    artists: { type: "string" },
    albums: { type: "string" },
    playlists: { type: "string" },
    entries: { type: "string" },
    videos: { type: "string" },
    plays: { type: "string" },
    follows: { type: "string" },
    favorites: { type: "string" },
    stale: { type: "boolean", default: false },
    "keep-music": { type: "boolean", default: false },
    "no-launch": { type: "boolean", default: false },
    local: { type: "string" },
  },
});

const scale = Number(values.scale ?? 1);
const sized = (option: string | undefined, reference: number): number => {
  const value = option === undefined ? Math.round(reference * scale) : Number(option);
  if (!Number.isInteger(value) || value < 0) throw new Error(`Not a size: ${option}`);
  return value;
};
const size: ReferenceSize = {
  songs: sized(values.songs, REFERENCE_SIZE.songs),
  artists: sized(values.artists, REFERENCE_SIZE.artists),
  albums: sized(values.albums, REFERENCE_SIZE.albums),
  playlists: Math.max(1, sized(values.playlists, REFERENCE_SIZE.playlists)),
  playlistEntries: sized(values.entries, REFERENCE_SIZE.playlistEntries),
  knownVideos: sized(values.videos, REFERENCE_SIZE.knownVideos),
  plays: sized(values.plays, REFERENCE_SIZE.plays),
  follows: values.follows === undefined ? REFERENCE_SIZE.follows : sized(values.follows, 0),
  favorites: sized(values.favorites, REFERENCE_SIZE.favorites),
};

const started = Date.now();
const elapsed = (): string => `${((Date.now() - started) / 1000).toFixed(0)} s`;
const step = (what: string): void => console.log(`[${elapsed()}] ${what}`);

const serialArgs = values.serial === undefined ? [] : ["-s", values.serial];
const adb = (...args: string[]): string =>
  execFileSync("adb", [...serialArgs, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
  });
/** A root shell command on the device; its output. */
const shell = (command: string): string => adb("shell", command);
const quote = (text: string): string => `'${text.replaceAll("'", `'\\''`)}'`;

const catalogue = referenceCatalogue(size);
const fixture = referenceFixture(catalogue);
const local = values.local ?? join(tmpdir(), "wave-seed");
const staged = join(local, SEED_FOLDER);

step(
  `Seeding ${size.songs} songs, ${size.artists} artists, ${size.albums} albums, ` +
    `${size.playlistEntries} playlist entries in ${size.playlists} playlists, ` +
    `${size.knownVideos} known videos, ${size.plays} plays`,
);
rmSync(local, { recursive: true, force: true });
for (const song of catalogue.songs) {
  const file = join(staged, song.file);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, mp3File(song));
  utimesSync(file, FILE_TIME_S, FILE_TIME_S);
}
step(`Wrote ${catalogue.songs.length} files to ${staged}`);

const root = `${MUSIC}/${SEED_FOLDER}`;
/** Each song's size and modified time on the device, read back after the push. */
let facts = (song: SeedSong) => ({
  sizeBytes: mp3File(song).length,
  modifiedAt: FILE_TIME_S * 1000,
});

if (values.local === undefined) {
  const devices = execFileSync("adb", ["devices"], { encoding: "utf8" })
    .split(/\r?\n/)
    .slice(1)
    .filter((line) => line.endsWith("\tdevice"));
  if (devices.length === 0) throw new Error("No device: boot the emulator first");
  if (values.serial === undefined && devices.length > 1)
    throw new Error("More than one device: pass --serial");
  if (shell("getprop ro.kernel.qemu").trim() !== "1")
    throw new Error("Not an emulator: the seed replaces Music and Wave's database");
  if (!shell(`pm list packages ${PACKAGE}`).includes(`package:${PACKAGE}`))
    throw new Error(`${PACKAGE} isn't installed: install a build first`);
  adb("root");
  adb("wait-for-device");
  // adbd restarts as root; wait until the shell answers as root.
  for (let tries = 0; shell("id -u").trim() !== "0"; tries += 1) {
    if (tries > 20) throw new Error("adb root didn't take");
    execFileSync("adb", [...serialArgs, "wait-for-device"]);
  }
  shell(`am force-stop ${PACKAGE}`);

  step(values["keep-music"] ? `Replacing ${root}` : `Emptying ${MUSIC}`);
  shell(values["keep-music"] ? `rm -rf ${quote(root)}` : `rm -rf ${MUSIC}/* ${MUSIC}/.[!.]*`);
  shell(`mkdir -p ${MUSIC}`);
  adb("push", staged, `${MUSIC}/`);
  step("Pushed the files");

  const onDevice = new Map<string, { sizeBytes: number; modifiedAt: number }>();
  for (const line of shell(`find ${quote(root)} -type f -exec stat -c '%s %Y %n' {} +`).split(
    /\r?\n/,
  )) {
    const match = /^(\d+) (\d+) (.+)$/.exec(line);
    if (match !== null)
      onDevice.set(match[3]!, { sizeBytes: Number(match[1]), modifiedAt: Number(match[2]) * 1000 });
  }
  const missing = catalogue.songs.filter((song) => !onDevice.has(`${root}/${song.file}`));
  if (missing.length > 0)
    throw new Error(`${missing.length} files didn't arrive, e.g. ${missing[0]!.file}`);
  facts = (song) => onDevice.get(`${root}/${song.file}`)!;
}

const stale = values.stale;
const database = await buildReferenceDatabase(catalogue, {
  root,
  scanRoot: MUSIC,
  facts: (song) => {
    const held = facts(song);
    return stale ? { ...held, modifiedAt: held.modifiedAt - 60_000 } : held;
  },
  now: Date.now(),
});
const databaseFile = join(local, "wave.db");
writeFileSync(databaseFile, database);
step(`Built the database (${(database.length / 1_048_576).toFixed(1)} MB)`);

if (values.local === undefined) {
  const owner = shell(`stat -c %u /data/data/${PACKAGE}`).trim();
  if (!/^\d+$/.test(owner)) throw new Error(`Couldn't read ${PACKAGE}'s user: ${owner}`);
  // Nothing of the app's earlier state stays (caches, settings, mixes): only the seed.
  shell(`pm clear ${PACKAGE}`);
  shell(`mkdir -p ${DATABASE}`);
  adb("push", databaseFile, `${DATABASE}/wave.db`);
  const files = `/data/data/${PACKAGE}/files`;
  shell(
    `chown ${owner}:${owner} ${files} ${DATABASE} ${DATABASE}/wave.db && chmod 771 ${files}` +
      ` && chmod 600 ${DATABASE}/wave.db && restorecon -R ${files}`,
  );
  shell(`appops set ${PACKAGE} MANAGE_EXTERNAL_STORAGE allow`);
  shell(`pm grant ${PACKAGE} android.permission.POST_NOTIFICATIONS 2>/dev/null; true`);
  step("Pushed the database");
  if (!values["no-launch"]) {
    shell(`monkey -p ${PACKAGE} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1`);
    step("Launched Wave");
  }
}

console.log(
  `Done in ${elapsed()}. perf.ts fixture: --artist ${quote(fixture.artist)} --playlist ${quote(fixture.playlist)}` +
    (stale ? " (stale: the scan at launch reads every file again)" : ""),
);
