import {
  duplicateCheckOpened,
  duplicateCheckStep,
  replacementDuplicateFix,
  replacementDuplicateLines,
  replacementDuplicates,
  replacementsUnderway,
  type DuplicateCheck,
  type DuplicateCheckEvent,
  type DuplicateCheckWhen,
  type DuplicateOutcome,
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
 * replacement run that was interrupted, kept on this phone. When it runs is Core's
 * (`duplicateCheckStep`); this module only keeps the phone's copy and runs it.
 */
const KEY = "downloads.replacementDuplicatesCheck";

/** The check's log lines go with the download service's own. */
const TAG = "WaveDownloads";

/**
 * Finds the pairs a replacement left (Core's `replacementDuplicates`), reads how long both files
 * play, and puts each pair back to one song as Core decides (`replacementDuplicateFix`): the
 * second Track hands its history to the kept one and goes, and the other file is deleted through
 * the recorded deletion (`finishFileDeletions`). Writes what it did (tag `WaveDownloads`, as the
 * download service's own lines).
 */
const checkReplacementDuplicates = (when: DuplicateCheckWhen) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const pairs = replacementDuplicates(yield* store.duplicateCheckFiles);
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

let check: DuplicateCheck | undefined;

/** Tells the check [event] (Core's `duplicateCheckStep`) and does what it asks. */
const tell = (event: DuplicateCheckEvent): void => {
  const step = duplicateCheckStep(
    (check ??= duplicateCheckOpened(Storage.getItemSync(KEY))),
    event,
  );
  check = step.check;
  if (step.store !== null) Storage.setItemSync(KEY, step.store);
  if (step.readJournal)
    void WaveSoulseek.jobsSnapshot()
      .then(replacementJournalRead)
      .catch(() => undefined);
  if (step.run !== null) void run(step.run);
};

const run = async (when: DuplicateCheckWhen): Promise<void> => {
  try {
    await appRuntime.runPromise(checkReplacementDuplicates(when));
    tell({ kind: "ran", ok: true });
  } catch (error: unknown) {
    // Due still: the next launch tries again.
    appLog("warn", TAG, `Couldn't check for songs a replacement left twice: ${String(error)}`);
    tell({ kind: "ran", ok: false });
  }
};

/** The launch scan finished: the check runs now if it's due. */
export const launchScanDone = (): void => tell({ kind: "scanDone" });

/**
 * The journal's [jobs] as the downloads read them: whether quality replacements are on their way
 * (Core's `replacementsUnderway`), which at the launch's first read means the last run was
 * interrupted, and otherwise lets a due check run.
 */
export const replacementJournalRead = (jobs: readonly YtDownloadJournalJob[]): void =>
  tell({ kind: "journalRead", underway: replacementsUnderway(jobs) });
