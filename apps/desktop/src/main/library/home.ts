/** Desktop presentation of the phone's Home queries. Rankings and arrangement stay shared. */
import type { LibraryDatabase } from "@wave/client/db/database";
import { libraryCounts } from "@wave/client/db/counts";
import { homeSections } from "@wave/client/db/playHistory";
import { playedEntityTotals } from "@wave/client/db/playedEntities";
import { listeningSums } from "@wave/client/db/playTotals";
import { parseHomeArrangement, STATS_TOP, statsWindow, summedListeningTotals } from "@wave/core";
import type { HomeRow, HomeSectionView, HomeView, LocalHomeSectionId } from "../../shared/home.ts";
import { browseRows, browseSongs } from "./browse.ts";

const page = <T>(items: readonly T[]) => ({ items, offset: 0, total: items.length });

/** A bounded Home read: the same 12-album shelves and 10-song previews as the phone. */
export const readHome = (db: LibraryDatabase, stored: string | null): Omit<HomeView, "recap"> => {
  const arrangement = parseHomeArrangement(stored);
  // The Library's shelves. Discover and the followed artists' sections fill their own places.
  const home = homeSections(db);
  const totals = playedEntityTotals(db, statsWindow("all", Date.now()));
  const ranked = (kind: "albums" | "artists", limit: number): HomeRow[] => {
    const top = totals[kind].filter((r) => typeof r.item.id === "number").slice(0, limit);
    const counts = new Map(top.map((r) => [r.item.id, r.countedPlays]));
    return browseRows(
      db,
      kind,
      top.map((r) => Number(r.item.id)),
    ).map((row) => ({ ...row, playCount: counts.get(row.id)! }));
  };
  const played = home.mostPlayed.filter((r) => r.source === "library");
  const counts = new Map(played.map((r) => [r.track.id, r.playCount]));
  const rows: Record<LocalHomeSectionId, readonly HomeRow[]> = {
    "recently-added": browseRows(
      db,
      "albums",
      home.recentlyAdded.map((r) => r.id),
    ),
    "recently-played": browseRows(
      db,
      "albums",
      home.recentlyPlayed.flatMap((r) => (typeof r.id === "number" ? [r.id] : [])),
    ),
    "most-played": browseSongs(
      db,
      played.map((r) => r.track.id),
    ).map((row) => ({ ...row, playCount: counts.get(row.id)! })),
    "most-played-albums": ranked("albums", STATS_TOP),
    "most-played-artists": ranked("artists", 5),
    favorites: browseSongs(
      db,
      home.favorites.map((r) => r.id),
    ),
  };
  const kinds = {
    "recently-added": "album",
    "recently-played": "album",
    "most-played": "song",
    "most-played-albums": "album",
    "most-played-artists": "artist",
    favorites: "song",
  } as const;
  const { songs, albums, artists } = libraryCounts(db);
  const empty = songs === 0;
  const showStats = !empty && arrangement.sections.includes("stats");
  const items = arrangement.sections.flatMap((id): HomeSectionView[] => {
    if (id === "discover") return [{ id, kind: "discover", rows: page([]) }];
    if (id === "new-releases" || id === "upcoming-shows")
      return [{ id, kind: "follow", rows: page([]) }];
    if (id === "stats" && showStats) return [{ id, kind: "stats", rows: page([]) }];
    if (!(id in rows)) return [];
    const local = id as LocalHomeSectionId;
    return rows[local].length === 0
      ? []
      : [{ id: local, kind: kinds[local], rows: page(rows[local]) }];
  });
  const nothingPlayed = home.recentlyPlayed.length === 0 && home.mostPlayed.length === 0;
  return {
    ...page(items),
    discoverRows: arrangement.discoverRows,
    ...(showStats && {
      stats: {
        library: { songs, albums, artists },
        listening: summedListeningTotals(listeningSums(db)),
      },
    }),
    hint: empty
      ? "empty"
      : arrangement.sections.length === 0
        ? "none"
        : nothingPlayed &&
            arrangement.sections.some((id) =>
              [
                "recently-played",
                "most-played",
                "most-played-albums",
                "most-played-artists",
              ].includes(id),
            )
          ? "play"
          : null,
  };
};
