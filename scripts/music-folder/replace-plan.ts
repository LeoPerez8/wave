/**
 * The decisions of the Soulseek replace job (replace.ts, issue #161): where each
 * song on `Musicas-to-replace.txt` is now, which peers to try, whether a
 * downloaded file may replace it, what a re-run skips and what the report says.
 * Pure: paths are relative to the music folder, "/"-separated, and nothing here
 * touches the disk or the network.
 */

import {
  creditSplitter,
  normalizeSearchText,
  normalizeTrack,
  soulseekCandidates,
  soulseekQuery,
  soulseekReceivedMatches,
  splitCredit,
  type SoulseekCandidate,
  type YtSong,
} from "../../packages/core/src/index.ts";
import type { FolderFile } from "./plan.ts";

/** One line of `Musicas-to-replace.txt`: `<old genre folder>\t<Artist - Title>`. */
export interface ListEntry {
  readonly folder: string;
  readonly name: string;
  /** The line itself, the entry's key in the replace log. */
  readonly line: string;
}

export const parseReplaceList = (text: string): ListEntry[] =>
  text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .flatMap((raw) => {
      const line = raw.normalize("NFC");
      const tab = line.indexOf("\t");
      if (tab < 0) return [];
      return [{ folder: line.slice(0, tab), name: line.slice(tab + 1), line }];
    });

/** One action of the organize job's log (`Musicas-organize-log.jsonl`). */
export interface OrganizeAction {
  readonly phase: string;
  readonly from?: string;
  readonly to?: string;
  readonly path?: string;
  readonly keptAs?: string;
  readonly error?: string;
}

export const parseOrganizeLog = (text: string): OrganizeAction[] =>
  text.split(/\r?\n/).flatMap((line) => {
    if (line.trim() === "") return [];
    try {
      return [JSON.parse(line) as OrganizeAction];
    } catch {
      return [];
    }
  });

/** Where a list entry is in the music folder now, or why it isn't found. */
export type Whereabouts =
  | {
      readonly entry: ListEntry;
      readonly found: true;
      readonly path: string;
      readonly via: "organize log" | "old path" | "tags";
    }
  | { readonly entry: ListEntry; readonly found: false; readonly reason: string };

const pathKey = (path: string): string => path.normalize("NFC").toLowerCase();

/** Old path → new path, from the organize log's successful moves and deleted duplicates. */
const organizedPaths = (log: readonly OrganizeAction[]): Map<string, string> => {
  const moved = new Map<string, string>();
  for (const action of log) {
    if (action.error !== undefined) continue;
    if (action.phase === "move" && action.from && action.to)
      moved.set(pathKey(action.from), action.to);
    if (action.phase === "delete-duplicate" && action.path && action.keptAs)
      moved.set(pathKey(action.path), action.keptAs);
  }
  return moved;
};

export const findOnDisk = (
  entries: readonly ListEntry[],
  files: readonly FolderFile[],
  log: readonly OrganizeAction[],
): Whereabouts[] => {
  const byPath = new Map(files.map((file) => [pathKey(file.path), file.path]));
  const organized = organizedPaths(log);
  const byTags = indexByTags(files);
  return entries.map((entry): Whereabouts => {
    const oldPath = pathKey(`${entry.folder}/${entry.name}.mp3`);
    const newPath = organized.get(oldPath);
    if (newPath !== undefined) {
      const path = byPath.get(pathKey(newPath));
      if (path !== undefined) return { entry, found: true, path, via: "organize log" };
      return {
        entry,
        found: false,
        reason: `the organize log moved it to ${newPath}, which is gone`,
      };
    }
    const old = byPath.get(oldPath);
    if (old !== undefined) return { entry, found: true, path: old, via: "old path" };
    const exact = byTags.get(normalizeSearchText(entry.name)) ?? [];
    const tagged =
      exact.length > 0
        ? exact
        : files.filter((file) => looselyNamed(file, entry)).map((file) => file.path);
    const outside = tagged.filter((path) => !path.startsWith(".thumbnails/"));
    const candidates = outside.length > 0 ? outside : tagged;
    if (candidates.length === 1)
      return { entry, found: true, path: candidates[0] as string, via: "tags" };
    if (candidates.length > 1)
      return {
        entry,
        found: false,
        reason: `${candidates.length} files have its artist and title: ${candidates.join(" | ")}`,
      };
    return { entry, found: false, reason: "no file has its old path or its artist and title" };
  });
};

