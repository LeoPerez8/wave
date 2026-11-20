import {
  countedGenreSongIds,
  genrePlayShares,
  rankSongPlays,
  statsWindow,
  type MixedSong,
  type RecapSongGenre,
  type SongPlayTotals,
  type StatsPeriod,
  type StatsWindow,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { songHasFile, type SongRow } from "../types.ts";
import type { LibraryDatabase } from "./database.ts";
import {
  playedEntityTotals,
  type PlayedAlbum,
  type PlayedArtist,
  type PlayedEntityTotals,
} from "./playedEntities.ts";
import { songGenres, songPlayTotals } from "./stats.ts";
import { streamedSongsOf } from "./streamedSongs.ts";
import { selectPlayableSongs } from "./tracks.ts";

export interface Ranked<A> {
  readonly item: A;
  readonly countedPlays: number;
}

export type StatsSong = MixedSong<YtAlbumSong, SongRow>;

export interface TopAlbumsAndArtists {
  readonly albums: readonly Ranked<PlayedAlbum>[];
  readonly artists: readonly Ranked<PlayedArtist>[];
}

/** The phone supplies its scheduled reads. Desktop reads the same queries in main. */
interface StatsReads<E> {
  readonly songPlayTotals: (window: StatsWindow) => Effect.Effect<readonly SongPlayTotals[], E>;
  readonly songsByIds: (ids: readonly number[]) => Effect.Effect<readonly SongRow[], E>;
  readonly streamedSongsByIds: (
    ids: readonly string[],
  ) => Effect.Effect<ReadonlyMap<string, YtAlbumSong>, E>;
  readonly playedEntityTotals: (window: StatsWindow) => Effect.Effect<PlayedEntityTotals, E>;
  readonly songGenres: (
    ids: readonly (number | string)[],
    includeStreamed: boolean,
  ) => Effect.Effect<readonly RecapSongGenre[], E>;
}

export const statsDatabaseReads = (db: LibraryDatabase): StatsReads<never> => ({
  songPlayTotals: (window) => Effect.sync(() => songPlayTotals(db, window)),
  songsByIds: (ids) => Effect.sync(() => selectPlayableSongs(db, ids).filter(songHasFile)),
  streamedSongsByIds: (ids) => Effect.sync(() => streamedSongsOf(db, ids)),
  playedEntityTotals: (window) => Effect.sync(() => playedEntityTotals(db, window)),
  songGenres: (ids, includeStreamed) => Effect.sync(() => songGenres(db, ids, includeStreamed)),
});

/** Loads the rows of a song ranking, in order, skipping songs that have left the Library. */
export const rankSongs = <E>(
  store: Pick<StatsReads<E>, "songsByIds" | "streamedSongsByIds">,
  ranking: readonly SongPlayTotals[],
): Effect.Effect<readonly Ranked<StatsSong>[], E> => {
  const ids = ranking.flatMap(({ song }) => (song.kind === "library" ? [song.id] : []));
  const videoIds = ranking.flatMap(({ song }) => (song.kind === "yt" ? [song.videoId] : []));
  return Effect.map(
    Effect.all([
      ids.length === 0 ? Effect.succeed([]) : store.songsByIds(ids),
      videoIds.length === 0
        ? Effect.succeed(new Map<string, YtAlbumSong>())
        : store.streamedSongsByIds(videoIds),
    ]),
    ([rows, streamed]) => {
      const byId = new Map(rows.map((row) => [row.id, row]));
      return ranking.flatMap(({ song, countedPlays }): Ranked<StatsSong>[] => {
        if (song.kind === "library") {
          const track = byId.get(song.id);
          return track === undefined ? [] : [{ item: { source: "library", track }, countedPlays }];
        }
        const streamedSong = streamed.get(song.videoId);
        return streamedSong === undefined
          ? []
          : [{ item: { source: "stream", song: streamedSong }, countedPlays }];
      });
    },
  );
};

/** The two Home rankings share the same entity read as Stats. */
export const topAlbumsAndArtists = <E>(
  store: Pick<StatsReads<E>, "playedEntityTotals">,
  period: StatsPeriod,
  albumLimit: number,
  artistLimit: number,
  now = Date.now,
): Effect.Effect<TopAlbumsAndArtists, E> =>
  Effect.map(
    Effect.suspend(() => store.playedEntityTotals(statsWindow(period, now()))),
    (totals) => ({
      albums: totals.albums.slice(0, albumLimit),
      artists: totals.artists.slice(0, artistLimit),
    }),
  );

/** Ranked songs, albums, artists and genre families, for either app's reading schedule. */
export const statsQueries = <E>(
  store: StatsReads<E>,
  includeStreamedGenres: Effect.Effect<boolean>,
  now = Date.now,
) => {
  const songsIn = (period: StatsPeriod) =>
    Effect.suspend(() => store.songPlayTotals(statsWindow(period, now())));
  const genresFor = (totals: readonly SongPlayTotals[]) =>
    Effect.gen(function* () {
      const songs = totals.map(({ song, ...plays }) => ({
        ...plays,
        id: song.kind === "library" ? song.id : song.videoId,
      }));
      const includeStreamed = yield* includeStreamedGenres;
      const genres = yield* store.songGenres(countedGenreSongIds(songs), includeStreamed);
      return genrePlayShares(songs, genres);
    });
  return {
    topSongs: (period: StatsPeriod, limit: number) =>
      Effect.flatMap(songsIn(period), (totals) => rankSongs(store, rankSongPlays(totals, limit))),
    topAlbums: (period: StatsPeriod, limit: number) =>
      Effect.map(topAlbumsAndArtists(store, period, limit, 0, now), (totals) => totals.albums),
    topArtists: (period: StatsPeriod, limit: number) =>
      Effect.map(topAlbumsAndArtists(store, period, 0, limit, now), (totals) => totals.artists),
    topGenres: (period: StatsPeriod) => Effect.flatMap(songsIn(period), genresFor),
    overview: (period: StatsPeriod, limit: number) =>
      Effect.gen(function* () {
        const at = now();
        const totals = yield* store.songPlayTotals(statsWindow(period, at));
        const songs = yield* rankSongs(store, rankSongPlays(totals, limit));
        const entities = yield* topAlbumsAndArtists(store, period, limit, limit, () => at);
        const genres = yield* genresFor(totals);
        return {
          ...entities,
          songs,
          genres,
          hasPlays: totals.length > 0 || entities.albums.length > 0 || entities.artists.length > 0,
        };
      }),
  };
};
