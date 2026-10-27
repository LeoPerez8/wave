import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { scanInputColumns } from "./startupJobs";
import { startupTurnEffect } from "@/lib/backgroundWork";

import {
  WaveNative,
  type FolderPick,
  type ScanBatchEvent,
  type ScanCompleteEvent,
  type ScanMissingEvent,
  type ScanProgressEvent,
} from "@/native/waveNative";

/** An indexed file as an incremental scan compares it. */
export interface KnownFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: number;
}

export class ScanFailed extends Data.TaggedError("ScanFailed")<{ readonly message: string }> {}

export class FolderPickFailed extends Data.TaggedError("FolderPickFailed")<{
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Couldn't open the folder picker: ${String(this.cause)}`;
  }
}

export type ScanEvent =
  | ({ readonly _tag: "Progress" } & ScanProgressEvent)
  | ({ readonly _tag: "Missing" } & ScanMissingEvent)
  | ({ readonly _tag: "Batch" } & ScanBatchEvent)
  | ({ readonly _tag: "Complete" } & ScanCompleteEvent);

/** The native scanner as a typed service. */
export class NativeScanner extends Context.Service<
  NativeScanner,
  {
    readonly hasAllFilesAccess: Effect.Effect<boolean>;
    readonly defaultMusicFolder: Effect.Effect<string>;
    /** Lets the owner pick a folder with the system picker. */
    readonly pickFolder: Effect.Effect<FolderPick, FolderPickFailed>;
    /**
     * Scans [roots] minus [excluded], skipping the [known] files that haven't
     * changed. The stream emits progress, the known files that are gone
     * (`Missing`, before any batch) and batches, and ends with one `Complete`
     * event. Interrupting it cancels the native scan.
     */
    readonly scan: (
      roots: readonly string[],
      excluded: readonly string[],
      known: readonly KnownFile[],
    ) => Stream.Stream<ScanEvent, ScanFailed>;
  }
>()("@wave/mobile/library/NativeScanner") {}

/** The last scan's number: each scan takes the next, so the native side knows which is newest. */
let lastScanId = 0;

const scan = (
  roots: readonly string[],
  excluded: readonly string[],
  known: readonly KnownFile[],
): Stream.Stream<ScanEvent, ScanFailed> =>
  Stream.callback<ScanEvent, ScanFailed>((queue) =>
    Effect.acquireRelease(
      Effect.gen(function* () {
        const columns = yield* scanInputColumns(known, startupTurnEffect);
        yield* startupTurnEffect;
        // Chosen here, so events that arrive before the start resolves are already this scan's.
        const scanId = ++lastScanId;
        let finished = false;
        const subscriptions = [
          WaveNative.addListener("onScanProgress", (event) => {
            if (event.scanId === scanId) Queue.offerUnsafe(queue, { _tag: "Progress", ...event });
          }),
          WaveNative.addListener("onScanMissing", (event) => {
            if (event.scanId === scanId) Queue.offerUnsafe(queue, { _tag: "Missing", ...event });
          }),
          WaveNative.addListener("onScanBatch", (event) => {
            if (event.scanId === scanId) Queue.offerUnsafe(queue, { _tag: "Batch", ...event });
          }),
          WaveNative.addListener("onScanComplete", (event) => {
            if (event.scanId !== scanId) return;
            finished = true;
            Queue.offerUnsafe(queue, { _tag: "Complete", ...event });
            Queue.endUnsafe(queue);
          }),
          WaveNative.addListener("onScanError", (event) => {
            if (event.scanId !== scanId) return;
            finished = true;
            Queue.failCauseUnsafe(queue, Cause.fail(new ScanFailed({ message: event.message })));
          }),
        ];
        const started = WaveNative.startScan(
          scanId,
          roots,
          excluded,
          columns.paths,
          columns.sizes,
          columns.modified,
        ).then(
          () => true,
          (error: unknown) => {
            finished = true;
            const message = error instanceof Error ? error.message : String(error);
            Queue.failCauseUnsafe(queue, Cause.fail(new ScanFailed({ message })));
            return false;
          },
        );
        return {
          release: () => {
            for (const subscription of subscriptions) subscription.remove();
            // A cancel sent before the start is through would find no scan to cancel.
            if (!finished) void started.then((queued) => queued && WaveNative.cancelScan(scanId));
          },
        };
      }),
      (handle) => Effect.sync(handle.release),
    ),
  );

export const layer = Layer.succeed(NativeScanner, {
  hasAllFilesAccess: Effect.sync(() => WaveNative.hasAllFilesAccess()),
  defaultMusicFolder: Effect.sync(() => WaveNative.getDefaultMusicFolder()),
  pickFolder: Effect.tryPromise({
    try: () => WaveNative.pickFolder(),
    catch: (cause) => new FolderPickFailed({ cause }),
  }),
  scan,
});
