import { Database } from "@wave/client";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { Kotlin } from "../kotlin/kotlin.ts";
import { createScanner } from "./scanner.ts";

export interface DesktopLibraryShape extends ReturnType<typeof createScanner> {
  readonly pickRoot: () => Promise<void>;
  readonly pickExclusion: () => Promise<void>;
}

export class DesktopLibrary extends Context.Service<DesktopLibrary, DesktopLibraryShape>()(
  "@wave/desktop/DesktopLibrary",
) {}

export const desktopLibraryLayer = (options: {
  readonly musicFolder: string;
  readonly platform: string;
  readonly pickFolder: () => Promise<string | undefined>;
}) =>
  Layer.effect(
    DesktopLibrary,
    Effect.gen(function* () {
      const db = yield* Database;
      const kotlin = yield* Kotlin;
      return yield* Effect.acquireRelease(
        Effect.sync(() => {
          const scanner = createScanner({
            ...options,
            db,
            readTags: (path) => Effect.runPromise(kotlin.readTags(path)),
          });
          void scanner.refresh();
          return {
            ...scanner,
            pickRoot: async () => {
              const path = await options.pickFolder();
              if (path !== undefined) await scanner.addRoot(path);
            },
            pickExclusion: async () => {
              const path = await options.pickFolder();
              if (path !== undefined) await scanner.exclude(path);
            },
          };
        }),
        (library) => Effect.promise(() => library.dispose()),
      );
    }),
  );