/** A file's "Artist - Title" keys, folded: with its whole credit and with its first artist only. */
const tagKeys = (file: FolderFile): string[] => {
  const title = file.tags.title?.trim();
  if (!title) return [];
  const artists = (file.tags.artists ?? []).filter((artist) => artist.trim() !== "");
  const credits = artists.length > 0 ? [artists.join(", "), artists[0] as string] : [];
  if (file.tags.artist?.trim()) credits.push(file.tags.artist);
  return [...new Set(credits.map((credit) => normalizeSearchText(`${credit} - ${title}`)))];
};

const words = (text: string): string[] =>
  normalizeSearchText(text)
    .split(" ")
    .filter((word) => word !== "");
const startsWith = (haystack: readonly string[], needle: readonly string[]): boolean =>
  needle.length > 0 && needle.every((word, i) => haystack[i] === word);
const contains = (haystack: readonly string[], needle: readonly string[]): boolean =>
  haystack.some((_, i) => startsWith(haystack.slice(i), needle));

/**
 * Whether [entry]'s old name, as YouTube downloads named files, names [file]:
 * its title (with or without its bracketed notes) starts one of the name's
 * " - " parts, and one of its artists is in the name. "Paramore - Decode (HQ
 * Audio)", "2026 - LAGUM" and "Cazuza - O Tempo Não Pára" for "… (Ao Vivo)".
 */
const looselyNamed = (file: FolderFile, entry: ListEntry): boolean => {
  const title = file.tags.title?.trim();
  if (!title) return false;
  const titles = [words(title), words(title.replace(/\s*[([][^)\]]*[)\]]/g, ""))];
  const parts = entry.name.split(" - ").map(words);
  if (!titles.some((wanted) => parts.some((part) => startsWith(part, wanted)))) return false;
  const credits = [...(file.tags.artists ?? []), file.tags.artist ?? ""].filter(hasText);
  const name = words(entry.name);
  return [...credits, ...credits.flatMap((credit) => splitCredit(credit))].some((artist) =>
    contains(name, words(artist)),
  );
};

const indexByTags = (files: readonly FolderFile[]): Map<string, string[]> => {
  const index = new Map<string, string[]>();
  for (const file of files)
    for (const key of tagKeys(file)) index.set(key, [...(index.get(key) ?? []), file.path]);
  return index;
};

// ---- The recording to look for --------------------------------------------------------

/** Splits artist credits the way the music folder's credits do, as the organize job does. */
export const folderSplitter = (
  files: readonly FolderFile[],
): ((credit: readonly string[]) => string[]) => {
  const known = new Set<string>();
  for (const file of files) {
    const track = normalizeTrack({ ...file.tags, path: file.path });
    for (const credit of [track.artist, ...track.artistCredits]) known.add(credit);
  }
  return creditSplitter(known);
};

const hasText = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== "";

/** The song as Core's Soulseek matching sees it, and what to search for. */
export interface Recording {
  readonly song: YtSong;
  readonly query: string;
}

/**
 * The recording [file] holds, from its tags (the list's `Artist - Title` when it
 * has none), with its measured duration: Core matches peers against it.
 */
