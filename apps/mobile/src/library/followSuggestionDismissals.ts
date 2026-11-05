import { currentLocalisation } from "@/localisation/localisation";
import { useFocusEffect } from "expo-router";
import * as Effect from "effect/Effect";
import { useCallback } from "react";
import { makeExternalStore } from "@/lib/externalStore";
import { useSightedStore } from "@/lib/screenSight";
import { showError } from "@/overlay/alert";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

/** The dismissed suggestions' follow keys; undefined until read once. */
const dismissed = makeExternalStore<readonly string[] | undefined>(undefined);
const run = <A>(read: (store: LibraryStore["Service"]) => Effect.Effect<A, unknown>) =>
  appRuntime.runPromise(Effect.flatMap(LibraryStore, read));
const read = async (): Promise<void> => {
  dismissed.set(await run((s) => s.dismissedFollowSuggestions));
};

/**
 * The follow keys of the follow suggestions the owner dismissed, read when
 * the screen gains focus; undefined until first read, so a dismissed artist
 * never flashes as a suggestion.
 */
export const useDismissedFollowSuggestions = (): readonly string[] | undefined => {
  useFocusEffect(
    useCallback(() => {
      void read().catch((error) =>
        showError(currentLocalisation().strings.library.couldntReadFollows, error),
      );
    }, []),
  );
  return useSightedStore(dismissed.subscribe, dismissed.get);
};

/**
 * Reads the dismissals again after the Wave account changed them (another
 * phone dismissed a suggestion or undid one); not read yet, the next focus
 * reads them.
 */
export const reloadFollowSuggestionDismissals = async (): Promise<void> => {
  if (dismissed.get() !== undefined) await read();
};

/**
 * Shows a saved dismissal ([on]) or its Undo in the list read, without
 * reading it again: once the write is saved, nothing can fail. Not read
 * yet, the next focus reads it.
 */
const show = (key: string, on: boolean): void => {
  const keys = dismissed.get();
  if (keys === undefined) return;
  const others = keys.filter((other) => other !== key);
  dismissed.set(on ? [...others, key].sort() : others);
};

/** Dismisses the suggestion of the artist with follow key [key]; resolves once saved. */
export const dismissFollowSuggestion = async (key: string): Promise<void> => {
  await run((s) => s.dismissFollowSuggestion(key));
  show(key, true);
};

/** Undo after a dismissal: the artist goes back to their place among the suggestions. */
export const undoFollowSuggestionDismissal = async (key: string): Promise<void> => {
  await run((s) => s.undoFollowSuggestionDismissal(key));
  show(key, false);
};
