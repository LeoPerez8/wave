/** Load actual worktree source, with Node resolution and a desktop DB bootstrap. */
import * as Effect from "effect/Effect";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { LibraryStore } from "../../src/library/LibraryStore.ts";

import type { TestDatabase } from "@wave/client/testing";
import { setDesktopDatabase } from "./platformDatabase.ts";

const dependencyParent = new URL("../../package.json", import.meta.url).href;
const platform = new URL("./platformDatabase.ts", import.meta.url).href;

/**
 * Resolve .ts and @/ imports in the selected repository, preserving its Core
 * and query modules. Installed third-party dependencies come from the harness
 * so Effect services share one runtime. No source text is rewritten.
 * Node >=22.18 supplies synchronous module hooks and TypeScript stripping.
 */
export const loadWorktreeModule = async <A = Record<string, unknown>>(
  root: string,
  relativePath: string,
): Promise<A> => {
  const base = resolve(root);
  const driverUrl = pathToFileURL(resolve(base, "apps/mobile/src/library/sqliteDriver.ts")).href;
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (
        context.parentURL === driverUrl &&
        ["expo-sqlite", "drizzle-orm/expo-sqlite", "drizzle-orm/expo-sqlite/migrator"].includes(
          specifier,
        )
      )
        return { url: platform, shortCircuit: true };
      if (specifier.startsWith("@wave/client")) {
        const suffix = specifier.slice("@wave/client".length);
        const path =
          suffix === ""
            ? "index"
            : suffix === "/testing"
              ? "db/testDatabase"
              : suffix === "/testing/fastAgainFixture"
                ? "db/fastAgainFixture"
                : suffix.slice(1);
        return nextResolve(
          pathToFileURL(resolve(base, "packages/client/src", `${path}.ts`)).href,
          context,
        );
      }
      if (specifier === "@wave/core") {
        return nextResolve(
          pathToFileURL(resolve(base, "packages/core/src/index.ts")).href,
          context,
        );
      }
      if (specifier.startsWith("@/")) {
        specifier = pathToFileURL(resolve(base, "apps/mobile/src", specifier.slice(2))).href;
      }
      if (specifier.startsWith(".") || specifier.startsWith("file:")) {
        const url = new URL(specifier, context.parentURL);
        if (extname(url.pathname) === "" && existsSync(new URL(`${url.href}.ts`))) {
          return nextResolve(`${url.href}.ts`, context);
        }
      } else if (!specifier.startsWith("node:")) {
        return nextResolve(specifier, { ...context, parentURL: dependencyParent });
      }
      return nextResolve(specifier, context);
    },
  });
  try {
    const path = relativePath.startsWith("@wave/client/")
      ? resolve(base, "packages/client/src", `${relativePath.slice("@wave/client/".length)}.ts`)
      : resolve(base, relativePath);
    return (await import(pathToFileURL(path).href)) as A;
  } finally {
    hooks.deregister();
  }
};

/** Sequential bootstrap only; returned services keep their own fixture DB. */
export const loadLibraryStore = async (
  root: string,
  db: TestDatabase,
  options: { readonly offThreadReads?: boolean } = {},
): Promise<LibraryStore["Service"]> => {
  const module = await loadWorktreeModule<typeof import("../../src/library/LibraryStore.ts")>(
    root,
    "apps/mobile/src/library/LibraryStore.ts",
  );
  setDesktopDatabase(db, options);
  return Effect.runPromise(
    Effect.gen(function* () {
      return yield* module.LibraryStore;
    }).pipe(Effect.provide(module.layer)),
  );
};
