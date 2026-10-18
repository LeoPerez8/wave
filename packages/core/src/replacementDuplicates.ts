/**
 * The songs an interrupted quality replacement left twice (docs/spec.md, "YT
 * Music" › Download quality › Left twice): before replacements recorded the
 * old file's deletion, a kill between the swap and the deletion left the old
 * file on disk, and a scan made it a second song (`505.mp3` and `505.m4a`).
 * Which Library files are such a pair, which Track and file each keeps, when
 * the check runs, and what it writes to the log.
 */

import { qualityJobOf, qualityReplacementTarget } from "./qualityReplacement.ts";
import { normalizeSearchText } from "./search.ts";
import { RECORDING_LENGTH_TOLERANCE_MS } from "./sync.ts";
import type { YtDownloadJournalJob } from "./ytDownloads.ts";
import { ytDownloadsFromJournal } from "./ytDownloads.ts";

/** A Library file as the check sees it. */
export interface DuplicateCheckFile {
  /** Its Track: a higher id is a Track made later. */
  readonly id: number;
  readonly path: string;
  /** Core's `recordingKey`; null while the Library isn't keyed yet. */
  readonly recordingKey: string | null;
  readonly title: string;
  readonly artists: readonly string[];
  /** As its tags say it; 0 when unknown. */
  readonly durationMs: number;
  /** Whether its Track is starred. */
  readonly favorite: boolean;
  /** How many plays its Track has. */
  readonly plays: number;
  /** The playlists holding an entry of its Track (each once, in id order). */
  readonly playlists: readonly number[];
}

/**
 * Two Tracks of one song a replacement left: [new], the Track the replacement
 * moved onto its new file (the older Track, with the song's history), and
 * [old], the Track a later scan made for the file it left behind.
 */
export interface ReplacementDuplicate<F extends DuplicateCheckFile = DuplicateCheckFile> {
  readonly old: F;
  readonly new: F;
}

const sameArtists = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length &&
  a.every((artist, i) => normalizeSearchText(artist) === normalizeSearchText(b[i] ?? ""));

/**
 * Whether [a] and [b] are one recording: the same recording key, or the same
 * title and artists (case, accents and punctuation aside) and lengths within 3 seconds.
 */
const sameRecording = (a: DuplicateCheckFile, b: DuplicateCheckFile): boolean =>
  (a.recordingKey !== null && a.recordingKey === b.recordingKey) ||
  (normalizeSearchText(a.title) === normalizeSearchText(b.title) &&
    sameArtists(a.artists, b.artists) &&
    Math.abs(a.durationMs - b.durationMs) <= RECORDING_LENGTH_TOLERANCE_MS);

/**
 * The pairs among [files] a replacement left: an MP3 and an M4A of the same
 * folder and name (what a replacement either way makes of a file, Core's
 * `qualityReplacementTarget`) that are one recording (`sameRecording`).
 * Whichever way the replacement went, the older Track is the one it moved onto
 * its new file, and the newer one a scan made of the file left behind, so the
 * Download in best quality switch as it stands now doesn't matter.
 */
export const replacementDuplicates = <F extends DuplicateCheckFile>(
  files: readonly F[],
): ReplacementDuplicate<F>[] => {
  const byPath = new Map(files.map((file) => [file.path, file]));
  return files.flatMap((older) =>
    (["soulseek", "youtube"] as const).flatMap((source) => {
      const { targetPath } = qualityReplacementTarget(older.path, source);
      const newer = targetPath === older.path ? undefined : byPath.get(targetPath);
      return newer === undefined || newer.id <= older.id || !sameRecording(older, newer)
        ? []
        : [{ old: newer, new: older }];
    }),
  );
};

/**
 * The bare-or-not Track that goes hands what it has to the one kept: its star
 * when the kept one has none, its plays, and its playlist entries (those in a
 * playlist already holding the kept Track go, so no playlist names it twice).
 */
export interface DuplicateMerge {
  /** Star the kept Track: the one that goes is starred and it isn't. */
  readonly star: boolean;
  /** Move the plays of the Track that goes to the kept one. */
  readonly movePlays: boolean;
  /** Playlists whose entries of the Track that goes now name the kept one. */
  readonly repoint: readonly number[];
  /** Playlists already holding the kept Track: the entries of the one that goes leave them. */
  readonly remove: readonly number[];
}

/**
 * What becomes of a pair: the Track [keep] keeps its favorites, plays and
 * playlist entries, takes [drop]'s ([merge], null when [drop] is bare) and
 * ends on the file at [path]; [drop] goes, and the file at [deleted] is
 * deleted. Or the pair is left as it is.
 */
