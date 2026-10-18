import * as Effect from "effect/Effect";

import { appLog } from "@/log/appLog";
import { WaveNative, type FileDeleteOutcome } from "@/native/waveNative";

import { LibraryStore } from "./LibraryStore";

/**
 * Deletes the files [paths] (`WaveNative.deleteFiles`, telling the media scanner with
 * [scanWith]): each one's outcome, every one "failed" when the native call fails as a whole
 * (every file left where it was).
 */
export const deleteFilesOrFailed = (paths: readonly string[], scanWith: string | null) =>
  Effect.tryPromise(() => WaveNative.deleteFiles(paths, scanWith)).pipe(
    Effect.orElseSucceed((): readonly FileDeleteOutcome[] => paths.map(() => "failed")),
  );

/** Why the recorded deletions are being finished, as the log line says it. */
export type FileDeletionsWhen =
  "scan" | "import" | "replacementRun" | "failedReplacement" | "duplicateCheck";

const WHEN: Record<FileDeletionsWhen, string> = {
  scan: "before a scan",
  import: "after an import",
  replacementRun: "as a replacement run started",
  failedReplacement: "after a failed replacement",
  duplicateCheck: "after the check for songs a replacement left twice",
};

/**
 * Deletes the files recorded for deletion (`LibraryStore.pendingFileDeletions`):
 * a quality replacement's old file once its Track took the new one, or a failed
 * replacement's new file. A record is cleared once its file is gone or missing;
 * one that couldn't be deleted stays for the next time. Writes which files went
 * and which couldn't (tag `downloads`), but for [own], the deletion the caller
 * recorded itself (an import's old file: the usual end of a replacement, one
 * per song); other runs' leftovers it finishes are written all the same.
 * Never fails: resolves to the files still recorded, which a scan leaves out
 * so they never come back as songs. The media scanner hears of the deleted
 * files with its next batch, along with [scanWith] when given (an import's
 * new file, once its fill-in is done).
 */
export const finishFileDeletions = (
  when: FileDeletionsWhen,
  { scanWith = null, own = null }: { scanWith?: string | null; own?: string | null } = {},
) =>
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const pending = yield* store.pendingFileDeletions;
    if (pending.length === 0) return pending;
    const outcomes = yield* deleteFilesOrFailed(pending, scanWith);
    const outcomeOf = (path: string) => outcomes[pending.indexOf(path)] ?? "failed";
    const deleted = pending.filter((path) => outcomeOf(path) === "deleted" && path !== own);
    const done = pending.filter((path) => {
      const outcome = outcomeOf(path);
      return outcome === "deleted" || outcome === "missing";
    });
    const left = pending.filter((path) => !done.includes(path));
    yield* store.forgetFileDeletions(done);
    if (deleted.length > 0)
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
