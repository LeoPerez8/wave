import * as Effect from "effect/Effect";
import { mapSteps } from "@wave/core";
import { runSteps, type Turn } from "../lib/stepped.ts";
import type { LibraryStore } from "../library/LibraryStore.ts";

import { readCatalogInputs } from "./catalogInputs.ts";
export const readMixCatalog = (
  store: Pick<LibraryStore["Service"], "mixCatalog" | "graphRadios">,
  between: Turn,
) =>
  Effect.gen(function* () {
    // The catalog and its radios, each as one page: two reads, whatever their size (#1351).
    const catalog = yield* readCatalogInputs(
      () => store.mixCatalog,
      () => store.graphRadios,
      between,
      (entry) => entry.videoId,
    );
    return yield* runSteps(
      mapSteps(catalog, ({ videoId: _lookupId, ...entry }) => entry),
      between,
    );
  });
