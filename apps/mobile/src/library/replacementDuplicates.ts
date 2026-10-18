import {
  duplicateCheckDue,
  replacementDuplicateFix,
  replacementDuplicateLines,
  replacementDuplicates,
  replacementsUnderway,
  storedDuplicateCheck,
  type DuplicateCheckWhen,
  type DuplicateOutcome,
  type QualityDirection,
  type ReplacementDuplicate,
  type YtDownloadJournalJob,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { Storage } from "expo-sqlite/kv-store";

import { appLog } from "@/log/appLog";
import { WaveNative } from "@/native/waveNative";
import { WaveSoulseek } from "@/native/waveSoulseek";

import { finishFileDeletions } from "./fileDeletions";
import { libraryEdited } from "./LibraryScan";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

/**
 * The check for songs an interrupted quality replacement left twice (docs/spec.md, "YT Music" ›
 * Download quality › Left twice): due once after the update that brings it, and again after a
 * replacement run that was interrupted (Core's `duplicateCheckDue`), kept on this phone.
 */
const KEY = "downloads.replacementDuplicatesCheck";

/** The check's log lines go with the download service's own. */
const TAG = "WaveDownloads";

let due: DuplicateCheckWhen | null | undefined;
const dueNow = (): DuplicateCheckWhen | null =>
  (due ??= duplicateCheckDue(Storage.getItemSync(KEY)));
const setDue = (when: DuplicateCheckWhen | null): void => {
  due = when;
  Storage.setItemSync(KEY, storedDuplicateCheck(when));
};

/** Whether this launch's scan finished: the check reads the Library it leaves. */
let scanned = false;
/** Whether the journal was read since launch: its first read tells an interrupted run. */
let journalRead = false;
let running = false;
/** At most once a launch: one that failed stays due for the next. */
let checked = false;

/**
 * Finds the pairs a replacement left (Core's `replacementDuplicates`, in the direction Download
 * in best quality's switch calls for), reads how long both files play, and puts each pair back
 * to one song as Core decides (`replacementDuplicateFix`): the bare Track goes and the other
 * file is deleted through the recorded deletion (`finishFileDeletions`). Writes what it did
 * (tag `WaveDownloads`, as the download service's own lines).
 */
const checkReplacementDuplicates = (when: DuplicateCheckWhen) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const session = yield* Effect.tryPromise(() => WaveSoulseek.session());
    const direction: QualityDirection = session.status === "off" ? "downgrade" : "upgrade";
    const pairs = replacementDuplicates(yield* store.duplicateCheckFiles, direction);
    const lengths =
      pairs.length === 0
        ? []
        : yield* Effect.tryPromise(() =>
            WaveNative.readAudioLengths(pairs.flatMap((pair) => [pair.old.path, pair.new.path])),
          );
    const outcomes: { pair: ReplacementDuplicate; outcome: DuplicateOutcome }[] = [];
    const changed: number[] = [];
    for (const [i, pair] of pairs.entries()) {
      const fix = replacementDuplicateFix(pair, {
        old: lengths[2 * i] ?? null,
        new: lengths[2 * i + 1] ?? null,
      });
      if (fix.kind === "leave") {
        outcomes.push({ pair, outcome: fix });
        continue;
      }
      const fixed = yield* store.fixReplacementDuplicate(fix);
      outcomes.push({ pair, outcome: fixed ? fix : { kind: "leave", reason: "changed" } });
      if (fixed) changed.push(fix.keep.id, fix.drop.id);
    }
    if (changed.length > 0) {
      yield* finishFileDeletions("duplicateCheck");
      libraryEdited(changed);
    }
    const [summary, ...songs] = replacementDuplicateLines(when, outcomes);
    if (summary !== undefined) appLog("info", TAG, summary);
    for (const [i, line] of songs.entries())
      appLog(outcomes[i]?.outcome.kind === "fix" ? "info" : "warn", TAG, line);
  });

/** Runs the check when it's due, the launch scan is through and no replacement is on its way. */
const checkWhenDue = (jobs: readonly YtDownloadJournalJob[] | null): void => {
  const when = dueNow();
  if (when === null || !scanned || running || checked) return;
  running = true;
  void (async () => {
    try {
      if (replacementsUnderway(jobs ?? (await WaveSoulseek.jobsSnapshot()))) return;
      checked = true;
      await appRuntime.runPromise(checkReplacementDuplicates(when));
      // Not again until another run is interrupted, however many pairs it left alone.
      if (dueNow() === when) setDue(null);
    } catch (error: unknown) {
      // Due still: the next launch tries again.
      appLog("warn", TAG, `Couldn't check for songs a replacement left twice: ${String(error)}`);
    } finally {
      running = false;
    }
  })();
};

/** The launch scan finished: the check runs now if it's due. */
export const launchScanDone = (): void => {
  scanned = true;
  checkWhenDue(null);
};

/**
 * The journal's [jobs] as the downloads read them: replacements still on their way at the
 * first read since launch mean the last run was interrupted (Core's `replacementsUnderway`),
 * which makes the check due; once none are, a due check runs.
 */
export const replacementJournalRead = (jobs: readonly YtDownloadJournalJob[]): void => {
  const underway = replacementsUnderway(jobs);
  if (!journalRead && underway && dueNow() !== "update") setDue("interruptedRun");
  journalRead = true;
  if (!underway) checkWhenDue(jobs);
};
