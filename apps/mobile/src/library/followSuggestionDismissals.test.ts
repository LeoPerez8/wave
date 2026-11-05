import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { loadLibraryStore, loadWorktreeModule } from "../../bench/fastAgain/store.ts";
import { closeTestDatabase, openTestDatabase } from "./db/testDatabase.ts";
import type { LibraryStore } from "./LibraryStore.ts";

const moduleUrl = (source: string): string => `data:text/javascript,${encodeURIComponent(source)}`;

test("a dismissal and its Undo that saved succeed and show though reading the dismissals again fails", async () => {
  const root = fileURLToPath(new URL("../../../../", import.meta.url));
  const db = await openTestDatabase();
  // Replace the app runtime, navigation, React and the alert overlay; the
  // dismissals store, the LibraryStore service and SQLite are real.
  const storeUrl = new URL("./LibraryStore.ts", import.meta.url).href;
  const runtimeUrl = moduleUrl(`
    import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))};
    import { LibraryStore } from ${JSON.stringify(storeUrl)};
    let service;
    export const provide = value => { service = value; };
    export const appRuntime = {
      runPromise: effect => Effect.runPromise(Effect.provideService(effect, LibraryStore, service))
    };
  `);
  // The screen's focus is run by hand: `focus()` reads the dismissals as gaining focus does.
  const routerUrl = moduleUrl(`
    let focused = () => {};
    export const useFocusEffect = effect => { focused = effect; };
    export const focus = () => focused();
  `);
  const reactUrl = moduleUrl("export const useCallback = callback => callback;");
  const sightUrl = moduleUrl("export const useSightedStore = (subscribe, get) => get();");
  const alertUrl = moduleUrl(`
    export const errors = [];
    export const showError = (title, error) => { errors.push(error); };
  `);
  const localisationUrl = moduleUrl(
    "export const currentLocalisation = () => ({ strings: { library: {} } });",
  );
  const dismissalsUrl = import.meta.url.replace(
    "followSuggestionDismissals.test.ts",
    "followSuggestionDismissals.ts",
  );
  // `loadWorktreeModule` resolves bare packages from apps/mobile, so those
  // stubs match on the name alone, only while the dismissals module loads.
  const stubs: readonly (readonly [RegExp, string, "bare"?])[] = [
    [/(^\.\/runtime|\/runtime\.ts)$/, runtimeUrl],
    [/^expo-router$/, routerUrl, "bare"],
    [/^react$/, reactUrl, "bare"],
    [/lib\/screenSight(\.ts)?$/, sightUrl],
    [/overlay\/alert(\.tsx)?$/, alertUrl],
    [/localisation\/localisation(\.ts)?$/, localisationUrl],
  ];
  const loadDismissals = async () => {
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        const stub = stubs.find(
          ([pattern, bare]) =>
            (bare !== undefined || context.parentURL === dismissalsUrl) && pattern.test(specifier),
        );
        if (stub !== undefined) return { url: stub[1], shortCircuit: true };
        return nextResolve(specifier, context);
      },
    });
    try {
      return await loadWorktreeModule<typeof import("./followSuggestionDismissals.ts")>(
        root,
        "apps/mobile/src/library/followSuggestionDismissals.ts",
      );
    } finally {
      hooks.deregister();
    }
  };
  try {
    const store = await loadLibraryStore(root, db);
    const { LibraryStoreError } = await loadWorktreeModule<typeof import("./LibraryStore.ts")>(
      root,
      "apps/mobile/src/library/LibraryStore.ts",
    );
    let readsFail = false;
    const runtime = (await import(runtimeUrl)) as {
      provide: (service: LibraryStore["Service"]) => void;
    };
    runtime.provide({
      ...store,
      dismissedFollowSuggestions: Effect.suspend(() =>
        readsFail
          ? Effect.fail(new LibraryStoreError({ operation: "read", cause: "disk busy" }))
          : store.dismissedFollowSuggestions,
      ),
    });
    const router = (await import(routerUrl)) as { focus: () => void };
    const dismissals = await loadDismissals();
    const shown = () => dismissals.useDismissedFollowSuggestions();

    Effect.runSync(store.dismissFollowSuggestion("bjork"));
    shown();
    router.focus();
    while (shown() === undefined) await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(shown(), ["bjork"]);

    readsFail = true;
    await dismissals.dismissFollowSuggestion("portishead");
    assert.deepEqual(shown(), ["bjork", "portishead"]);
    await dismissals.undoFollowSuggestionDismissal("bjork");
    assert.deepEqual(shown(), ["portishead"]);

    readsFail = false;
    assert.deepEqual(Effect.runSync(store.dismissedFollowSuggestions), ["portishead"]);
  } finally {
    closeTestDatabase(db);
  }
});
