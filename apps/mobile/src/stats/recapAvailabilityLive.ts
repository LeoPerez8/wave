import * as Effect from "effect/Effect";
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import type { RecapPeriod } from "@wave/core";

import { appRuntime } from "@/library/runtime";
import { freeTurnEffect } from "@/lib/backgroundWork";
import { useScreenSight } from "@/lib/screenSight";
import { isScreenSettled, onScreenSettled } from "@/lib/timing";
import {
  observeRecapAvailability,
  shareRecapAvailability,
  type RecapAvailability,
} from "./recapAvailability";
import { Stats } from "./Stats";

let shared: Promise<RecapAvailability> | undefined;
const getRecapAvailability = (): Promise<RecapAvailability> => {
  shared ??= appRuntime
    .runPromise(
      // oxlint-disable-next-line react/rules-of-hooks -- Effect service accessor, not a React hook.
      Stats.use((stats) =>
        Effect.sync(() =>
          shareRecapAvailability({
            version: stats.recapHistoryVersion,
            read: (now, signal) =>
              appRuntime.runPromise(stats.recaps(now, freeTurnEffect), { signal }),
            schedule: (ms, run) => {
              const timer = setTimeout(run, ms);
              return () => clearTimeout(timer);
            },
          }),
        ),
      ),
    )
    .catch((error: unknown) => {
      shared = undefined;
      throw error;
    });
  return shared;
};

/** Home and the Recap list share one answer; sight, sheet coverage and settlement gate refreshes. */
export const useRecapAvailability = (): readonly RecapPeriod[] | undefined => {
  const sight = useScreenSight();
  const [value, setValue] = useState<readonly RecapPeriod[]>();
  useEffect(() => {
    let current = true;
    let stop: (() => void) | undefined;
    getRecapAvailability()
      .then((cache) => {
        if (!current) return;
        setValue(cache.get());
        stop = observeRecapAvailability(
          cache,
          {
            get: () => sight.visible() && isScreenSettled() && AppState.currentState === "active",
            subscribe: (changed) => {
              const stops = [sight.subscribe(changed), onScreenSettled(changed)];
              const activity = AppState.addEventListener("change", changed);
              return () => {
                for (const release of stops) release();
                activity.remove();
              };
            },
          },
          () => setValue(cache.get()),
        );
      })
      .catch(() => {
        /* Keep the last usable answer; a later visit retries initialization. */
      });
    return () => {
      current = false;
      stop?.();
    };
  }, [sight]);
  return value;
};
