/**
 * The app's settler of the kept play totals (#1349, `keptTotalsSettler.ts`):
 * started after the first screen settles, it waits for a settled turn, then
 * runs what the totals owe in the scheduler's slices (#1350), one small
 * store step at a time, each slice on a free turn.
 */
import * as Effect from "effect/Effect";

import { freeTurnEffect, settledTurnEffect } from "@/lib/backgroundWork";
import { namedWork, runSteps } from "@/lib/stepped";
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
        Effect.flatMap(LibraryStore, (store) => store.keptTotalsSteps).pipe(
          Effect.flatMap((steps) => runSteps(steps, freeTurnEffect)),
          namedWork("kept play totals"),
        ),
      ),
    onChange: onLibraryChange,
    failed: (cause) =>
      appLog("warn", "WaveLibrary", `Kept play totals didn't settle: ${String(cause)}`),
  });
