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
import { createHomeFollowReader } from "./homeFollowReader";
import { currentFollowCountry } from "@/settings/followCountry";

// Reuse the serialised value for equality and persistence instead of stringifying it twice.
const serialised = new WeakMap<HomeFollowSnapshot, string>();
const stored = (value: HomeFollowSnapshot | undefined): string | null => {
  if (value === undefined) return null;
  let result = serialised.get(value);
  if (result === undefined) {
    result = storedHomeFollowSnapshot(value);
    serialised.set(value, result);
  }
  return result;
};
export const knownHomeFollow = persistedSetting<HomeFollowSnapshot | undefined>({
  key: "home.followCards",
  read: parseHomeFollowSnapshot,
  write: stored,
  equals: (a, b) => stored(a) === stored(b),
});
/** Persist current follows for the next opening; never reuse a pre-write read. */
export const readHomeFollowForVisit = createHomeFollowReader((admitted) =>
  appRuntime.runPromise(
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
  ),
);

/** Refresh the phone cache without admitting cards to a visible visit. */
export const readHomeFollow = (): Promise<HomeFollowSnapshot> => readHomeFollowForVisit();
