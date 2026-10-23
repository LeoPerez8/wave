/** Complete genre context, built only on demand/after settlement, in bounded turns. */
import { indexLetter, songSpineField, spineFromIndex, type IndexEntry, type LibrarySongSort } from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore, LibraryStoreError, SongOrder } from "./LibraryStore.ts";
import type { GenreOpening, GenreOrderRow } from "./db/genrePages.ts";

/** The first-page order is usable immediately; it is never an action's complete context. */
export const genreFirstOrder = (opening: GenreOpening, sort: LibrarySongSort): SongOrder => {
  const ids: number[] = [], missing: number[] = [], entries: IndexEntry[] = [];
  append(opening.page.rows, ids, missing, entries, new Set(), songSpineField(sort) !== undefined);
  return { ids, missing, spine: [] };
};
const append = (rows: readonly GenreOrderRow[], ids: number[], missing: number[], entries: IndexEntry[], seen: Set<string>, hasSpine: boolean) => {
  for (const row of rows) {
    const index = ids.length;
    ids.push(row.id);
    if (!row.hasFile) missing.push(row.id);
    const letter = indexLetter(row.letter);
    if (hasSpine && !seen.has(letter)) { seen.add(letter); entries.push({ letter, index }); }
  }
};
/** Null means a write invalidated the generation. Never publish a mixed snapshot. */
export const readGenreOrder = (
  store: Pick<LibraryStore["Service"], "genreOrderPage">,
  opening: GenreOpening,
  sort: LibrarySongSort,
  turn: Effect.Effect<void>,
): Effect.Effect<SongOrder | null, LibraryStoreError> => Effect.gen(function* () {
  const ids: number[] = [], missing: number[] = [], entries: IndexEntry[] = [], seen = new Set<string>();
  const hasSpine = songSpineField(sort) !== undefined;
  append(opening.page.rows, ids, missing, entries, seen, hasSpine);
  let cursor = opening.page.next;
  while (cursor !== null) {
    yield* turn;
    const page = yield* store.genreOrderPage(opening.genre.id, sort, cursor);
    if (page.stale) return null;
    append(page.rows, ids, missing, entries, seen, hasSpine);
    cursor = page.next;
  }
  return { ids, missing, spine: spineFromIndex(entries, ids.length) };
});
