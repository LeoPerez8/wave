/**
 * The shelf the Library shows under its entry rows: one section of Home's
 * catalogue, picked from a long press on the Library's title, or none. It's
 * Home's section, drawn with Home's data, and like there it shows only when
 * it has something to show.
 */

import { homeSectionTitle, type HomeSectionId } from "./homeSections.ts";

/** A section of Home's catalogue drawn under the Library's rows, or nothing there. */
export type LibraryShelf = HomeSectionId | "none";

/**
 * The catalogue's sections that can sit under the Library, in catalogue
 * order: its shelves. Most played's song rows, the Stats entry and the
 * listening overview stay on Home.
 */
const SHELVES: readonly HomeSectionId[] = [
  "recently-added",
  "recently-played",
  "most-played-albums",
  "most-played-artists",
  "discover-mixes",
  "favorites",
];

/** The shelves in the order the card offers them, each under its title on Home, then None. */
export const LIBRARY_SHELF_CHOICES: readonly {
  readonly shelf: LibraryShelf;
  readonly label: string;
}[] = [
  ...SHELVES.map((shelf) => ({ shelf, label: homeSectionTitle(shelf) })),
  { shelf: "none", label: "None" },
];

/** The shelf of an install that never picked one. */
const DEFAULT_LIBRARY_SHELF: LibraryShelf = "recently-added";

/** The shelf a stored value names: nothing stored is Recently added. */
export const parseLibraryShelf = (stored: string | null): LibraryShelf =>
  LIBRARY_SHELF_CHOICES.find(({ shelf }) => shelf === stored)?.shelf ?? DEFAULT_LIBRARY_SHELF;

/** What to store for [shelf]: null (nothing) for the default, so None is stored as "none". */
export const storedLibraryShelf = (shelf: LibraryShelf): string | null =>
  shelf === DEFAULT_LIBRARY_SHELF ? null : shelf;
