/**
 * The app's settler of the kept play totals (#1349, `keptTotalsSettler.ts`):
 * started after the first screen settles, it takes one store step per
 * settled turn.
 */
import * as Effect from "effect/Effect";

import { settledTurnEffect } from "@/lib/backgroundWork";
import { namedWork } from "@/lib/stepped";
import { appLog } from "@/log/appLog";

import { startKeptTotalsSettler } from "./keptTotalsSettler";
import { onLibraryChange } from "./libraryChanges";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

export const startKeptPlayTotals = (): (() => void) =>
  startKeptTotalsSettler({
    turn: () => Effect.runPromise(settledTurnEffect.pipe(namedWork("kept play totals"))),
    step: () =>
      appRuntime.runPromise(
        Effect.flatMap(LibraryStore, (store) => store.settleKeptTotals).pipe(
          namedWork("kept play totals"),
        ),
      ),
    onChange: onLibraryChange,
    failed: (cause) => appLog("warn", "WaveLibrary", `Kept play totals didn't settle: ${String(cause)}`),
  });
