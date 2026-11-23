/** Desktop presentation of the phone's Home queries. Rankings and arrangement stay shared. */
import type { LibraryDatabase } from "@wave/client/db/database";
import { libraryCounts } from "@wave/client/db/counts";
import { homeSections, recentlyPlayedAlbumShelf } from "@wave/client/db/playHistory";
import { playedArtistTotals, playedEntityTotals } from "@wave/client/db/playedEntities";
import { listeningSums } from "@wave/client/db/playTotals";
import {
  inYourOrbit,
  inYourOrbitWindow,
  parseHomeArrangement,
  STATS_TOP,
  statsWindow,
  summedListeningTotals,
} from "@wave/core";
import {
  DESKTOP_SKIPPED_SECTIONS,
  type HomeRow,
  type HomeSectionView,
  type HomeView,
  type LocalHomeSectionId,
} from "../../shared/home.ts";
import { ytRow } from "../../shared/yt.ts";
import { browseRows, browseSongs } from "./browse.ts";

const page = <T>(items: readonly T[]) => ({ items, offset: 0, total: items.length });

/** A bounded Home read: the same 12-album shelves and 10-song previews as the phone. */
export const readHome = (db: LibraryDatabase, stored: string | null): Omit<HomeView, "recap"> => {
  const arrangement = parseHomeArrangement(stored, DESKTOP_SKIPPED_SECTIONS);
  // The Library's shelves. Discover and the followed artists' sections fill their own places.
  const home = homeSections(db);
  // The desktop keeps Recently played's album shelf; the phone's shows where each play came from.
  const recentlyPlayed = recentlyPlayedAlbumShelf(db);
  const now = Date.now();
  const totals = playedEntityTotals(db, statsWindow("all", now));
  const ranked = (kind: "albums" | "artists", limit: number): HomeRow[] => {
    const top = totals[kind].filter((r) => typeof r.item.id === "number").slice(0, limit);
    const counts = new Map(top.map((r) => [r.item.id, r.countedPlays]));
    return browseRows(
      db,
      kind,
      top.map((r) => Number(r.item.id)),
    ).map((row) => ({ ...row, playCount: counts.get(row.id)! }));
  };
  const files = new Map(
    browseSongs(
      db,
      home.mostPlayed.flatMap((r) => (r.source === "library" ? [r.track.id] : [])),
    ).map((row) => [row.id, row]),
  );
  // Streamed songs too, each with its counted plays, as the phone lists them.
  const mostPlayed = home.mostPlayed.flatMap((r): HomeRow[] => {
    if (r.source === "stream") return [{ ...ytRow(r.song), playCount: r.playCount }];
    const row = files.get(r.track.id);
    return row === undefined ? [] : [{ ...row, playCount: r.playCount }];
  });
  // In your orbit, the Library's artists of it: the desktop has no online artist page to open.
  const orbit = inYourOrbit(
    playedArtistTotals(db, inYourOrbitWindow(now)).filter((row) => typeof row.item.id === "number"),
  );
  const rows: Record<LocalHomeSectionId, readonly HomeRow[]> = {
    "in-your-orbit": browseRows(
      db,
      "artists",
      orbit.flatMap((r) => (typeof r.item.id === "number" ? [r.item.id] : [])),
    ),
    "recently-added": browseRows(
      db,
      "albums",
      home.recentlyAdded.map((r) => r.id),
    ),
    "recently-played": browseRows(
      db,
      "albums",
      recentlyPlayed.flatMap((r) => (typeof r.id === "number" ? [r.id] : [])),
    ),
    "most-played": mostPlayed,
    "most-played-albums": ranked("albums", STATS_TOP),
    "most-played-artists": ranked("artists", 5),
    favorites: browseSongs(
      db,
      home.favorites.map((r) => r.id),
    ),
  };
  const kinds = {
    "in-your-orbit": "artist",
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
  const nothingPlayed = recentlyPlayed.length === 0 && home.mostPlayed.length === 0;
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
                "in-your-orbit",
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
