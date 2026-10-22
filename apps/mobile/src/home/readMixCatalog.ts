import * as Effect from "effect/Effect";
import type { LibraryStore } from "../library/LibraryStore.ts";
import { readCatalogInputs } from "./catalogInputs.ts";
export const readMixCatalog = (
  store: Pick<LibraryStore["Service"], "mixCatalogPage" | "graphRadioPage">,
  between: Effect.Effect<void>,
) =>
  readCatalogInputs(
    store.mixCatalogPage,
    store.graphRadioPage,
    between,
    (entry) => entry.song.videoId,
  );
