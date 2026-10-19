/**
 * The artist page's YT Music section, saved (docs/spec.md, "YT Music"): the
 * last answer YouTube Music gave for each artist, by artist key, so the page
 * shows it without asking again (Core's `ytArtistSectionView`) and a later
 * load reuses the match (Core's `ytArtistLookup`). The whole page is kept
 * (top songs, every song of the artist, albums, singles), whatever the section shows of it. Kept free
 * of Expo so the store tests run it against a real SQLite.
 */
import type { YtArtistPage, YtArtistSaved, YtSong } from "@wave/core";
import { eq, sql } from "drizzle-orm";

import type { LibraryDatabase } from "./database.ts";
import * as schema from "./schema.ts";

/**
 * The page saved as JSON, or null when it can't be read back (nothing is
 * shown then). A page saved before every song of the artist was read has no
 * `allSongs` and still reads; one whose `allSongs` isn't a list doesn't.
 */
const readPage = <S extends YtSong>(json: string): YtArtistPage<S> | null => {
  try {
    const page = JSON.parse(json) as YtArtistPage<S> | null;
    if (typeof page !== "object" || page === null || !Array.isArray(page.songs)) return null;
    return page.allSongs === undefined || Array.isArray(page.allSongs) ? page : null;
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

/** A saved page's artist and who "Fans might also like", as the artist graph reads them. */
export type YtArtistSimilar = Required<Pick<YtArtistPage, "name" | "similar">>;

type SimilarArtist = YtArtistSimilar["similar"][number];

/** [value] read field by field as a similar artist; null without a name and a page id. */
const readSimilarArtist = (value: unknown): SimilarArtist | null => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { name, browseId, audience, artworkUrl } = value as Readonly<Record<string, unknown>>;
  if (typeof name !== "string" || typeof browseId !== "string") return null;
  return {
    name,
    browseId,
    audience: typeof audience === "number" && Number.isFinite(audience) ? audience : null,
    ...(typeof artworkUrl === "string" || artworkUrl === null ? { artworkUrl } : {}),
  };
};

/** [json] read as a list of similar artists: none when it isn't a list, an entry that isn't one left out. */
const readSimilar = (json: string | null): SimilarArtist[] => {
  let similar: unknown;
  try {
    similar = json === null ? null : JSON.parse(json);
  } catch {
    return [];
  }
  return Array.isArray(similar)
    ? similar.flatMap((entry: unknown) => readSimilarArtist(entry) ?? [])
    : [];
};

/**
 * Every found page's artist with the artists it lists as similar, in its
 * order (none for a page saved before they were read), by artist key. Only
 * those two are read out of each page, not its songs; a page that can't be
 * read is left out.
 */
export const selectYtArtistSimilar = (db: LibraryDatabase): YtArtistSimilar[] => {
  const { ytArtists } = schema;
  const valid = sql`json_valid(${ytArtists.page})`;
  return db
    .select({
      name: sql<
        string | null
      >`CASE WHEN ${valid} THEN json_extract(${ytArtists.page}, '$.name') END`,
      similar: sql<
        string | null
      >`CASE WHEN ${valid} THEN json_extract(${ytArtists.page}, '$.similar') END`,
    })
    .from(ytArtists)
    .where(eq(ytArtists.outcome, "found"))
    .orderBy(ytArtists.artistKey)
    .all()
    .flatMap(({ name, similar }) =>
      typeof name === "string" ? [{ name, similar: readSimilar(similar) }] : [],
    );
};
