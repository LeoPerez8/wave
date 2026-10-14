/**
 * Organizes the music folder into Wave's `<album artist>/<album>/<NN> <title>.mp3`
 * tree (issue #159). See README.md beside this file for the phases and the
 * commands. With no --apply flag it is a dry run: it writes the plan and
 * changes nothing.
 */

import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  cleanupPlan,
  genreTagPlan,
  movePlan,
  type CleanupPlan,
  type FolderFile,
  type GenreWrite,
  type MovePlan,
} from "./plan.ts";
import { checkSyncthing, type SyncCheck } from "./syncthing.ts";

const here = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    folder: { type: "string", default: "C:\\Meus arquivos\\Musicas" },
    "apply-genres": { type: "boolean", default: false },
    "apply-moves": { type: "boolean", default: false },
    "delete-blackplayer": { type: "boolean", default: false },
    "ignore-device": { type: "string", multiple: true, default: [] },
    "syncthing-config": { type: "string" },
  },
});

const root = args.folder.replace(/[\\/]+$/, "");
const beside = (suffix: string): string => join(dirname(root), `${basename(root)}-${suffix}`);
const planPath = beside("organize-plan.txt");
const logPath = beside("organize-log.jsonl");
const reportPath = beside("quality-report.csv");
const abs = (relative: string): string => join(root, ...relative.replace(/\/$/, "").split("/"));

/** Ends the job before it changes anything more. */
class Stop extends Error {}

function fail(message: string): never {
  throw new Stop(message);
}

// ---- Reading the folder -------------------------------------------------------------

