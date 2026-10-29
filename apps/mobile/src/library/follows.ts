import { currentLocalisation } from "@/localisation/localisation";
import { useFocusEffect } from "expo-router";
import { useSightedStore } from "@/lib/screenSight";
import { followArtistKey, type FollowedArtist, type FollowLevel } from "@wave/core";
import * as Effect from "effect/Effect";
import { useCallback, useEffect } from "react";
import { makeExternalStore } from "@/lib/externalStore";
import { showError } from "@/overlay/alert";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";
import type { FollowTarget } from "./db/follows";

const count = makeExternalStore(0);
const list = makeExternalStore<readonly FollowedArtist[]>([]);
const artists = new Map<string, ReturnType<typeof makeExternalStore<FollowedArtist | null>>>();
const run = <A>(read: (store: LibraryStore["Service"]) => Effect.Effect<A, unknown>) =>
  appRuntime.runPromise(Effect.flatMap(LibraryStore, read));
const failed = (error: unknown) => showError(currentLocalisation().strings.library.couldntReadFollows, error);
const artistStore = (name: string) => {
  const key = followArtistKey(name);
  let store = artists.get(key);
  if (store === undefined) {
    store = makeExternalStore<FollowedArtist | null>(null);
    artists.set(key, store);
  }
  return store;
};
export const useFollow = (name: string): FollowedArtist | null => {
  const store = artistStore(name);
  useEffect(() => {
    if (name === "") return;
    let current = true;
    void run((s) => s.getFollow(name)).then((value) => {
      if (current) store.set(value);
    }, failed);
    return () => {
      current = false;
    };
  }, [name, store]);
  return useSightedStore(store.subscribe, store.get);
};
/** Settings reads COUNT(*), without loading follows. */
export const useFollowCount = (): number => {
  useEffect(() => {
    void run((s) => s.countFollows).then(count.set, failed);
  }, []);
  return useSightedStore(count.subscribe, count.get);
};
export const useFollows = (): readonly FollowedArtist[] => {
  useFocusEffect(
    useCallback(() => {
      let current = true;
      void run((s) => s.listFollows).then((value) => {
        if (current) list.set(value);
      }, failed);
      return () => {
        current = false;
      };
    }, []),
  );
  return useSightedStore(list.subscribe, list.get);
};
/** Resolves after the database write; only this artist's subscribers change state. */
export const setArtistFollow = async (
  target: FollowTarget,
  level: FollowLevel | null,
): Promise<void> => {
  const value = await run((s) =>
    Effect.gen(function* () {
      if (level === null) yield* s.unfollow(target.name);
      else yield* s.setFollow(target, level);
      return yield* s.getFollow(target.name);
    }),
  );
  artistStore(target.name).set(value);
  count.set(await run((s) => s.countFollows));
  if (list.listenerCount() > 0) list.set(await run((s) => s.listFollows));
};
/**
 * Reads follows again after the Wave account changed them (another phone
 * followed, unfollowed or changed a level): the count, the list while it's
 * shown, and every artist page's follow.
 */
export const reloadFollows = async (): Promise<void> => {
  const follows = await run((s) => s.listFollows);
  const byKey = new Map(follows.map((follow) => [follow.key, follow]));
  for (const [key, store] of artists) store.set(byKey.get(key) ?? null);
  count.set(follows.length);
  list.set(follows);
};
