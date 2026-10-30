import {
  parseHomeFollowSnapshot,
  storedHomeFollowSnapshot,
  type HomeFollowSnapshot,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { persistedSetting } from "@/lib/persistedSetting";
import { readHomeFollowSnapshot } from "./readHomeFollowSnapshot";
import { currentFollowCountry } from "@/settings/followCountry";

export const knownHomeFollow = persistedSetting<HomeFollowSnapshot | undefined>({
  key: "home.followCards",
  read: parseHomeFollowSnapshot,
  write: (value) => (value === undefined ? null : storedHomeFollowSnapshot(value)),
  equals: (a, b) => JSON.stringify(a) === JSON.stringify(b),
});
const reading = new Map<HomeFollowSnapshot | undefined, Promise<HomeFollowSnapshot>>();
/** Coalesce reads for the same visit; persist current follows for the next opening. */
export const readHomeFollowForVisit = (
  admitted?: HomeFollowSnapshot,
): Promise<HomeFollowSnapshot> => {
  const pending = reading.get(admitted);
  if (pending) return pending;
  const request = appRuntime
    .runPromise(
      Effect.gen(function* () {
        const store = yield* LibraryStore;
        const result = yield* readHomeFollowSnapshot(
          store,
          currentFollowCountry(),
          Date.now(),
          admitted,
        );
        knownHomeFollow.set(result.known);
        return result.visit;
      }),
    )
    .finally(() => {
      reading.delete(admitted);
    });
  reading.set(admitted, request);
  return request;
};

/** Refresh the phone cache without admitting cards to a visible visit. */
export const readHomeFollow = (): Promise<HomeFollowSnapshot> => readHomeFollowForVisit();
