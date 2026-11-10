import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { EXPORT_WAITING_PROGRESS, exportingProgress, type ImportProgress } from "@wave/core";

import { stubModule } from "../perf/reactCompilerBuilds.ts";

/**
 * The export board as a playlist's row reads it (`useImportProgress`), with
 * the import stores stubbed empty.
 */
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const core = JSON.stringify(import.meta.resolve("@wave/core"));
const store = JSON.stringify(import.meta.resolve("../lib/externalStore.ts"));
const stubs: Record<string, string> = {
  "@/localisation/localisation": stubModule(`
    import { catalogueOf } from ${core};
    export const currentLocalisation = () => ({ language: "en", strings: catalogueOf("en") });
    export const useLocalisation = currentLocalisation;
  `),
  "@/lib/externalStore": stubModule(`export * from ${store};`),
  "./playlistImportsStore": stubModule(`
    import { makeExternalStore } from ${store};
    export const playlistImports = makeExternalStore({ imports: [] });
  `),
  "./ytLibraryBatchStore": stubModule(`
    import { makeExternalStore } from ${store};
    export const ytLibraryBatch = makeExternalStore({ reads: [], failed: [] });
    export const ytLibraryBatchPause = makeExternalStore(null);
  `),
};
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    const stub = stubs[specifier];
    if (stub !== undefined) return { url: stub, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});
let progress: typeof import("./importProgress.ts");
try {
  progress = await import("./importProgress.ts");
} finally {
  hooks.deregister();
}

/** What playlist [id]'s row reads now. */
const rowReads = (id: number): ImportProgress | null => {
  let read: ImportProgress | null = null;
  function Row() {
    read = progress.useImportProgress(id);
    return null;
  }
  let renderer: ReturnType<typeof create> | undefined;
  act(() => {
    renderer = create(createElement(Row));
  });
  act(() => renderer?.unmount());
  return read;
};

test("an exported playlist queued again says Waiting to export after its songs were counted", () => {
  progress.showExportProgress(7, exportingProgress(3, 3));
  progress.showExportProgress(7, EXPORT_WAITING_PROGRESS);
  assert.deepEqual(rowReads(7), EXPORT_WAITING_PROGRESS);
  progress.endExportProgress(7);
  assert.equal(rowReads(7), null);
});
