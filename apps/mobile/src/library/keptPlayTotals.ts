/**
 * The app's settler of the kept play totals (#1349, `keptTotalsSettler.ts`):
 * started after the first screen settles, it takes one store step per
 * settled turn.
 */
import * as Effect from "effect/Effect";

import { settledTurnEffect } from "@/lib/backgroundWork";
import { appLog } from "@/log/appLog";

import { startKeptTotalsSettler } from "./keptTotalsSettler";
import { onLibraryChange } from "./libraryChanges";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

export const startKeptPlayTotals = (): (() => void) =>
  startKeptTotalsSettler({
    turn: () => Effect.runPromise(settledTurnEffect),
    step: () => appRuntime.runPromise(Effect.flatMap(LibraryStore, (store) => store.settleKeptTotals)),
    onChange: onLibraryChange,
    failed: (cause) => appLog("warn", "WaveLibrary", `Kept play totals didn't settle: ${String(cause)}`),
  });