/** Every file and folder (ending in "/") under the root, relative and "/"-separated. */
const listFolder = (): string[] => {
  const entries: string[] = [];
  const walk = (relative: string): void => {
    const children = readdirSync(relative === "" ? root : abs(relative), {
      withFileTypes: true,
    }).toSorted((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const child of children) {
      const path = `${relative}${child.name}`;
      if (child.isDirectory()) {
        entries.push(`${path}/`);
        walk(`${path}/`);
      } else entries.push(path);
    }
  };
  walk("");
  return entries;
};

const python = process.env.PYTHON ?? "python";

const runTags = (command: string, input: unknown): unknown[] => {
  const result = spawnSync(python, ["-I", join(here, "tags.py"), command], {
    input: JSON.stringify(input),
    maxBuffer: 512 * 1024 * 1024,
    encoding: "utf8",
  });
  if (result.status !== 0) fail(`tags.py ${command} failed: ${result.error ?? result.stderr}`);
  return JSON.parse(result.stdout) as unknown[];
};

interface ReadTags {
  path: string;
  sizeBytes: number;
  durationMs: number | null;
  error?: string;
  title?: string | null;
  artist?: string | null;
  artists?: string[];
  album?: string | null;
  albumArtist?: string | null;
  albumArtists?: string[];
  genre?: string | null;
  year?: string | null;
  trackNumber?: string | null;
  discNumber?: string | null;
  compilation?: boolean;
}

const readFiles = (mp3s: readonly string[]): { files: FolderFile[]; unreadable: string[] } => {
  const read = runTags("read", mp3s.map(abs)) as ReadTags[];
  const files: FolderFile[] = [];
  const unreadable: string[] = [];
  read.forEach((tags, i) => {
    const path = mp3s[i] as string;
    if (tags.error !== undefined) unreadable.push(`${path}: ${tags.error}`);
    files.push({
      path,
      sizeBytes: tags.sizeBytes,
      durationMs: tags.durationMs,
      tags: {
        title: tags.title,
        artist: tags.artist,
        artists: tags.artists,
        album: tags.album,
        albumArtist: tags.albumArtist,
        albumArtists: tags.albumArtists,
        genre: tags.genre,
        year: tags.year,
        trackNumber: tags.trackNumber,
        discNumber: tags.discNumber,
        compilation: tags.compilation,
      },
    });
  });
  return { files, unreadable };
};

/** The quality report's cutoff for each file, keyed `<folder>/<file>` (NFC). */
const readCutoffs = (): Map<string, number> => {
  const cutoffs = new Map<string, number>();
  if (!existsSync(reportPath)) return cutoffs;
  const lines = readFileSync(reportPath, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  for (const line of lines.slice(1)) {
    const fields = [...line.matchAll(/("(?:[^"]|"")*"|[^,]*)(?:,|$)/g)].map((m) =>
      (m[1] ?? "").replace(/^"|"$/g, "").replaceAll('""', '"'),
    );
    const [folder, file, , cutoff] = fields;
    if (folder && file && cutoff && Number.isFinite(Number(cutoff))) {
      cutoffs.set(`${folder}/${file}`.normalize("NFC"), Number(cutoff));
    }
  }
  return cutoffs;
};

// ---- The plan ----------------------------------------------------------------------

const syncLines = (check: SyncCheck): string[] =>
  check.reachable
    ? [
        ...check.folders.map(
          (folder) =>
            `  ${folder.label}: ${folder.paused ? "paused" : folder.state}, ` +
            (folder.devices
              .map((d) => `${d.name} ${d.completion}%${d.connected ? "" : " (offline)"}`)
              .join(", ") || "no other devices"),
        ),
        check.problems.length === 0
          ? "  In sync."
          : `  OUT OF SYNC:\n${check.problems.map((p) => `    ${p}`).join("\n")}`,
      ]
    : [`  NOT REACHABLE: ${check.reason}`];

const section = (title: string, lines: readonly string[]): string =>
  `\n== ${title} (${lines.length}) ==\n${lines.length === 0 ? "  (none)" : lines.map((l) => `  ${l}`).join("\n")}`;

const main = async (): Promise<void> => {
  if (args["apply-genres"] && (args["apply-moves"] || args["delete-blackplayer"])) {
    fail(
      "--apply-genres runs on its own: the phone has to sync and Wave has to scan before anything moves.",
    );
  }
  if (!existsSync(root)) fail(`no music folder at ${root}`);

  const entries = listFolder();
  const mp3s = entries.filter((entry) => entry.toLowerCase().endsWith(".mp3"));
  const { files, unreadable } = readFiles(mp3s);
  const reportCutoffs = readCutoffs();
  const cutoffs = new Map<string, number>();
  for (const file of files) {
    const cutoff = reportCutoffs.get(file.path.normalize("NFC"));
    if (cutoff !== undefined) cutoffs.set(file.path, cutoff);
  }
  const genres = genreTagPlan(files);
  const moves = movePlan(files, cutoffs);
  const cleanup = cleanupPlan(entries, moves);
  const noAlbum = files.filter((file) => !file.tags.album?.trim()).map((file) => file.path);
  const sync = await checkSyncthing(root, args["ignore-device"], args["syncthing-config"]);

  const deletedCount = moves.duplicates.reduce(
    (sum, duplicate) => sum + duplicate.deleted.length,
    0,
  );

  const planText = (
    genreWrites: readonly GenreWrite[],
    plan: MovePlan,
    clean: CleanupPlan,
  ): string => {
    const genreCounts = new Map<string, number>();
    for (const write of genreWrites)
      genreCounts.set(write.genre, (genreCounts.get(write.genre) ?? 0) + 1);
    return [
      `Music folder organize plan for ${root}`,
      `Made ${new Date().toISOString()} from ${files.length} MP3s (${entries.length} entries).`,
      "",
      "Summary",
      `  Phase a, genre tags written in place: ${genreWrites.length}` +
        (genreCounts.size > 0
          ? ` (${[...genreCounts].map(([g, n]) => `${g} ${n}`).join(", ")})`
          : ""),
      `  Phase b, moves (bytes untouched):     ${plan.moves.length}`,
      `           already in place:            ${plan.inPlace.length}`,
      `           duplicates deleted:          ${deletedCount} (in ${plan.duplicates.length} songs)`,
      `           collisions (numbered names): ${plan.collisions.length}`,
      `           cleanup deletions:           ${clean.delete.length}`,
      `           files left where they are:   ${clean.left.length}`,
      `  Phase c, BlackPlayer folders deleted: ${clean.blackPlayer.length}`,
      `  Songs without an album (they go in their artist's folder): ${noAlbum.length}`,
      `  Look-alikes kept under different tags: ${plan.lookAlikes.length}`,
      `  Unreadable tags: ${unreadable.length}`,
      `  Quality report cutoffs found: ${cutoffs.size} of ${files.length}`,
      "",
      "Syncthing",
      ...syncLines(sync),
      section(
        "Phase a: genre tags (path <- genre)",
        genreWrites.map((write) => `${write.path} <- ${write.genre}`),
      ),
      section(
        "Phase b: moves (old path -> new path)",
        plan.moves.map((move) => `${move.from} -> ${move.to}`),
      ),
      section(
        "Phase b: duplicates (kept -> new path; deleted copies below)",
        plan.duplicates.map(
          (d) =>
            `${d.kept} -> ${d.keptAs} [cutoff ${cutoffs.get(d.kept) ?? "?"}]\n` +
            d.deleted
              .map((path) => `      delete ${path} [cutoff ${cutoffs.get(path) ?? "?"}]`)
              .join("\n"),
        ),
      ),
      section(
        "Phase b: collisions (different songs on one name; the first keeps it, the rest are numbered)",
        plan.collisions.map((c) => `${c.name}: ${c.paths.join(" | ")}`),
      ),
      section("Phase b: songs without an album", noAlbum),
      section(
        "Look-alikes: the same song kept twice under different tags (not deleted; check them)",
        plan.lookAlikes.map((paths) => paths.join(" | ")),
      ),
      section("Phase b: cleanup deletions (folders end in /)", clean.delete),
      section("Left where they are", clean.left),
      section("Phase c: BlackPlayer folders (only with --delete-blackplayer)", clean.blackPlayer),
      section("Unreadable tags", unreadable),
    ].join("\n");
  };

  writeFileSync(planPath, planText(genres, moves, cleanup), "utf8");
  console.log(`Plan written to ${planPath}`);
  console.log(
    `Genre tags ${genres.length}, moves ${moves.moves.length}, duplicates deleted ${deletedCount}, ` +
      `collisions ${moves.collisions.length}, cleanup ${cleanup.delete.length}, BlackPlayer folders ${cleanup.blackPlayer.length}`,
  );
  console.log("Syncthing:");
  for (const line of syncLines(sync)) console.log(line);

  const applying = args["apply-genres"] || args["apply-moves"] || args["delete-blackplayer"];
  if (!applying) {
    console.log("Dry run: nothing was changed.");
    return;
  }

  // ---- Applying ----------------------------------------------------------------------

  if (!sync.reachable)
    fail(`Syncthing isn't reachable (${sync.reason}). Start it and wait for the folder to sync.`);
  if (sync.problems.length > 0) fail("Syncthing reports the music folder out of sync (see above).");

  const log = (entry: Record<string, unknown>): void => {
    appendFileSync(
      logPath,
      `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`,
      "utf8",
    );
  };
  let failures = 0;
  const failed = (entry: Record<string, unknown>, error: unknown): void => {
    failures++;
    const message = error instanceof Error ? error.message : String(error);
    log({ ...entry, error: message });
    console.error(`  failed: ${JSON.stringify(entry)}: ${message}`);
  };

  if (args["apply-genres"]) {
    console.log(`Writing ${genres.length} genre tags…`);
    for (let start = 0; start < genres.length; start += 50) {
      const batch = genres.slice(start, start + 50);
      const results = runTags(
        "write-genre",
        batch.map((write) => ({ path: abs(write.path), genre: write.genre })),
      ) as { ok: boolean; error?: string; sizeBefore: number; sizeAfter?: number }[];
      results.forEach((result, i) => {
        const write = batch[i] as GenreWrite;
        const entry = {
          phase: "genre",
          path: write.path,
          genre: write.genre,
          sizeBefore: result.sizeBefore,
        };
        if (result.ok) log({ ...entry, sizeAfter: result.sizeAfter });
        else failed(entry, result.error);
      });
      console.log(`  ${Math.min(start + 50, genres.length)} / ${genres.length}`);
    }
  }

  if (args["apply-moves"]) {
    if (genres.length > 0) {
      fail(
        `${genres.length} songs in genre folders still have no genre. Run --apply-genres first, ` +
          "then let the phone sync and Wave scan.",
      );
    }
    const sizeOf = new Map(files.map((file) => [file.path, file.sizeBytes]));
    console.log(`Moving ${moves.moves.length} songs…`);
    for (const move of moves.moves) {
      const entry = {
        phase: "move",
        from: move.from,
        to: move.to,
        sizeBytes: sizeOf.get(move.from),
      };
      try {
        if (statSync(abs(move.from)).size !== sizeOf.get(move.from))
          throw new Error("its size changed since it was read");
        const caseOnly = move.from.toLowerCase() === move.to.toLowerCase();
        if (existsSync(abs(move.to)) && !caseOnly) throw new Error("the new path is taken");
        mkdirSync(dirname(abs(move.to)), { recursive: true });
        renameSync(abs(move.from), abs(move.to));
        log(entry);
      } catch (error) {
        failed(entry, error);
      }
    }
    console.log(`Deleting ${deletedCount} duplicates…`);
    for (const duplicate of moves.duplicates) {
      for (const path of duplicate.deleted) {
        const entry = {
          phase: "delete-duplicate",
          path,
          keptAs: duplicate.keptAs,
          sizeBytes: sizeOf.get(path),
        };
        try {
          unlinkSync(abs(path));
          log(entry);
        } catch (error) {
          failed(entry, error);
        }
      }
    }
    console.log(`Cleaning up ${cleanup.delete.length} entries…`);
    for (const path of cleanup.delete) {
      const entry = { phase: "cleanup", path };
      try {
        const top = path.split("/")[0] ?? "";
        if (path.endsWith("/") && (top === ".thumbnails" || top.startsWith(".stfolder.removed-"))) {
          rmSync(abs(path), { recursive: true });
        } else if (path.endsWith("/")) {
          rmdirSync(abs(path)); // only when empty
        } else {
          unlinkSync(abs(path));
        }
        log(entry);
      } catch (error) {
        failed(entry, error);
      }
    }
  }

  if (args["delete-blackplayer"]) {
    console.log(`Deleting ${cleanup.blackPlayer.length} BlackPlayer folders…`);
    for (const path of cleanup.blackPlayer) {
      const entry = { phase: "delete-blackplayer", path };
      try {
        rmSync(abs(path), { recursive: true });
        log(entry);
      } catch (error) {
        failed(entry, error);
      }
    }
  }

  console.log(`Done, ${failures} failures. Log: ${logPath}`);
  if (failures > 0) process.exitCode = 1;
};

try {
  await main();
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(`Stopped: ${error.message}`);
  process.exitCode = 1;
}
