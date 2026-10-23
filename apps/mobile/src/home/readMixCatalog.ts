import * as Effect from "effect/Effect";
import { mapSteps } from "@wave/core";
import { runSteps } from "../lib/stepped.ts";
import type { LibraryStore } from "../library/LibraryStore.ts";
import { readCatalogInputs } from "./catalogInputs.ts";
export const readMixCatalog = (
  store: Pick<LibraryStore["Service"], "mixCatalogPage" | "graphRadioPage">,
  between: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const catalog = yield* readCatalogInputs(
      store.mixCatalogPage,
      store.graphRadioPage,
      between,
      (entry) => entry.videoId,
    );
    return yield* runSteps(
      mapSteps(catalog, ({ videoId: _lookupId, ...entry }) => entry),
      between,
    );
  });
