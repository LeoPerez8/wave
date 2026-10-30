/**
 * A long read of the Library, kept until a source it reads changes: Home's
 * returns share the answer and read no rows. An edit restarts a read under
 * way. A burst (scan batches, an import: Core's `LibraryChange`) only adds to
 * what's read, and restarting on each would keep a read in pages from ever
 * finishing, so the read finishes and the next ask after it reads again.
 */
import type { LibraryChange, LibraryDataKind } from "@wave/core";
import * as Effect from "effect/Effect";

import { sharedRead } from "./sharedRead.ts";

export const createSourceRead = <A, E, R>(
  read: Effect.Effect<A, E, R>,
  sources: readonly LibraryDataKind[],
) => {
  let reading = 0;
  let stale = false;
  const shared = sharedRead(
    Effect.suspend(() => {
      reading++;
      stale = false;
      return read;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          reading--;
        }),
      ),
    ),
  );
  return {
    get: Effect.suspend(() => {
      if (stale && reading === 0) {
        stale = false;
        shared.forget();
      }
      return shared.get;
    }),
    change: (change: LibraryChange) => {
      if (!sources.includes(change.kind)) return;
      if (change.burst === true) {
        stale = true;
        return;
      }
      stale = false;
      shared.forget();
    },
    dispose: shared.dispose,
  };
};
