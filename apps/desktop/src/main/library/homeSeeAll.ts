/** The full lists behind Home's Recently Added and Recently Played shelves (their See all). */
import type { LibraryDatabase } from "@wave/client/db/database";
import { recentlyAddedList, recentlyPlayedList } from "@wave/client/db/playHistory";
import type { HomeRow, HomeSeeAllSection } from "../../shared/home.ts";
import { browseRows } from "./browse.ts";

/** The section's albums in the shelf's order: the Library's, as the shelf shows them. */
export const readHomeSeeAll = (db: LibraryDatabase, section: HomeSeeAllSection): HomeRow[] =>
  browseRows(
    db,
    "albums",
    section === "recently-added"
      ? recentlyAddedList(db).map((album) => album.id)
      : recentlyPlayedList(db).flatMap((album) => (typeof album.id === "number" ? [album.id] : [])),
  );
