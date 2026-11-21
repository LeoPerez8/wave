import type { LibrarySongSort } from "@wave/core";

import type { GenreOpening } from "@wave/client";
import { LibraryStore } from "./LibraryStore";
import { libraryQuery, type LibraryQuery } from "./sharedQueries";

/** The key of genre [id]'s opening in [sort]: one shared query per genre and sort. */
const genreOpeningKey = (id: number, sort: LibrarySongSort): string =>
  `genreOpening:${id}:${sort.key}:${sort.descending ? "desc" : "asc"}`;

/**
 * What genre [id]'s screen opens on in [sort] (#601): its header and first
 * page, read again as the tracks change (`useGenreOpening`); `readyScreens.ts`
 * keeps it ahead for the first genres.
 */
export const genreOpeningQuery = (
  id: number,
  sort: LibrarySongSort,
): LibraryQuery<GenreOpening | null> => {
  const key = genreOpeningKey(id, sort);
  let query = made.get(key);
  if (query === undefined) {
    query = libraryQuery(
      key,
      { tracks: true },
      // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
      LibraryStore.use((store) => store.openGenre(id, sort)),
    );
    made.set(key, query);
    // Only the declarations: a few dozen at most, the oldest let go first.
    if (made.size > MADE_KEPT) made.delete(made.keys().next().value as string);
  }
  return query;
};

/** How many genre openings' declarations are kept, so a screen gets the same one each render. */
const MADE_KEPT = 64;
const made = new Map<string, LibraryQuery<GenreOpening | null>>();