export const recordingOf = (
  file: FolderFile,
  entry: ListEntry,
  split: (credit: readonly string[]) => string[] = creditSplitter([]),
): Recording => {
  const dash = entry.name.indexOf(" - ");
  const listed = {
    artist: dash < 0 ? "" : entry.name.slice(0, dash),
    title: dash < 0 ? entry.name : entry.name.slice(dash + 3),
  };
  const credits = (file.tags.artists ?? []).filter(hasText);
  if (credits.length === 0 && hasText(file.tags.artist)) credits.push(file.tags.artist);
  if (credits.length === 0 && listed.artist !== "") credits.push(listed.artist);
  const song: YtSong = {
    videoId: "",
    title: hasText(file.tags.title) ? file.tags.title.trim() : listed.title,
    artists: credits.length === 0 ? [] : split(credits),
    album: hasText(file.tags.album) ? file.tags.album.trim() : null,
    durationMs: file.durationMs,
    artworkUrl: null,
    explicit: false,
  };
  return { song, query: soulseekQuery(song) };
};

const peerKey = (peer: SoulseekCandidate): string => JSON.stringify([peer.username, peer.filename]);

/**
 * The next peers to try for [song], best first: Core's choice among the reports
 * not tried yet, so a rejected upscale leads to the next peer with the recording.
 */
export const nextPeers = (
  song: YtSong,
  reports: readonly SoulseekCandidate[],
  tried: readonly SoulseekCandidate[],
): SoulseekCandidate[] => {
  const done = new Set(tried.map(peerKey));
  return soulseekCandidates(
    song,
    reports.filter((report) => !done.has(peerKey(report))),
  );
};

// ---- Accepting a download ------------------------------------------------------------

/** The quality report's bar: a spectrum reaching 19.5 kHz. */
export const MIN_CUTOFF_HZ = 19_500;
/** How far a replacement's duration may be from the old file's. */
export const MAX_DURATION_GAP_MS = 3_000;

/** What `audio.py probe` measures in an MP3. */
export interface Probe {
  readonly path: string;
  readonly sizeBytes: number;
  readonly sha256: string;
  /** As mutagen reads the stream (any bitrate), null when it can't. */
  readonly durationMs: number | null;
  readonly bitrateKbps: number | null;
  /** Every MPEG frame read, as Wave's native check does (MPEG-1 Layer III, 320 kbps, complete). */
  readonly mp3:
    | {
        readonly ok: true;
        readonly durationMs: number;
        readonly sampleRate: number;
        readonly frames: number;
      }
    | { readonly ok: false; readonly error: string };
  /** The quality report's cutoff: null when the spectrum has no cliff, which it counts as full band. */
  readonly cutoffHz: number | null;
  readonly cutoffError?: string;
  readonly tags: {
    readonly title: string | null;
    readonly artist: string | null;
    readonly album: string | null;
  };
}

export type Judgement =
  | { readonly accepted: true; readonly cutoffHz: number | null }
  | { readonly accepted: false; readonly reason: string };

