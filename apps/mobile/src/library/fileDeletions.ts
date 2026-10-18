import * as Effect from "effect/Effect";

import { appLog } from "@/log/appLog";
import { WaveNative, type FileDeleteOutcome } from "@/native/waveNative";

import { LibraryStore } from "./LibraryStore";

/** Why the recorded deletions are being finished, as the log line says it. */
export type FileDeletionsWhen = "scan" | "import" | "replacementRun" | "failedReplacement";

const WHEN: Record<FileDeletionsWhen, string> = {
  scan: "before a scan",
  import: "after an import",
  replacementRun: "as a replacement run started",
  failedReplacement: "after a failed replacement",
};

/**
 * Deletes the files recorded for deletion (`LibraryStore.pendingFileDeletions`):
 * a quality replacement's old file once its Track took the new one, or a failed
 * replacement's new file. A record is cleared once its file is gone or missing;
 * one that couldn't be deleted stays for the next time. Writes which files went
 * (but for an import's own, one per replaced song) and which couldn't (tag
 * `downloads`). Never fails: resolves to the files still
 * recorded, which a scan leaves out so they never come back as songs. The
 * media scanner hears of the deleted files with its next batch, along with
 * [scanWith] when given (an import's new file, once its fill-in is done).
 */
export const finishFileDeletions = (when: FileDeletionsWhen, scanWith: string | null = null) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const pending = yield* store.pendingFileDeletions;
    if (pending.length === 0) return pending;
    const outcomes = yield* Effect.tryPromise(() => WaveNative.deleteFiles(pending, scanWith)).pipe(
      // The native call failing as a whole leaves every file where it was.
      Effect.orElseSucceed((): readonly FileDeleteOutcome[] => pending.map(() => "failed")),
    );
    const outcomeOf = (path: string) => outcomes[pending.indexOf(path)] ?? "failed";
    const deleted = pending.filter((path) => outcomeOf(path) === "deleted");
    const done = pending.filter((path) => {
      const outcome = outcomeOf(path);
      return outcome === "deleted" || outcome === "missing";
    });
    const left = pending.filter((path) => !done.includes(path));
    yield* store.forgetFileDeletions(done);
    // An import's own deletion is the usual end of a replacement, one per song: not worth a line.
    if (deleted.length > 0 && when !== "import")
      appLog(
        "info",
        "downloads",
        `Finished ${deleted.length} recorded file deletion${deleted.length === 1 ? "" : "s"} ${WHEN[when]}: ${deleted.join(", ")}`,
      );
    if (left.length > 0)
      appLog(
        "warn",
        "downloads",
        `Couldn't delete ${left.length} recorded file${left.length === 1 ? "" : "s"} ${WHEN[when]}; tried again later: ${left
          .map((path) => `${path} (${outcomeOf(path)})`)
          .join(", ")}`,
      );
    return left;
  }).pipe(
    Effect.catch((error) =>
      Effect.sync((): readonly string[] => {
        appLog(
          "warn",
          "downloads",
          `Couldn't read the files recorded for deletion: ${String(error)}`,
        );
        return [];
      }),
    ),
  );
