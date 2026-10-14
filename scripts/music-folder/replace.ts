/**
 * Replaces the low-quality songs on `Musicas-to-replace.txt` with genuine 320 kbps
 * copies from Soulseek, in place (issue #161). See README.md beside this file.
 * With no --apply flag it is a dry run: it finds every song, measures it and
 * writes the report, and changes nothing.
 */

import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { FolderFile } from "./plan.ts";
import {
  findOnDisk,
  folderSplitter,
  parseOrganizeLog,
  parseReplaceList,
  parseReplaceLog,
  reaches,
  recordingOf,
  reportText,
  settled,
  toDo,
  type LogRecord,
  type Outcome,
  type Probe,
  type ReportRow,
} from "./replace-plan.ts";
import { pythonAudio, replaceSong } from "./replace-song.ts";
import { connectSoulseek, type SoulseekSession } from "./soulseek.ts";
import { checkSyncthing } from "./syncthing.ts";

const here = dirname(fileURLToPath(import.meta.url));

const { values: args } = parseArgs({
  options: {
    folder: { type: "string", default: "C:\\Meus arquivos\\Musicas" },
    apply: { type: "boolean", default: false },
    retry: { type: "boolean", default: false },
    limit: { type: "string" },
    "max-peers": { type: "string", default: "10" },
    "ignore-device": { type: "string", multiple: true, default: [] },
    "syncthing-config": { type: "string" },
  },
});

const root = args.folder.replace(/[\\/]+$/, "");
const beside = (suffix: string): string => join(dirname(root), `${basename(root)}-${suffix}`);
const listPath = beside("to-replace.txt");
const organizeLogPath = beside("organize-log.jsonl");
const logPath = beside("replace-log.jsonl");
const reportPath = beside("replace-report.txt");
const workPath = beside("replace-work");
const originalsPath = beside("replace-originals");
const abs = (relative: string): string => join(root, ...relative.split("/"));
const python = process.env.PYTHON ?? "python";

class Stop extends Error {}
function fail(message: string): never {
  throw new Stop(message);
}

// ---- Reading the folder -------------------------------------------------------------

/** Every MP3 under the root, relative and "/"-separated; Syncthing's own files are skipped. */
const listMp3s = (): string[] => {
  const found: string[] = [];
  const walk = (relative: string): void => {
    for (const child of readdirSync(relative === "" ? root : abs(relative), {
      withFileTypes: true,
    })) {
      if (child.name.startsWith(".stfolder") || child.name.startsWith("~syncthing~")) continue;
      const path = relative === "" ? child.name : `${relative}/${child.name}`;
      if (child.isDirectory()) walk(path);
      else if (child.name.toLowerCase().endsWith(".mp3")) found.push(path);
    }
  };
  walk("");
  return found.toSorted();
};

/** Tags as Wave's scanner reads them, through the organize job's tags.py. */
const readFiles = (paths: readonly string[]): FolderFile[] => {
  const result = spawnSync(python, ["-I", join(here, "tags.py"), "read"], {
    input: JSON.stringify(paths.map(abs)),
    maxBuffer: 512 * 1024 * 1024,
    encoding: "utf8",
  });
  if (result.status !== 0) fail(`tags.py read failed: ${result.error ?? result.stderr}`);
  const read = JSON.parse(result.stdout) as (FolderFile["tags"] & {
    sizeBytes: number;
    durationMs: number | null;
  })[];
  return read.map(({ sizeBytes, durationMs, ...tags }, i) => ({
    path: paths[i] as string,
    sizeBytes,
    durationMs,
    tags,
  }));
};

const quality = (probe: Probe): string =>
  `${probe.cutoffHz === null ? "no cliff" : `${probe.cutoffHz / 1000} kHz`}, ${probe.bitrateKbps ?? "?"} kbps`;

// ---- Credentials -------------------------------------------------------------------

const askHidden = (question: string): Promise<string> =>
  new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let value = "";
    const onData = (chunk: string): void => {
      for (const char of chunk) {
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(value);
          return;
        }
        if (char === "\u0003") process.exit(130);
        value = char === "\u007f" || char === "\b" ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on("data", onData);
  });

/** The Soulseek login: from SOULSEEK_USERNAME and SOULSEEK_PASSWORD, else asked for. Never stored. */
const credentials = async (): Promise<{ username: string; password: string }> => {
  let username = process.env.SOULSEEK_USERNAME ?? "";
  let password = process.env.SOULSEEK_PASSWORD ?? "";
  if ((username === "" || password === "") && !process.stdin.isTTY)
    fail("set SOULSEEK_USERNAME and SOULSEEK_PASSWORD, or run in a terminal to be asked");
  if (username === "") {
    const prompt = createInterface({ input: process.stdin, output: process.stdout });
    username = (await prompt.question("Soulseek username: ")).trim();
    prompt.close();
  }
  if (password === "") password = await askHidden("Soulseek password: ");
  return { username, password };
};

// ---- The run -----------------------------------------------------------------------