const minutes = (ms: number): string => {
  const seconds = Math.round(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

/** Whether a spectrum passes the quality report's bar. */
export const reaches = (probe: Pick<Probe, "cutoffHz" | "cutoffError">): boolean =>
  probe.cutoffError === undefined && (probe.cutoffHz === null || probe.cutoffHz >= MIN_CUTOFF_HZ);

/**
 * Whether a downloaded file may replace [song]'s file: the same recording (Core's
 * received-tags check, the duration within 3 s), MPEG-1 Layer III at 320 kbps in
 * every frame, and a spectrum reaching 19.5 kHz as the quality report measures it.
 */
export const judgeDownload = (song: YtSong, probe: Probe): Judgement => {
  if (!probe.mp3.ok) return { accepted: false, reason: probe.mp3.error };
  const durationMs = probe.mp3.durationMs;
  if (song.durationMs !== null && Math.abs(durationMs - song.durationMs) > MAX_DURATION_GAP_MS)
    return {
      accepted: false,
      reason: `it lasts ${minutes(durationMs)}, the old file ${minutes(song.durationMs)}`,
    };
  if (!soulseekReceivedMatches(song, probe.tags, durationMs)) {
    const named = [probe.tags.artist, probe.tags.title].filter(hasText).join(" - ");
    const album = hasText(probe.tags.album) ? ` (${probe.tags.album})` : "";
    return { accepted: false, reason: `its tags name another recording: ${named}${album}` };
  }
  if (probe.cutoffError !== undefined)
    return { accepted: false, reason: `its spectrum couldn't be measured: ${probe.cutoffError}` };
  if (!reaches(probe))
    return {
      accepted: false,
      reason: `upscaled: its spectrum stops at ${(probe.cutoffHz ?? 0) / 1000} kHz`,
    };
  return { accepted: true, cutoffHz: probe.cutoffHz };
};

// ---- Resuming ----------------------------------------------------------------------

/** A peer file that was tried, and why it didn't replace the song. */
export interface TriedPeer {
  readonly username: string;
  readonly filename: string;
  readonly reason: string;
}

/** How one song ended, as appended to `Musicas-replace-log.jsonl`. */
export type Outcome =
  | {
      readonly outcome: "replaced";
      readonly path: string;
      readonly cutoffHz: number | null;
      readonly peer: { readonly username: string; readonly filename: string };
      readonly tried: readonly TriedPeer[];
      readonly sizeBefore: number;
      readonly sizeAfter: number;
      readonly sha256: string;
    }
  /** The file on disk already passes the bar (the copy kept from a duplicate, say). */
  | { readonly outcome: "already-good"; readonly path: string; readonly cutoffHz: number | null }
  | {
      readonly outcome: "rejected";
      readonly path: string;
      readonly query: string;
      readonly tried: readonly TriedPeer[];
    }
  | {
      readonly outcome: "no-candidates";
      readonly path: string;
      readonly query: string;
      readonly reports: number;
    }
  /** Something outside the song went wrong (offline, the file changed): tried again next run. */
  | { readonly outcome: "failed"; readonly path: string; readonly error: string };

export type LogRecord = Outcome & { readonly at: string; readonly entry: string };

export const parseReplaceLog = (text: string): LogRecord[] =>
  text.split(/\r?\n/).flatMap((line) => {
    if (line.trim() === "") return [];
    try {
      const record = JSON.parse(line) as LogRecord;
      return typeof record.entry === "string" && typeof record.outcome === "string"
        ? [{ ...record, entry: record.entry.normalize("NFC") }]
        : [];
    } catch {
      return [];
    }
  });

/** The record that settles [entry]: a replacement for good, else its latest one. */
export const settled = (entry: ListEntry, log: readonly LogRecord[]): LogRecord | undefined => {
  const records = log.filter((record) => record.entry === entry.line);
  return records.find((record) => record.outcome === "replaced") ?? records.at(-1);
};

/**
 * What a run does with [entry]: "try" it, or skip it because of how it ended
 * before. A replaced or already-good song is never tried again; a rejected one or
 * one nobody had is tried again only with --retry; a failure always is.
 */
export const toDo = (
  entry: ListEntry,
  log: readonly LogRecord[],
  options: { readonly retry: boolean },
): "try" | Exclude<Outcome["outcome"], "failed"> => {
  const last = settled(entry, log);
  if (last === undefined || last.outcome === "failed") return "try";
  if (options.retry && (last.outcome === "rejected" || last.outcome === "no-candidates"))
    return "try";
  return last.outcome;
};

// ---- The report --------------------------------------------------------------------

/** Where one list entry stands, for the report. */
export type ReportRow =
  | { readonly entry: ListEntry; readonly state: "not-found"; readonly reason: string }
  | {
      readonly entry: ListEntry;
      readonly state: "to-do";
      readonly path: string;
      readonly query: string;
      /** The current file's quality, when measured ("16.5 kHz, 320 kbps"). */
      readonly now?: string;
    }
  | { readonly entry: ListEntry; readonly state: "done"; readonly record: LogRecord };

const kHz = (hz: number | null): string => (hz === null ? "no cliff" : `${hz / 1000} kHz`);

const count = (label: string, n: number): string => `  ${`${label}:`.padEnd(31)}${n}`;
const line = (entry: ListEntry): string => `  ${entry.line}`;

const block = (title: string, lines: readonly string[], total: number): string =>
  `\n== ${title} (${total}) ==\n${lines.length === 0 ? "  (none)" : lines.join("\n")}`;

/** The text of `Musicas-replace-report.txt`. */
export const reportText = (
  rows: readonly ReportRow[],
  options: { readonly folder: string; readonly made: string; readonly dryRun: boolean },
): string => {
  const done = <K extends Outcome["outcome"]>(outcome: K) =>
    rows.flatMap((row) =>
      row.state === "done" && row.record.outcome === outcome
        ? [{ entry: row.entry, record: row.record as Extract<LogRecord, { outcome: K }> }]
        : [],
    );
  const replaced = done("replaced");
  const good = done("already-good");
  const rejected = done("rejected");
  const nobody = done("no-candidates");
  const failed = done("failed");
  const notFound = rows.flatMap((row) => (row.state === "not-found" ? [row] : []));
  const remaining = rows.flatMap((row) => (row.state === "to-do" ? [row] : []));
  return [
    `Soulseek replace report for ${options.folder}`,
    `Made ${options.made}.${options.dryRun ? " Dry run: nothing was downloaded or changed." : ""}`,
    "",
    "Summary",
    count("List entries", rows.length),
    count("Found on disk", rows.length - notFound.length),
    count("Not found on disk", notFound.length),
    count("Replaced", replaced.length),
    count("Already good (not replaced)", good.length),
    count("Rejected", rejected.length),
    count("Nobody on Soulseek had it", nobody.length),
    count("Failed (tried again next run)", failed.length),
    count("Still to do", remaining.length),
    block(
      "Replaced (list entry -> path [new cutoff, from peer: file])",
      replaced.map(
        ({ entry, record }) =>
          `${line(entry)} -> ${record.path} [${kHz(record.cutoffHz)}, from ${record.peer.username}: ${record.peer.filename}]`,
      ),
      replaced.length,
    ),
    block(
      "Rejected (every peer tried, and why)",
      rejected.map(
        ({ entry, record }) =>
          `${line(entry)} (${record.path}; searched "${record.query}")\n` +
          record.tried
            .map((peer) => `      ${peer.username}: ${peer.filename}: ${peer.reason}`)
            .join("\n"),
      ),
      rejected.length,
    ),
    block(
      "Nobody on Soulseek had it",
      nobody.map(
        ({ entry, record }) =>
          `${line(entry)} (${record.path}): no 320 kbps copy of this recording among ${record.reports} results for "${record.query}"`,
      ),
      nobody.length,
    ),
    block(
      "Not found on disk",
      notFound.map((row) => `${line(row.entry)}: ${row.reason}`),
      notFound.length,
    ),
    block(
      "Failed (tried again next run)",
      failed.map(({ entry, record }) => `${line(entry)} (${record.path}): ${record.error}`),
      failed.length,
    ),
    block(
      "Already good: the file on disk passes, so it isn't replaced",
      good.map(({ entry, record }) => `${line(entry)} -> ${record.path} [${kHz(record.cutoffHz)}]`),
      good.length,
    ),
    block(
      "Still to do (list entry -> path [now; Soulseek search])",
      remaining.map(
        (row) =>
          `${line(row.entry)} -> ${row.path} [${row.now === undefined ? "" : `now ${row.now}; `}search "${row.query}"]`,
      ),
      remaining.length,
    ),
    "",
  ].join("\n");
};
