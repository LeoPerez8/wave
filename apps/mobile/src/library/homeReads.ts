import type { LibraryReads } from "@wave/core";
import type * as Effect from "effect/Effect";

import type { HomeContent } from "../home/homeOpening.ts";
import type { LibraryStore, LibraryStoreError } from "./LibraryStore.ts";

interface HomeRead {
  readonly key: string;
  readonly reads: LibraryReads;
  readonly read: (store: LibraryStore["Service"]) => Effect.Effect<HomeContent, LibraryStoreError>;
}

/** The independent reads Home and the Library shelf share, including their invalidation inputs. */
export const homeReads = {
  added: {
    key: "home:added",
    reads: { tracks: true },
    read: (store) => store.homeAdded,
  },
  plays: {
    key: "home:plays",
    reads: { tracks: true, plays: true },
    read: (store) => store.homePlays,
  },
  favorites: {
    key: "home:favorites",
    reads: { tracks: true, favorites: true },
    read: (store) => store.homeFavorites,
  },
} satisfies Record<string, HomeRead>;
