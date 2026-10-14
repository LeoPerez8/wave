/**
 * The artist page's YT Music section, saved (docs/spec.md, "YT Music"): the
 * last answer YouTube Music gave for each artist, by artist key, so the page
 * shows it without asking again (Core's `ytArtistSectionView`) and a later
 * load reuses the match (Core's `ytArtistLookup`). The whole page is kept
 * (top songs, albums, singles), whatever the section shows of it. Kept free
 * of Expo so the store tests run it against a real SQLite.
 */
import type { YtArtistPage, YtArtistSaved, YtSong } from "@wave/core";
import { eq } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/** The page saved as JSON, or null when it can't be read back (nothing is shown then). */
const readPage = <S extends YtSong>(json: string): YtArtistPage<S> | null => {
  try {
    const page = JSON.parse(json) as YtArtistPage<S> | null;
    return typeof page === "object" && page !== null && Array.isArray(page.songs) ? page : null;
  } catch {
    return null;
  }
};

/** What was saved for [artistKey], or null for nothing (or nothing readable). */
export const selectYtArtist = <S extends YtSong = YtSong>(
  db: LibraryDatabase,
  artistKey: string,
): YtArtistSaved<S> | null => {
  const { ytArtists } = schema;
  const row = db.select().from(ytArtists).where(eq(ytArtists.artistKey, artistKey)).get();
  if (row === undefined) return null;
  if (row.outcome === "unmatched") return { outcome: "unmatched", checkedAt: row.checkedAt };
  const page = row.page === null ? null : readPage<S>(row.page);
  if (row.browseId === null || page === null) return null;
  return { outcome: "found", checkedAt: row.checkedAt, browseId: row.browseId, page };
};

/** Saves YouTube Music's answer for [artistKey], replacing any earlier one. */
export const saveYtArtist = (
  db: LibraryDatabase,
  artistKey: string,
  saved: YtArtistSaved,
): void => {
  const row = {
    outcome: saved.outcome,
    checkedAt: saved.checkedAt,
    browseId: saved.outcome === "found" ? saved.browseId : null,
    page: saved.outcome === "found" ? JSON.stringify(saved.page) : null,
  };
  db.insert(schema.ytArtists)
    .values({ artistKey, ...row })
    .onConflictDoUpdate({ target: schema.ytArtists.artistKey, set: row })
    .run();
};
