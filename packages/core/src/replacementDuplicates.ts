/**
 * The songs an interrupted quality replacement left twice (docs/spec.md, "YT
 * Music" › Download quality › Left twice): before replacements recorded the
 * old file's deletion, a kill between the swap and the deletion left the old
 * file on disk, and a scan made it a second song (`505.mp3` and `505.m4a`).
 * Which Library files are such a pair, which Track and file each keeps, and
 * what the check writes to the log.
 */

import type { QualityDirection } from "./qualityReplacement.ts";
import { qualityJobOf, qualityReplacementTarget } from "./qualityReplacement.ts";
import { normalizeSearchText } from "./search.ts";
import { RECORDING_LENGTH_TOLERANCE_MS } from "./sync.ts";
import type { YtDownloadJournalJob } from "./ytDownloads.ts";
import { ytDownloadsFromJournal } from "./ytDownloads.ts";

/** A Library file as the check sees it. */
export interface DuplicateCheckFile {
  /** Its Track. */
  readonly id: number;
  readonly path: string;
  /** Core's `recordingKey`; null while the Library isn't keyed yet. */
  readonly recordingKey: string | null;
  readonly title: string;
  readonly artists: readonly string[];
  /** As its tags say it; 0 when unknown. */
  readonly durationMs: number;
  /** Whether its Track has favorites, plays or playlist entries. */
  readonly history: boolean;
}

/** Two Tracks a replacement in a direction made of one song: the file it replaced, and its own. */
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
 * The pairs among [files] a replacement in [direction] left: one file and the
 * one its replacement goes to (Core's `qualityReplacementTarget`: the same
 * folder and name with the other extension), when both are one recording
 * (`sameRecording`). Anything else is no pair.
 */
export const replacementDuplicates = <F extends DuplicateCheckFile>(
  files: readonly F[],
  direction: QualityDirection,
): ReplacementDuplicate<F>[] => {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const source = direction === "upgrade" ? "soulseek" : "youtube";
  return files.flatMap((old) => {
    const { targetPath } = qualityReplacementTarget(old.path, source);
    const replacement = targetPath === old.path ? undefined : byPath.get(targetPath);
    return replacement === undefined || !sameRecording(old, replacement)
      ? []
      : [{ old, new: replacement }];
  });
};

/**
 * What becomes of a pair: the Track [keep] keeps its favorites, plays and
 * playlist entries and ends on the file at [path]; the bare Track [drop]
 * goes, and the file at [deleted] is deleted. Or the pair is left as it is.
 */
export type DuplicateFix<F extends DuplicateCheckFile = DuplicateCheckFile> =
  | {
      readonly kind: "fix";
      readonly keep: F;
      readonly drop: F;
      readonly path: string;
      readonly deleted: string;
    }
  /** A file isn't complete audio ([incomplete], old first): never delete what may be the only copy. */
  | {
      readonly kind: "leave";
      readonly reason: "incomplete";
      readonly incomplete: readonly string[];
    }
  /** Both Tracks have favorites, plays or playlist entries: which keeps them can't be told. */
  | { readonly kind: "leave"; readonly reason: "bothHistory" };

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

/**
 * How [pair] goes back to one song, given how long each file plays
 * ([lengths]). Both files must read as complete audio, or it's left as it
 * is. The Track with the history keeps it (with none on either, the one on
 * the file kept), and ends on the new file when it plays the old one's full
 * length (within 3 seconds), else on the old one. History on both is left.
 */
export const replacementDuplicateFix = <F extends DuplicateCheckFile>(
  pair: ReplacementDuplicate<F>,
  lengths: DuplicateLengths,
): DuplicateFix<F> => {
  const incomplete = [
    ...(complete(pair.old, lengths.old) ? [] : [pair.old.path]),
    ...(complete(pair.new, lengths.new) ? [] : [pair.new.path]),
  ];
  if (incomplete.length > 0) return { kind: "leave", reason: "incomplete", incomplete };
  if (pair.old.history && pair.new.history) return { kind: "leave", reason: "bothHistory" };
  const oldLength = lengths.old ?? pair.old.durationMs;
  const onNew = lengths.new !== null && within(lengths.new, oldLength);
  const [kept, gone] = onNew ? [pair.new, pair.old] : [pair.old, pair.new];
  const keep = gone.history ? gone : kept;
  return {
    kind: "fix",
    keep,
    drop: keep === kept ? gone : kept,
    path: kept.path,
    deleted: gone.path,
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
    return `${song} back to one song: its Track keeps its favorites, plays and playlist entries on ${outcome.path}; the second song went and ${outcome.deleted} was deleted`;
  switch (outcome.reason) {
    case "incomplete":
      return `${song} left twice: ${outcome.incomplete.join(" and ")} ${outcome.incomplete.length === 1 ? "isn't" : "aren't"} complete audio ${files}`;
    case "bothHistory":
      return `${song} left twice: both songs have favorites, plays or playlist entries ${files}`;
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