const main = async (): Promise<void> => {
  if (!existsSync(root)) fail(`no music folder at ${root}`);
  if (!existsSync(listPath)) fail(`no list at ${listPath}`);
  const limit = args.limit === undefined ? Infinity : Number(args.limit);
  const maxPeers = Number(args["max-peers"]);
  if (!(limit > 0) || !(maxPeers > 0)) fail("--limit and --max-peers take a positive number");

  const entries = parseReplaceList(readFileSync(listPath, "utf8"));
  const organizeLog = existsSync(organizeLogPath)
    ? parseOrganizeLog(readFileSync(organizeLogPath, "utf8"))
    : [];
  const readLog = (): LogRecord[] =>
    existsSync(logPath) ? parseReplaceLog(readFileSync(logPath, "utf8")) : [];
  let log = readLog();

  console.log(`Reading ${root}…`);
  const files = readFiles(listMp3s());
  const byPath = new Map(files.map((file) => [file.path, file]));
  const split = folderSplitter(files);
  const whereabouts = findOnDisk(entries, files, organizeLog);
  const found = whereabouts.filter((where) => where.found);
  console.log(
    `${entries.length} list entries: ${found.length} found on disk ` +
      `(${["organize log", "old path", "tags"]
        .map(
          (via) => `${found.filter((where) => where.found && where.via === via).length} by ${via}`,
        )
        .join(", ")}), ${entries.length - found.length} not found.` +
      (existsSync(organizeLogPath) ? "" : " No organize log yet."),
  );

  const pending = found.filter((where) => toDo(where.entry, log, { retry: args.retry }) === "try");
  console.log(`Measuring ${pending.length} songs still to do…`);
  const audio = pythonAudio(python);
  const probes = new Map<string, Probe>();
  const measured = await audio.probe(pending.map((where) => (where.found ? abs(where.path) : "")));
  pending.forEach((where, i) => {
    if (where.found) probes.set(where.entry.line, measured[i] as Probe);
  });

  const rows = (): ReportRow[] =>
    whereabouts.map((where): ReportRow => {
      if (!where.found) return { entry: where.entry, state: "not-found", reason: where.reason };
      const record = settled(where.entry, log);
      if (record !== undefined && toDo(where.entry, log, { retry: args.retry }) !== "try")
        return { entry: where.entry, state: "done", record };
      const probe = probes.get(where.entry.line);
      if (!args.apply && probe !== undefined && probe.mp3.ok && reaches(probe))
        return {
          entry: where.entry,
          state: "done",
          record: {
            at: "",
            entry: where.entry.line,
            outcome: "already-good",
            path: where.path,
            cutoffHz: probe.cutoffHz,
          },
        };
      const file = byPath.get(where.path) as FolderFile;
      const recording = recordingOf(
        { ...file, durationMs: probe?.durationMs ?? file.durationMs },
        where.entry,
        split,
      );
      return {
        entry: where.entry,
        state: "to-do",
        path: where.path,
        query: recording.query,
        ...(probe === undefined ? {} : { now: quality(probe) }),
      };
    });
  const writeReport = (): void => {
    writeFileSync(
      reportPath,
      reportText(rows(), { folder: root, made: new Date().toISOString(), dryRun: !args.apply }),
      "utf8",
    );
  };

  writeReport();
  console.log(`Report written to ${reportPath}`);
  if (!args.apply) {
    const summary = reportText(rows(), { folder: root, made: "", dryRun: true }).split("\n\n")[1];
    console.log(summary);
    console.log("Dry run: nothing was downloaded or changed.");
    return;
  }

  // ---- Applying ----------------------------------------------------------------------

  const sync = await checkSyncthing(root, args["ignore-device"], args["syncthing-config"]);
  if (!sync.reachable)
    fail(`Syncthing isn't reachable (${sync.reason}). Start it and wait for the folder to sync.`);
  if (sync.problems.length > 0)
    fail(`Syncthing reports the music folder out of sync:\n  ${sync.problems.join("\n  ")}`);

  const toTry = pending.slice(0, limit);
  if (toTry.length === 0) {
    console.log("Nothing to do.");
    return;
  }
  const session: SoulseekSession = await connectSoulseek(await credentials());
  console.log("Connected to Soulseek. Wave shares nothing and uploads nothing.");
  let replaced = 0;
  try {
    for (const [i, where] of toTry.entries()) {
      if (!where.found) continue;
      const probe = probes.get(where.entry.line) as Probe;
      const file = byPath.get(where.path) as FolderFile;
      const recording = recordingOf({ ...file, durationMs: probe.durationMs }, where.entry, split);
      process.stdout.write(`[${i + 1}/${toTry.length}] ${where.entry.name}: `);
      let outcome: Outcome;
      try {
        outcome = await replaceSong(
          {
            entry: where.entry,
            path: where.path,
            target: abs(where.path),
            current: probe,
            recording,
            work: workPath,
            backup: join(originalsPath, ...where.path.split("/")),
            maxPeers,
          },
          session,
          audio,
        );
      } catch (error) {
        outcome = { outcome: "failed", path: where.path, error: String(error) };
      }
      appendFileSync(
        logPath,
        `${JSON.stringify({ at: new Date().toISOString(), entry: where.entry.line, ...outcome })}\n`,
        "utf8",
      );
      log = readLog();
      writeReport();
      if (outcome.outcome === "replaced") replaced++;
      console.log(
        outcome.outcome === "replaced"
          ? `replaced (${outcome.cutoffHz === null ? "no cliff" : `${outcome.cutoffHz / 1000} kHz`})`
          : outcome.outcome === "rejected"
            ? `rejected (${outcome.tried.length} peers)`
            : outcome.outcome === "failed"
              ? `failed: ${outcome.error}`
              : outcome.outcome,
      );
    }
  } finally {
    session.close();
  }
  console.log(`Done: ${replaced} replaced. Report: ${reportPath}. Log: ${logPath}`);
  console.log(`The old files are in ${originalsPath}.`);
};

try {
  await main();
} catch (error) {
  if (!(error instanceof Stop)) throw error;
  console.error(`Stopped: ${error.message}`);
  process.exitCode = 1;
}