export type DuplicateFix<F extends DuplicateCheckFile = DuplicateCheckFile> =
  | {
      readonly kind: "fix";
      readonly keep: F;
      readonly drop: F;
      readonly path: string;
      readonly deleted: string;
      readonly merge: DuplicateMerge | null;
    }
  /** Neither file is complete audio ([incomplete], old first): never delete what may be the only copy. */
  | {
      readonly kind: "leave";
      readonly reason: "incomplete";
      readonly incomplete: readonly string[];
    };

/** How long each file of a pair plays, read from its audio to its end; null when it can't be read. */
export interface DuplicateLengths {
  readonly old: number | null;
  readonly new: number | null;
}

const within = (a: number, b: number): boolean => Math.abs(a - b) <= RECORDING_LENGTH_TOLERANCE_MS;

/** Whether [file] reads as complete audio: it plays ([lengthMs]) to the length its tags say, or near it. */
const complete = (file: DuplicateCheckFile, lengthMs: number | null): boolean =>
  lengthMs !== null &&
  lengthMs > 0 &&
  (file.durationMs <= 0 || lengthMs >= file.durationMs - RECORDING_LENGTH_TOLERANCE_MS);

const hasHistory = (file: DuplicateCheckFile): boolean =>
  file.favorite || file.plays > 0 || file.playlists.length > 0;

/** What [drop] hands to [keep] ([DuplicateMerge]); null when it has nothing. */
const mergeOf = (keep: DuplicateCheckFile, drop: DuplicateCheckFile): DuplicateMerge | null =>
  hasHistory(drop)
    ? {
        star: drop.favorite && !keep.favorite,
        movePlays: drop.plays > 0,
        repoint: drop.playlists.filter((id) => !keep.playlists.includes(id)),
        remove: drop.playlists.filter((id) => keep.playlists.includes(id)),
      }
    : null;

/**
 * How [pair] goes back to one song, given how long each file plays
 * ([lengths]). The older Track (the replacement's, [pair.new]) stays and takes
 * the other's history. It ends on the new file when that is complete audio and
 * plays the song's full length (the old file's, within 3 seconds; its tags'
 * when the old file is cut short), else on the old file when that is complete.
 * With neither complete, the pair is left as it is.
 */
export const replacementDuplicateFix = <F extends DuplicateCheckFile>(
  pair: ReplacementDuplicate<F>,
  lengths: DuplicateLengths,
): DuplicateFix<F> => {
  const oldComplete = complete(pair.old, lengths.old);
  const songLength = oldComplete ? (lengths.old ?? 0) : pair.old.durationMs;
  const onNew =
    complete(pair.new, lengths.new) && (songLength <= 0 || within(lengths.new ?? 0, songLength));
  if (!onNew && !oldComplete)
    return { kind: "leave", reason: "incomplete", incomplete: [pair.old.path, pair.new.path] };
  return {
    kind: "fix",
    keep: pair.new,
    drop: pair.old,
    path: onNew ? pair.new.path : pair.old.path,
    deleted: onNew ? pair.old.path : pair.new.path,
    merge: mergeOf(pair.new, pair.old),
  };
};

/** Why the check ran: once after the update that brought it, or after an interrupted run. */
export type DuplicateCheckWhen = "update" | "interruptedRun";

const CHECKED = "done";

/**
 * When the check is due, as the phone keeps it ([stored], `storedDuplicateCheck`):
 * nothing kept is the update that brought it; once it ran, nothing until a
 * replacement run is interrupted.
 */
export const duplicateCheckDue = (stored: string | null): DuplicateCheckWhen | null =>
  stored === CHECKED ? null : stored === "interruptedRun" ? "interruptedRun" : "update";

/** What the phone keeps for [due] (`duplicateCheckDue`): null once the check ran. */
export const storedDuplicateCheck = (due: DuplicateCheckWhen | null): string => due ?? CHECKED;

/**
 * Whether quality replacements in the journal's [jobs] are still on their way
 * (queued, downloading or saving): found at launch, the last run was
 * interrupted; the check waits until they're through.
 */
export const replacementsUnderway = (jobs: readonly YtDownloadJournalJob[]): boolean =>
  ytDownloadsFromJournal(jobs).jobs.some(
    ({ song, status }) =>
      qualityJobOf(song.videoId) !== null &&
      (status.kind === "queued" || status.kind === "downloading" || status.kind === "saving"),
  );

/** Where the check stands this launch (`duplicateCheckOpened`, `duplicateCheckStep`). */
export interface DuplicateCheck {
  /** Why it's due (kept on the phone), or null. */
  readonly due: DuplicateCheckWhen | null;
  /** Whether the launch scan finished: the check reads the Library it leaves. */
  readonly scanned: boolean;
  /** Whether the last journal read found replacements on their way; null before the launch's first. */
  readonly underway: boolean | null;
  /** The check running now, or null. */
  readonly running: DuplicateCheckWhen | null;
  /** Whether it ran this launch: at most once, and one that failed stays due for the next. */
  readonly checked: boolean;
}

