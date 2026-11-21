import { Database } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import type { PlayedAlbum, PlayedArtist } from "@wave/client/db/playedEntities";
import { recapPlays } from "@wave/client/db/playedEntities";
import { loadRecapStories, type LoadedRecapSlide } from "@wave/client/db/recapStories";
import { countedListening } from "@wave/client/db/stats";
import {
  artistListeningStats,
  statsDatabaseReads,
  statsQueries,
  type Ranked,
  type StatsSong,
} from "@wave/client/db/statsQueries";
import {
  discoverTrackId,
  parseRecapId,
  catalogueOf,
  pickStreamedAlbum,
  recapId,
  recapSong,
  recapWindow,
  STATS_SEE_ALL,
  STATS_TOP,
  STATS_PERIODS,
  statsSeeAll,
  type StatsPeriod,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type {
  ArtistStatsPage,
  DesktopRecap,
  RecapStory,
  StatsOverview,
  StatsRow,
} from "../shared/stats.ts";
import { ytRow } from "../shared/yt.ts";
import { browseSongs } from "./library/browse.ts";
import { DesktopLibrary } from "./library/library.ts";
import { recapOpened, recapsNow } from "./library/recaps.ts";
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

/** A Recap's story with the rows the window shows, as Stats shows a ranking's. */
const recapStory = (
  slide: LoadedRecapSlide,
  songs: (ranking: readonly Ranked<StatsSong>[]) => StatsRow[],
  ytEnabled: boolean,
): RecapStory[] => {
  switch (slide.kind) {
    case "topSongs": {
      const rows = songs(slide.songs);
      return rows.length === 0 ? [] : [{ kind: "topSongs", songs: rows }];
    }
    case "topArtists":
      return [{ kind: "topArtists", artists: entityRows(slide.artists, ytEnabled) }];
    case "topAlbum":
      return [{ kind: "topAlbum", album: entityRows([slide.album], ytEnabled)[0]! }];
    case "discovered":
      return [
        {
          kind: "discovered",
          count: slide.count,
          artists: entityRows(slide.artists, ytEnabled),
        },
      ];
    case "summary":
      return [
        {
          kind: "summary",
          minutes: slide.minutes,
          songs: songs(slide.songs),
          artists: entityRows(slide.artists, ytEnabled),
          genre: slide.genre?.name ?? null,
        },
      ];
    case "minutes":
    case "topGenres":
    case "habits":
      return [slide];
  }
};

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
  "stats.artist": ([artistIdValue, languageValue]: readonly unknown[]) =>
    Effect.gen(function* () {
      if (
        typeof artistIdValue !== "number" ||
        !Number.isSafeInteger(artistIdValue) ||
        artistIdValue < 1 ||
        (languageValue !== "en" && languageValue !== "pt-BR")
      )
        return yield* Effect.fail(new Error("Refused stats.artist: invalid artist or language"));
      const db = yield* Database;
      const library = yield* DesktopLibrary;
      const yt = yield* YtMusic;
      const stats = yield* artistListeningStats(
        statsDatabaseReads(db),
        artistIdValue,
        catalogueOf(languageValue, "desktop"),
      );
      if (!stats.played) return stats satisfies ArtistStatsPage;
      return {
        ...stats,
        mostPlayed: songRows(db, stats.mostPlayed, library, yt),
      } satisfies ArtistStatsPage;
    }),
  "stats.artistPlay": ([artistIdValue, key]: readonly unknown[]) =>
    Effect.gen(function* () {
      if (
        typeof artistIdValue !== "number" ||
        !Number.isSafeInteger(artistIdValue) ||
        artistIdValue < 1 ||
        !entryKey(key)
      )
        return yield* Effect.fail(new Error("Refused stats.artistPlay: invalid artist or song"));
      const db = yield* Database;
      const yt = yield* YtMusic;
      const library = yield* DesktopLibrary;
      const playback = yield* Playback;
      const stats = yield* artistListeningStats(
        statsDatabaseReads(db),
        artistIdValue,
        catalogueOf("en", "desktop"),
      );
      if (!stats.played)
        return yield* Effect.fail(new Error("Refused stats.artistPlay: artist has no plays"));
      const ranking = stats.mostPlayed.filter(
        ({ item }) => yt.enabled() || item.source === "library",
      );
      const ids = ranking.map(({ item }) => discoverTrackId(item));
      const index = ids.indexOf(key);
      const chosen = ranking[index]?.item;
      if (chosen === undefined)
        return yield* Effect.fail(new Error("Refused stats.artistPlay: song outside ranking"));
      if (
        chosen.source === "library" &&
        chosen.track.path !== null &&
        library.unavailable(chosen.track.path)
      )
        return yield* Effect.fail(new Error("[folder-unavailable] Drive is not connected"));
      const streams = ranking.flatMap(({ item }) => (item.source === "stream" ? [item.song] : []));
      const play = () =>
        playback.activate(ids, index, { kind: "artist-stats", id: String(artistIdValue) });
      yield* Effect.tryPromise({
        try: () => (streams.length === 0 ? play() : yt.withSongs(streams, play)),
        catch: (error) => error,
      });
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
  "stats.recaps": () =>
    Effect.gen(function* () {
      const items = recapsNow(yield* Database);
      return { items, offset: 0, total: items.length };
    }),
  "stats.recap": ([id]: readonly unknown[]) =>
    Effect.gen(function* () {
      const asked = typeof id === "string" && id.length <= 7 ? parseRecapId(id) : null;
      if (asked === null) return yield* Effect.fail(new Error("Refused stats.recap: invalid id"));
      const db = yield* Database;
      const listening = countedListening(db);
      const period = recapsNow(db, listening).find(
        (available) => recapId(available) === recapId(asked),
      );
      if (period === undefined) return null;
      const library = yield* DesktopLibrary;
      const yt = yield* YtMusic;
      const playback = yield* Playback;
      const loaded = yield* loadRecapStories(statsDatabaseReads(db), {
        period,
        listening,
        plays: recapPlays(db, recapWindow(period), lookupsEnabled(db)),
      });
      const stories = loaded.slides.flatMap((slide, at) =>
        recapStory(slide, (ranking) => songRows(db, ranking, library, yt), yt.enabled()).map(
          (story) => ({ story, at }),
        ),
      );
      // Each story's music is Core's choice; only a Library song with a file plays.
      const music = stories.map(({ at }) => {
        const song = recapSong(loaded.slides, at, { playingBefore: false });
        return song?.item.source === "library" ? song.item.track.id : null;
      });
      yield* Effect.tryPromise({
        try: () => playback.recap.opened(music),
        catch: (error) => error,
      });
      recapOpened(db, period);
      return { period, slides: stories.map(({ story }) => story) } satisfies DesktopRecap;
    }),
  "stats.recapStory": ([index]: readonly unknown[]) =>
    Effect.gen(function* () {
      const refused = new Error("Refused stats.recapStory: invalid story");
      if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0)
        return yield* Effect.fail(refused);
      const playback = yield* Playback;
      const known = yield* Effect.tryPromise({
        try: () => playback.recap.story(index),
        catch: (error) => error,
      });
      if (!known) return yield* Effect.fail(refused);
    }),
  "stats.recapClosed": () =>
    Effect.gen(function* () {
      const playback = yield* Playback;
      yield* Effect.tryPromise({ try: () => playback.recap.closed(), catch: (error) => error });
    }),
};
