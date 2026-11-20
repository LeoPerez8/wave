import { Database } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import type { PlayedAlbum, PlayedArtist } from "@wave/client/db/playedEntities";
import {
  statsDatabaseReads,
  statsQueries,
  type Ranked,
  type StatsSong,
} from "@wave/client/db/statsQueries";
import {
  discoverTrackId,
  pickStreamedAlbum,
  STATS_SEE_ALL,
  STATS_TOP,
  STATS_PERIODS,
  statsSeeAll,
  type StatsPeriod,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { StatsOverview, StatsRow } from "../shared/stats.ts";
import { ytRow } from "../shared/yt.ts";
import { browseSongs } from "./library/browse.ts";
import { DesktopLibrary } from "./library/library.ts";
import { lookupsEnabled } from "./lookupSettings.ts";
import { Playback } from "./playback/playback.ts";
import { YtMusic } from "./yt/ytMusic.ts";
import { YtFeatures } from "./yt/ytServices.ts";

const queries = (db: LibraryDatabase) =>
  statsQueries(
    statsDatabaseReads(db),
    Effect.sync(() => lookupsEnabled(db)),
  );

function songRows(
  db: LibraryDatabase,
  ranking: readonly Ranked<StatsSong>[],
  library: DesktopLibrary["Service"],
  yt: YtMusic["Service"],
): StatsRow[] {
  const ytEnabled = yt.enabled();
  if (ytEnabled)
    yt.keep(ranking.flatMap(({ item }) => (item.source === "stream" ? [item.song] : [])));
  const files = new Map(
    browseSongs(
      db,
      ranking.flatMap(({ item }) => (item.source === "library" ? [item.track.id] : [])),
    ).map((row) => [row.id, row]),
  );
  return ranking.flatMap(({ item, countedPlays }) => {
    const key = discoverTrackId(item);
    if (item.source === "stream") {
      return [
        {
          ...ytRow(item.song),
          artworkUrl: ytEnabled ? item.song.artworkUrl : null,
          unavailable: !ytEnabled,
          key,
          countedPlays,
        },
      ];
    }
    const row = files.get(item.track.id);
    return row === undefined
      ? []
      : [
          {
            ...row,
            unavailable: row.path !== null && library.unavailable(row.path),
            key,
            countedPlays,
          },
        ];
  });
}

function entityRows(
  ranking: readonly Ranked<PlayedAlbum | PlayedArtist>[],
  ytEnabled: boolean,
): StatsRow[] {
  return ranking.map(({ item, countedPlays }) => ({
    id: typeof item.id === "number" ? item.id : 0,
    title: "title" in item ? item.title : item.name,
    artist: "albumArtist" in item ? item.albumArtist : "",
    album: "",
    artworkHash: null,
    artworkUrl: ytEnabled && "artworkUrl" in item ? item.artworkUrl : null,
    count: "trackCount" in item ? item.trackCount : 0,
    durationMs: "durationMs" in item ? item.durationMs : 0,
    year: "year" in item ? item.year : null,
    genre: null,
    trackNumber: null,
    favorite: false,
    path: null,
    unavailable: "online" in item && !ytEnabled,
    key: String(item.id),
    countedPlays,
  }));
}

const statsPeriod = (value: unknown): StatsPeriod | undefined =>
  STATS_PERIODS.find(({ id }) => id === value)?.id;

const entryKey = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= 4096;

const limitFor = (full: boolean) => (full ? STATS_SEE_ALL : STATS_TOP);
const page = (items: readonly StatsRow[]) => ({ items, offset: 0, total: items.length });

/** The window can name a period and ranked entry, while main resolves the song or online page. */
export const statsHandlers = {
  "stats.overview": ([periodValue]: readonly unknown[]) =>
    Effect.gen(function* () {
      const period = statsPeriod(periodValue);
      if (period === undefined)
        return yield* Effect.fail(new Error("Refused stats.overview: invalid period"));
      const db = yield* Database;
      const library = yield* DesktopLibrary;
      const yt = yield* YtMusic;
      const ranking = yield* queries(db).overview(period, STATS_TOP);
      const enabled = yt.enabled();
      return {
        ...ranking,
        songs: songRows(db, ranking.songs, library, yt),
        albums: entityRows(ranking.albums, enabled),
        artists: entityRows(ranking.artists, enabled),
      } satisfies StatsOverview;
    }),
  "stats.ranking": ([kind, periodValue]: readonly unknown[]) =>
    Effect.gen(function* () {
      const request = statsSeeAll(
        typeof kind === "string" ? kind : undefined,
        statsPeriod(periodValue),
      );
      if (request === undefined)
        return yield* Effect.fail(new Error("Refused stats.ranking: invalid ranking"));
      const { ranking, period } = request;
      const db = yield* Database;
      const yt = yield* YtMusic;
      const read = queries(db);
      const enabled = yt.enabled();
      switch (ranking) {
        case "songs":
          return page(
            songRows(db, yield* read.topSongs(period, STATS_SEE_ALL), yield* DesktopLibrary, yt),
          );
        case "albums":
          return page(entityRows(yield* read.topAlbums(period, STATS_SEE_ALL), enabled));
        case "artists":
          return page(entityRows(yield* read.topArtists(period, STATS_SEE_ALL), enabled));
      }
    }),
  "stats.play": ([periodValue, key, full]: readonly unknown[]) =>
    Effect.gen(function* () {
      const period = statsPeriod(periodValue);
      if (period === undefined || !entryKey(key) || typeof full !== "boolean")
        return yield* Effect.fail(new Error("Refused stats.play: invalid period or song"));
      const db = yield* Database;
      const yt = yield* YtMusic;
      const library = yield* DesktopLibrary;
      const playback = yield* Playback;
      const ranking = yield* queries(db).topSongs(period, limitFor(full));
      const enabled = yt.enabled();
      const queue = ranking.flatMap(({ item }) =>
        enabled || item.source === "library" ? [item] : [],
      );
      const ids = queue.map(discoverTrackId);
      const index = ids.indexOf(key);
      const chosen = queue[index];
      if (chosen === undefined)
        return yield* Effect.fail(new Error("Refused stats.play: song outside ranking"));
      if (
        chosen.source === "library" &&
        chosen.track.path !== null &&
        library.unavailable(chosen.track.path)
      )
        return yield* Effect.fail(new Error("[folder-unavailable] Drive is not connected"));
      const streams = queue.flatMap((item) => (item.source === "stream" ? [item.song] : []));
      const play = () => playback.activate(ids, index, { kind: "stats", id: `songs-${period}` });
      yield* Effect.tryPromise({
        try: () => (streams.length === 0 ? play() : yt.withSongs(streams, play)),
        catch: (error) => error,
      });
    }),
  "stats.open": ([kind, periodValue, key, full]: readonly unknown[]) =>
    Effect.gen(function* () {
      const period = statsPeriod(periodValue);
      if (
        (kind !== "albums" && kind !== "artists") ||
        period === undefined ||
        !entryKey(key) ||
        typeof full !== "boolean"
      )
        return yield* Effect.fail(new Error("Refused stats.open: invalid period or entry"));
      const yt = yield* YtMusic;
      if (!yt.enabled()) return null;
      const read = queries(yield* Database);
      const ranking =
        kind === "albums"
          ? yield* read.topAlbums(period, limitFor(full))
          : yield* read.topArtists(period, limitFor(full));
      const entry = ranking.find(({ item }) => item.id === key)?.item;
      if (entry === undefined || !("online" in entry))
        return yield* Effect.fail(new Error("Refused stats.open: entry outside ranking"));
      const { pages } = yield* YtFeatures;
      return yield* Effect.tryPromise({
        try: async () => {
          const id =
            "title" in entry
              ? (entry.albumId ??
                pickStreamedAlbum(
                  entry,
                  await pages.searchAlbums(`${entry.title} ${entry.artists[0] ?? ""}`),
                ))
              : (await pages.findArtist(entry.name)).browseId;
          return yt.enabled() ? id : null;
        },
        catch: (error) => error,
      });
    }),
};