/** What the app tells the check: the launch scan finished, the journal was read, or it ran. */
export type DuplicateCheckEvent =
  | { readonly kind: "scanDone" }
  | { readonly kind: "journalRead"; readonly underway: boolean }
  | { readonly kind: "ran"; readonly ok: boolean };

/**
 * After an event: where the check stands, what to keep on the phone (null: as
 * it is), whether to run it now (and why), and whether to read the journal
 * first (nothing read it yet this launch).
 */
export interface DuplicateCheckStep {
  readonly check: DuplicateCheck;
  readonly store: string | null;
  readonly run: DuplicateCheckWhen | null;
  readonly readJournal: boolean;
}

/** The check as a launch finds it, from what the phone keeps ([stored]). */
export const duplicateCheckOpened = (stored: string | null): DuplicateCheck => ({
  due: duplicateCheckDue(stored),
  scanned: false,
  underway: null,
  running: null,
  checked: false,
});

/**
 * The check after [event]. Replacements on their way at the launch's first
 * journal read mean the last run was interrupted, which makes the check due
 * (unless the update's is). It runs when it's due, the launch scan is through,
 * no replacement is on its way and it hasn't run this launch; once it ran
 * without failing, it's due no more until another run is interrupted, however
 * many pairs it left alone.
 */
export const duplicateCheckStep = (
  check: DuplicateCheck,
  event: DuplicateCheckEvent,
): DuplicateCheckStep => {
  let next = check;
  let store: string | null = null;
  switch (event.kind) {
    case "scanDone":
      next = { ...check, scanned: true };
      break;
    case "journalRead":
      if (check.underway === null && event.underway && check.due !== "update") {
        next = { ...next, due: "interruptedRun" };
        store = storedDuplicateCheck("interruptedRun");
      }
      next = { ...next, underway: event.underway };
      break;
    case "ran":
      next = { ...check, running: null };
      if (event.ok && check.due === check.running) {
        next = { ...next, due: null };
        store = storedDuplicateCheck(null);
      }
      break;
  }
  const ready = next.due !== null && next.scanned && next.running === null && !next.checked;
  if (ready && next.underway === false) {
    const run = next.due;
    return { check: { ...next, running: run, checked: true }, store, run, readJournal: false };
  }
  return {
    check: next,
    store,
    run: null,
    readJournal: ready && next.underway === null && event.kind === "scanDone",
  };
};

/** What became of a pair: its fix, or left because the Library changed while it was checked. */
export type DuplicateOutcome =
  DuplicateFix | { readonly kind: "leave"; readonly reason: "changed" };

const WHEN: Record<DuplicateCheckWhen, string> = {
  update: "after the update",
  interruptedRun: "after an interrupted replacement run",
};

const outcomeLine = (pair: ReplacementDuplicate, outcome: DuplicateOutcome): string => {
  const song = `"${pair.old.title}"`;
  const files = `(${pair.old.path}, ${pair.new.path})`;
  if (outcome.kind === "fix")
    return `${song} back to one song: its Track keeps its favorites, plays and playlist entries on ${outcome.path}${outcome.merge === null ? "" : " and takes the second song's"}; the second song went and ${outcome.deleted} was deleted`;
  switch (outcome.reason) {
    case "incomplete":
      return `${song} left twice: ${outcome.incomplete.join(" and ")} ${outcome.incomplete.length === 1 ? "isn't" : "aren't"} complete audio ${files}`;
    case "changed":
      return `${song} left twice: the Library changed while it was checked ${files}`;
  }
};

/**
 * What the check that ran [when] writes to the log (tag `WaveDownloads`):
 * how many pairs it found, fixed and left alone, then a line per song it
 * changed or left.
 */
export const replacementDuplicateLines = (
  when: DuplicateCheckWhen,
  outcomes: readonly { readonly pair: ReplacementDuplicate; readonly outcome: DuplicateOutcome }[],
): string[] => {
  const fixed = outcomes.filter(({ outcome }) => outcome.kind === "fix").length;
  const pairs = `${outcomes.length} ${outcomes.length === 1 ? "pair" : "pairs"}`;
  return [
    `Songs a replacement left twice, checked ${WHEN[when]}: ${pairs} found, ${fixed} fixed, ${outcomes.length - fixed} left alone`,
    ...outcomes.map(({ pair, outcome }) => outcomeLine(pair, outcome)),
  ];
};
