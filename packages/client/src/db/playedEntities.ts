import { countedGenreSongIds, readPlaylistYtSong } from "@wave/core";
import {
  albumPlayTotalsSteps,
  artistPlayTotalsSteps,
  finishSteps,
  mergeCountedPlays,
  mergeCountedPlaysSteps,
  rankEntityPlaysSteps,
  recentlyPlayedAlbums,
  streamedCreditResolverSteps,
  sortKey,
  type ArtistFirstPlay,
  type ArtistStatsInput,
  type CreditedPlayTotals,
  type EntityPlayTotals,
  type KeptSong,
  type KeptSongs,
  type PlayedAlbumKey,
  type PlayedArtistKey,
  type PlaySums,
  type RecapSongGenre,
  type SongListening,
  type SongPlayTotals,
  type StatsWindow,
} from "@wave/core";
import { sql } from "drizzle-orm";

import type { AlbumRow, ArtistRow } from "../types.ts";
import { selectAlbums } from "./albums.ts";
import { selectArtists } from "./artists.ts";
import { keptPlayedTotals, keptTotalsSettled } from "./keptPlayTotals.ts";
import { readCredits } from "./credits.ts";
import { libraryCreditRows, playedLibrary } from "./playedLibrary.ts";
import * as schema from "./schema.ts";
import type { LibraryDatabase } from "./database.ts";
import {
  artistFirstPlays,
  artistPlays,
  songGenres,
  songPlayTotals,
  streamedTrack,
  summedCreditedPlayTotals,
  type ArtistPlays,
} from "./stats.ts";
import {
  streamedSongRows,
  streamedSongsOf,
  streamedSongsSteps,
  type StreamedSongRows,
} from "./streamedSongs.ts";

export type OnlineAlbum = PlayedAlbumKey & {
  readonly id: string;
  readonly online: true;
  readonly albumArtist: string;
};
export type OnlineArtist = PlayedArtistKey & {
  readonly id: string;
  readonly online: true;
  readonly thumbPath: null;
  readonly artworkPath: null;
};
export type PlayedAlbum = AlbumRow | OnlineAlbum;
export type PlayedArtist = ArtistRow | OnlineArtist;
export type PlayedEntityTotal<A> = EntityPlayTotals & { readonly item: A };
export interface PlayedEntityTotals {
  readonly albums: readonly PlayedEntityTotal<PlayedAlbum>[];
  readonly artists: readonly PlayedEntityTotal<PlayedArtist>[];
}

export interface StreamedListeningTotal {
  readonly videoId: string;
  readonly trackId: number | null;
  readonly countedPlays: number;
  readonly listenedMs: number;
  readonly countedListenedMs: number;
  readonly latestPlayAt: number;
  readonly lastPlayedAt: number;
}

/** All-time reads kept per-video totals; period reads aggregate only streamed events in that window. */
export const streamedListeningTotals = (
  db: LibraryDatabase,
  window?: StatsWindow,
): StreamedListeningTotal[] => db.all<StreamedListeningTotal>(streamedTotalsQuery(db, window));

/** The statement `streamedListeningTotals` reads. */
const streamedTotalsQuery = (db: LibraryDatabase, window?: StatsWindow) => {
  const from =
    window?.from === null
      ? sql`streamed_totals AS kept CROSS JOIN play_events
        ON play_events.video_id = kept.video_id
          AND coalesce(play_events.recording_key, '') = kept.recording_key
        WHERE kept.last_played_at > ${window.to}`
      : sql`play_events WHERE play_events.video_id IS NOT NULL`;
  const aggregate = sql`SELECT play_events.video_id, play_events.recording_key,
    sum(play_events.counted) AS counted_plays, sum(play_events.listened_ms) AS listened_ms,
    sum(CASE WHEN play_events.counted THEN play_events.listened_ms ELSE 0 END) AS counted_listened_ms,
    max(play_events.started_at) AS last_played_at,
    max(CASE WHEN play_events.counted THEN play_events.started_at END) AS last_counted_at
    FROM ${from}
      ${window?.from == null ? sql`` : sql`AND play_events.started_at >= ${window.from}`}
      ${window === undefined ? sql`` : sql`AND play_events.started_at <= ${window.to}`}
    GROUP BY play_events.video_id, play_events.recording_key`;
  const source =
    window === undefined
      ? sql`SELECT * FROM streamed_totals`
      : window.from !== null
        ? aggregate
        : sql`SELECT video_id, recording_key, counted_plays, listened_ms,
      counted_listened_ms, last_played_at, last_counted_at FROM streamed_totals
      WHERE last_played_at <= ${window.to}
    UNION ALL ${aggregate}`;
  // Settled, the kept totals know the Library song each streamed song is now.
  const track =
    window === undefined && keptTotalsSettled(db)
      ? sql`(SELECT song_track FROM played_songs
        WHERE song = 'v:' || streamed.video_id || '|' || streamed.recording_key)`
      : streamedTrack(sql`streamed.video_id`, sql`nullif(streamed.recording_key, '')`);
  return sql`WITH streamed AS (${source})
    SELECT video_id AS "videoId", ${track} AS "trackId",
      counted_plays AS "countedPlays", listened_ms AS "listenedMs", counted_listened_ms AS "countedListenedMs",
      coalesce(last_counted_at, 0) AS "latestPlayAt", last_played_at AS "lastPlayedAt" FROM streamed`;
};

/**
 * The all-time counted plays streamed of each Library song they are now
 * (`streamedTrack`), by its id, from the kept totals: what a Library song's
 * own counted plays leave out.
 */
export const streamedLibraryPlays = (db: LibraryDatabase): Map<number, number> => {
  const plays = new Map<number, number>();
  for (const entry of streamedListeningTotals(db))
    if (entry.trackId !== null && entry.countedPlays > 0)
      plays.set(entry.trackId, (plays.get(entry.trackId) ?? 0) + entry.countedPlays);
  return plays;
};

/** [entry]'s plays as Core's `mergeCountedPlays` sums them, the time over its counted plays. */
const countedSums = (entry: StreamedListeningTotal) => ({
  videoId: entry.videoId,
  trackId: entry.trackId,
  countedPlays: entry.countedPlays,
  listenedMs: entry.countedListenedMs,
  latestPlayAt: entry.latestPlayAt,
});

/** A streamed song's credited [artist] as Stats lists them: their Library row, or an online artist. */
const playedArtist = (
  artist: PlayedArtistKey,
  artistRows: ReadonlyMap<number, ArtistRow>,
): PlayedArtist | undefined =>
  typeof artist.id === "number"
    ? artistRows.get(artist.id)
    : { ...artist, id: artist.id, online: true, thumbPath: null, artworkPath: null };

/**
 * Stats and Home's album/artist totals share one resolution of every streamed
 * song: read from the kept totals (`keptPlayedTotals`), or summed from the
 * history while those still settle.
 */
export const playedEntityTotals = (db: LibraryDatabase, window: StatsWindow): PlayedEntityTotals =>
  finishSteps(playedTotalsSteps(playedTotalsRead(db, window, true)));

/**
 * Each played artist's totals as `playedEntityTotals` counts them, without
 * reading or summing albums: for a reader that needs artists alone.
 */
export const playedArtistTotals = (
  db: LibraryDatabase,
  window: StatsWindow,
): readonly PlayedEntityTotal<PlayedArtist>[] =>
  finishSteps(playedTotalsSteps(playedTotalsRead(db, window, false))).artists;

/**
 * Each album's and artist's totals over [window] summed from the plays, as
 * every read did before the kept totals (#1349); without [withAlbums], no
 * albums. What the kept totals are checked against, and read while they settle.
 */
export const summedPlayedTotals = (
  db: LibraryDatabase,
  window: StatsWindow,
  withAlbums: boolean,
): PlayedEntityTotals => finishSteps(playedTotalsSteps(summedTotalsRows(db, window, withAlbums)));

/**
 * The rows the summed totals are worked out from (`summedPlayedTotals`):
 * statements and their rows only, the working out left to `playedTotalsSteps`.
 */
export interface SummedTotalsRows {
  readonly kept?: undefined;
  readonly withAlbums: boolean;
  /** The Library songs' plays, by album and credited artist. */
  readonly credits: readonly CreditedPlayTotals[];
  /** The streamed songs with counted plays in the window. */
  readonly streams: readonly StreamedListeningTotal[];
  /** What [streams]' songs are made from (`streamedSongsSteps`). */
  readonly songRows: StreamedSongRows;
  /** What the credit resolver matches against: the Library's artists, albums and stored credits. */
  readonly artists: readonly ArtistRow[];
  readonly albums: readonly AlbumRow[];
  readonly creditRows: readonly { readonly credit: string; readonly stored: string | null }[];
  /** Each album and credited artist of the Library songs [streams] count for. */
  readonly links: readonly {
    readonly id: number;
    readonly albumId: number;
    readonly artistId: number;
  }[];
}

/**
 * What `playedTotalsSteps` works the totals out from: the kept totals once
 * they settle, else the rows to sum them from. A read for the read replay
 * (`replayRead`), which callers may share: nothing that reads it changes it.
 */
export type PlayedTotalsRead = { readonly kept: PlayedEntityTotals } | SummedTotalsRows;

/** Each album's and artist's totals over [window] as one read (`PlayedTotalsRead`). */
export const playedTotalsRead = (
  db: LibraryDatabase,
  window: StatsWindow,
  withAlbums: boolean,
): PlayedTotalsRead => {
  const kept = keptPlayedTotals(db, window, withAlbums);
  return kept === null ? summedTotalsRows(db, window, withAlbums) : { kept };
};

const summedTotalsRows = (
  db: LibraryDatabase,
  window: StatsWindow,
  withAlbums: boolean,
): SummedTotalsRows => {
  const credits = summedCreditedPlayTotals(db, window);
  // Statements only, each the same however many plays: a replayed read runs this whole in
  // every pass, so work on the rows waits for `playedTotalsSteps` (#1451). The streams' own
  // statement picks their songs and Library songs, not a list of them made here.
  const counted = sql`SELECT * FROM (${streamedTotalsQuery(db, window)}) WHERE "countedPlays" > 0`;
  const streams = db.all<StreamedListeningTotal>(counted);
  const songRows = streamedSongRows(db, sql`SELECT "videoId" FROM (${counted})`);
  const artists = selectArtists(db, {});
  const albums = withAlbums ? selectAlbums(db, undefined) : [];
  const creditRows = libraryCreditRows(db);
  const links = db.all<{ id: number; albumId: number; artistId: number }>(
    sql`
    SELECT tracks.id, tracks.album_id AS "albumId", track_artists.artist_id AS "artistId"
    FROM tracks JOIN track_artists ON track_artists.track_id = tracks.id
    WHERE tracks.id IN (SELECT "trackId" FROM (${counted}) WHERE "trackId" IS NOT NULL)`,
  );
  return { withAlbums, credits, streams, songRows, artists, albums, creditRows, links };
};

/**
 * The album and artist totals from [read], worked out a step at a time: a
 * step per stored credit, Library row, credited total, streamed song (each
 * resolved on its own step) and ranked entry, so work that runs in slices
 * (the read replay's) never sums the whole history at once. [read] is left as
 * it is, for callers sharing one read.
 */
export function* playedTotalsSteps(read: PlayedTotalsRead): Generator<void, PlayedEntityTotals> {
  if (read.kept !== undefined) return read.kept;
  const { withAlbums } = read;
  const songs = yield* streamedSongsSteps(read.streams, read.songRows);
  const credits: string[] = [];
  for (const { credit, stored } of read.creditRows) {
    credits.push(...readCredits(credit, stored));
    yield;
  }
  const library = yield* streamedCreditResolverSteps({
    artists: read.artists,
    albums: read.albums,
    credits,
    releases: songs.values(),
  });
  const artists = new Map<number | string, PlayedEntityTotal<PlayedArtist>>();
  const albums = new Map<number | string, PlayedEntityTotal<PlayedAlbum>>();
  const artistRows = new Map<number, ArtistRow>();
  for (const row of read.artists) {
    artistRows.set(row.id, row);
    yield;
  }
  const albumRows = new Map<number, AlbumRow>();
  for (const row of read.albums) {
    albumRows.set(row.id, row);
    yield;
  }
  const add = <A extends { readonly id: number | string }>(
    entries: Map<number | string, PlayedEntityTotal<A>>,
    item: A | undefined,
    key: string,
    totals: Pick<EntityPlayTotals, "countedPlays" | "listenedMs" | "latestPlayAt">,
  ) => {
    if (item === undefined) return;
    const previous = entries.get(item.id);
    entries.set(item.id, {
      ...totals,
      id: item.id,
      item,
      sortKey: key,
      countedPlays: (previous?.countedPlays ?? 0) + totals.countedPlays,
      listenedMs: (previous?.listenedMs ?? 0) + totals.listenedMs,
      latestPlayAt: Math.max(previous?.latestPlayAt ?? 0, totals.latestPlayAt),
    });
  };
  if (withAlbums) {
    const albumTotals = yield* albumPlayTotalsSteps(read.credits);
    for (const totals of albumTotals) {
      add(albums, albumRows.get(totals.id), totals.sortKey, totals);
      yield;
    }
  }
  const artistTotals = yield* artistPlayTotalsSteps(read.credits);
  for (const totals of artistTotals) {
    add(artists, artistRows.get(totals.id), totals.sortKey, totals);
    yield;
  }
  // Each song's streamed plays: a Library song's credit its artists and album, the rest as resolved.
  const streamed: ReturnType<typeof countedSums>[] = [];
  for (const entry of read.streams) {
    streamed.push(countedSums(entry));
    yield;
  }
  const merged = yield* mergeCountedPlaysSteps({ streamed });
  const downloaded = new Map<number, { albumId: number; artistId: number }[]>();
  for (const row of read.links) {
    const links = downloaded.get(row.id) ?? [];
    links.push(row);
    downloaded.set(row.id, links);
    yield;
  }
  for (const [trackId, totals] of merged.library) {
    const links = downloaded.get(trackId) ?? [];
    for (const link of links) {
      const artist = artistRows.get(link.artistId);
      add(artists, artist, artist?.sort ?? "", totals);
    }
    const album = links[0] === undefined ? undefined : albumRows.get(links[0].albumId);
    if (withAlbums) add(albums, album, album?.titleSort ?? "", totals);
    yield;
  }
  for (const [videoId, totals] of merged.online) {
    const song = songs.get(videoId);
    if (song === undefined) continue;
    const resolved = library.resolve(song);
    for (const artist of resolved.artists)
      add(artists, playedArtist(artist, artistRows), sortKey(artist.name), totals);
    const album = resolved.album;
    if (withAlbums && album !== null)
      add(
        albums,
        typeof album.id === "number"
          ? albumRows.get(album.id)
          : { ...album, id: album.id, online: true, albumArtist: album.artists.join(", ") },
        sortKey(album.title),
        totals,
      );
    yield;
  }
  return {
    albums: yield* rankEntityPlaysSteps([...albums.values()], Infinity),
    artists: yield* rankEntityPlaysSteps([...artists.values()], Infinity),
  };
}

/**
 * What the owner keeps, for Core's `followSuggestions` to rank a light
 * listener's suggestions by: every Library song with the artists its credit
 * names, then each playlist's songs (`t:<track id>`, or `yt:<video id>` for a
 * YT Music entry the Library has no song of, credited as a streamed song is),
 * and Favorites as one more playlist. A YT Music entry is the Library song its
 * video id is now (`streamedTrack`), so a playlist holding both counts it once.
 * Deleted playlists and entries are left out.
 */
export const keptArtistSongs = (db: LibraryDatabase): KeptSongs<PlayedArtist> => {
  const library = playedLibrary(db, [], false);
  const artistRows = new Map(library.artists.map((row) => [row.id, row]));
  const trackArtists = new Map<number, KeptSong<PlayedArtist>["artists"][number][]>();
  for (const link of db.all<{ trackId: number; artistId: number }>(
    sql`SELECT track_id AS "trackId", artist_id AS "artistId" FROM track_artists
      ORDER BY track_id, position`,
  )) {
    const artist = artistRows.get(link.artistId);
    if (artist === undefined) continue;
    const artists = trackArtists.get(link.trackId) ?? [];
    artists.push({ name: artist.name, item: artist });
    trackArtists.set(link.trackId, artists);
  }
  const track = (trackId: number): KeptSong<PlayedArtist> => ({
    id: `t:${trackId}`,
    artists: trackArtists.get(trackId) ?? [],
  });
  const streamed = (stored: string): KeptSong<PlayedArtist> | null => {
    const song = readPlaylistYtSong(stored);
    if (song === null) return null;
    return {
      id: `yt:${song.videoId}`,
      artists: library.resolve(song).artists.flatMap((artist) => {
        const item = playedArtist(artist, artistRows);
        return item === undefined ? [] : [{ name: artist.name, item }];
      }),
    };
  };
  const playlists = new Map<number, KeptSong<PlayedArtist>[]>();
  for (const entry of db.all<{ playlistId: number; trackId: number | null; ytSong: string | null }>(
    sql`SELECT playlist_items.playlist_id AS "playlistId",
      coalesce(playlist_items.track_id,
        ${streamedTrack(schema.videoIdIn(schema.playlistItems.ytSong), sql`NULL`)}) AS "trackId",
      playlist_items.yt_song AS "ytSong"
    FROM playlist_items JOIN playlists ON playlists.id = playlist_items.playlist_id
    WHERE NOT playlist_items.deleted AND NOT playlists.deleted`,
  )) {
    const song =
      entry.trackId !== null
        ? track(entry.trackId)
        : entry.ytSong === null
          ? null
          : streamed(entry.ytSong);
    if (song === null) continue;
    const songs = playlists.get(entry.playlistId) ?? [];
    songs.push(song);
    playlists.set(entry.playlistId, songs);
  }
  const favorites = db
    .all<{ trackId: number }>(sql`SELECT track_id AS "trackId" FROM favorites WHERE NOT deleted`)
    .map((row) => track(row.trackId));
  return {
    library: [...trackArtists.keys()].map(track),
    playlists: [...playlists.values(), favorites],
  };
};

/**
 * Home's Recently played resolves this many streamed songs per album it
 * shows, then this many times more until they settle the shelf.
 */
const STREAM_PAGE_GROWTH = 4;

interface StreamedAlbum {
  readonly entry: StreamedListeningTotal;
  readonly album: number | OnlineAlbum;
}

/**
 * Each of [streams] with its album: a downloaded song's is its file's album ([trackAlbums]), any
 * other's what [credited] gives it (none leaves it out).
 */
const albumsOfStreams = (
  streams: readonly StreamedListeningTotal[],
  trackAlbums: ReadonlyMap<number, number>,
  credited: (entry: StreamedListeningTotal) => StreamedAlbum[],
): StreamedAlbum[] =>
  streams.flatMap((entry): StreamedAlbum[] => {
    const downloaded = entry.trackId === null ? undefined : trackAlbums.get(entry.trackId);
    return downloaded === undefined ? credited(entry) : [{ entry, album: downloaded }];
  });

/**
 * The album of each of [streams] it has one for: a downloaded song's Library
 * album (its id), or the album its credits name (a Library album's id or an
 * online album). [resolver] gives the credit resolver, knowing every streamed
 * song's release id when asked with `true`, for a song that names its album
 * without one.
 */
const streamedAlbums = (
  db: LibraryDatabase,
  streams: readonly StreamedListeningTotal[],
  resolver: (releases: boolean) => ReturnType<typeof playedLibrary>["resolve"],
): StreamedAlbum[] => {
  const tracks = [
    ...new Set(streams.flatMap((entry) => (entry.trackId === null ? [] : [entry.trackId]))),
  ];
  const trackAlbums = new Map(
    tracks.length === 0
      ? []
      : db
          .all<{ id: number; albumId: number }>(
            sql`
    SELECT id, album_id AS "albumId" FROM tracks WHERE id IN
      (SELECT value FROM json_each(${JSON.stringify(tracks)}))`,
          )
          .map((row) => [row.id, row.albumId]),
  );
  // A downloaded song goes by its file's album; credits only settle the others.
  const credited = streams.filter(
    (entry) => entry.trackId === null || !trackAlbums.has(entry.trackId),
  );
  if (keptTotalsSettled(db)) return keptStreamedAlbums(db, streams, trackAlbums, credited);
  const songs = streamedSongsOf(
    db,
    credited.map((entry) => entry.videoId),
  );
  const resolve =
    credited.length === 0
      ? undefined
      : resolver([...songs.values()].some((song) => song.albumId == null && song.album !== null));
  return albumsOfStreams(streams, trackAlbums, (entry) => {
    const song = songs.get(entry.videoId);
    const resolved = song === undefined || resolve === undefined ? null : resolve(song).album;
    if (resolved === null) return [];
    if (typeof resolved.id === "string") {
      const album = { ...resolved, id: resolved.id, online: true as const };
      return [{ entry, album: { ...album, albumArtist: resolved.artists.join(", ") } }];
    }
    // A Library song whose file wasn't found only takes an online album.
    return entry.trackId === null ? [{ entry, album: resolved.id }] : [];
  });
};

/**
 * `streamedAlbums` from the kept credits (#1349): each streamed song's album
 * as Core credited it when it was settled, an online one named by its latest
 * played song, without building Core's resolver from the whole Library.
 */
const keptStreamedAlbums = (
  db: LibraryDatabase,
  streams: readonly StreamedListeningTotal[],
  trackAlbums: ReadonlyMap<number, number>,
  credited: readonly StreamedListeningTotal[],
): StreamedAlbum[] => {
  const albums = new Map<string, number | OnlineAlbum>();
  if (credited.length > 0)
    for (const row of db.all<{ videoId: string; entity: string; item: string | null }>(sql`
      SELECT played_songs.video_id AS "videoId", play_credits.entity, played_entities.item
      FROM played_songs
      JOIN play_credits ON play_credits.song = played_songs.song AND play_credits.kind = 'album'
      LEFT JOIN played_entities ON played_entities.kind = 'album'
        AND played_entities.entity = play_credits.entity
      WHERE played_songs.song_track IS NULL AND played_songs.video_id IN
        (SELECT value FROM json_each(${JSON.stringify(credited.map((entry) => entry.videoId))}))`))
      albums.set(
        row.videoId,
        /^\d+$/u.test(row.entity) ? Number(row.entity) : (JSON.parse(row.item!) as OnlineAlbum),
      );
  return albumsOfStreams(streams, trackAlbums, (entry) => {
    const album = entry.trackId === null ? albums.get(entry.videoId) : undefined;
    return album === undefined ? [] : [{ entry, album }];
  });
};

/**
 * Merge the already-settled Library shelf [local] with the albums of the
 * songs streamed ([streams]), counted or not, as Core's `recentlyPlayedAlbums`
 * orders them. Only the latest streamed songs are resolved, a page at a time,
 * until they settle the shelf; an online album shows its latest played song's details.
 */
export const recentlyPlayedEntities = (
  db: LibraryDatabase,
  local: readonly AlbumRow[],
  limit: number,
  streams: readonly StreamedListeningTotal[],
): PlayedAlbum[] => {
  if (streams.length === 0) return [...local];
  const rows = new Map<number | string, PlayedAlbum>(local.map((album) => [album.id, album]));
  const latest = db.all<{ albumId: number | string; lastPlayedAt: number }>(sql`
    SELECT tracks.album_id AS "albumId", max(play_totals.last_played_at) AS "lastPlayedAt"
    FROM tracks JOIN play_totals ON play_totals.track_id = tracks.id
    WHERE tracks.album_id IN (${sql.join([sql`NULL`, ...local.map((album) => sql`${album.id}`)], sql`, `)})
    GROUP BY tracks.album_id`);
  // Latest played first; on a tie, the totals written last.
  const newest = streams
    .map((entry, index) => ({ entry, index }))
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    .sort((a, b) => b.entry.lastPlayedAt - a.entry.lastPlayedAt || b.index - a.index)
    .map(({ entry }) => entry);
  let library:
    | { readonly releases: boolean; readonly resolve: ReturnType<typeof playedLibrary>["resolve"] }
    | undefined;
  const resolver = (releases: boolean) => {
    if (library === undefined || (releases && !library.releases))
      library = {
        releases,
        // A song without its release id takes the one another streamed song of its album has.
        resolve: playedLibrary(
          db,
          releases
            ? streamedSongsOf(
                db,
                streams.map((entry) => entry.videoId),
              ).values()
            : [],
        ).resolve,
      };
    return library.resolve;
  };
  for (let read = 0, page = limit * STREAM_PAGE_GROWTH; ; page *= STREAM_PAGE_GROWTH) {
    const albums = streamedAlbums(db, newest.slice(read, page), resolver);
    read = Math.min(page, newest.length);
    const missing = [
      ...new Set(
        albums.flatMap(({ album }) =>
          typeof album === "number" && !rows.has(album) ? [album] : [],
        ),
      ),
    ];
    if (missing.length > 0)
      for (const row of selectAlbums(
        db,
        sql`${schema.albums.id} IN (SELECT value FROM json_each(${JSON.stringify(missing)}))`,
      ))
        rows.set(row.id, row);
    for (const { entry, album } of albums) {
      const id = typeof album === "number" ? album : album.id;
      // Songs come latest played first: the first one met gives an online album's details.
      if (typeof album !== "number" && !rows.has(id)) rows.set(id, album);
      if (rows.has(id)) latest.push({ albumId: id, lastPlayedAt: entry.lastPlayedAt });
    }
    const complete = read === newest.length;
    // Songs not resolved yet were played at or before the last one resolved.
    const boundary = complete ? -Infinity : newest[read - 1]!.lastPlayedAt;
    const settling = latest
      .filter((song) => song.lastPlayedAt >= boundary)
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
      .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
    const ids = recentlyPlayedAlbums(settling, limit, complete);
    if (ids !== null) return ids.flatMap((id) => rows.get(id) ?? []);
  }
};

export interface PlayedArtistSongs extends ArtistPlays {
  readonly streamedListening: NonNullable<ArtistStatsInput["streamedListening"]>;
  readonly streamedSongPlays: readonly SongPlayTotals[];
}

/**
 * Keep the artist's indexed Library read; add per-video summaries without
 * scanning their events. The all-time streamed totals are the plays up to
 * [now] as well, unless one started after [now] (a phone whose clock ran ahead).
 */
export const playedArtistSongs = (
  db: LibraryDatabase,
  artistId: number,
  now: number,
): PlayedArtistSongs => {
  const base = artistPlays(db, artistId, now);
  const streams = streamedListeningTotals(db);
  if (streams.length === 0) return { ...base, streamedListening: [], streamedSongPlays: [] };
  const library = playedLibrary(db);
  const ids = new Set(base.songIds);
  const songs = streamedSongsOf(
    db,
    streams.map((entry) => entry.videoId),
  );
  const credited = (entry: StreamedListeningTotal): boolean => {
    if (entry.trackId !== null) return ids.has(entry.trackId);
    const song = songs.get(entry.videoId);
    return (
      song !== undefined && library.resolve(song).artists.some((artist) => artist.id === artistId)
    );
  };
  const theirs = streams.filter(credited);
  const upToNow = theirs.some((entry) => entry.lastPlayedAt > now)
    ? streamedListeningTotals(db, { from: null, to: now }).filter(credited)
    : theirs;
  // Listening sums every play's time and takes the latest play, skipped ones included.
  const listened = mergeCountedPlays({
    library: base.listening.map((song) => ({
      id: song.trackId,
      countedPlays: song.countedPlays,
      listenedMs: song.listenedMs,
      latestPlayAt: song.lastPlayedAt,
    })),
    streamed: theirs.map((entry) => ({
      videoId: entry.videoId,
      trackId: entry.trackId,
      countedPlays: entry.countedPlays,
      listenedMs: entry.listenedMs,
      latestPlayAt: entry.lastPlayedAt,
    })),
  });
  const played = mergeCountedPlays({
    library: base.songPlays,
    streamed: upToNow.filter((entry) => entry.countedPlays > 0).map(countedSums),
  });
  const ownListening = new Map(base.listening.map((song) => [song.trackId, song]));
  const ownPlays = new Map(base.songPlays.map((song) => [song.id, song]));
  const titles = new Map(
    db
      .all<{ id: number; titleSort: string }>(
        sql`
    SELECT id, title_sort AS "titleSort" FROM tracks WHERE id IN
      (SELECT value FROM json_each(${JSON.stringify([...played.library.keys()].filter((id) => !ownPlays.has(id)))}))`,
      )
      .map((row) => [row.id, row.titleSort]),
  );
  const listening = (trackId: number, sums: PlaySums): SongListening => {
    const own = ownListening.get(trackId);
    return {
      trackId,
      artistIds: own?.artistIds ?? [artistId],
      inLibrary: own?.inLibrary ?? true,
      countedPlays: sums.countedPlays,
      listenedMs: sums.listenedMs,
      lastPlayedAt: sums.latestPlayAt,
    };
  };
  return {
    ...base,
    listening: [...listened.library].map(([trackId, sums]) => listening(trackId, sums)),
    songPlays: [...played.library].map(([id, sums]) => ({
      id,
      sortKey: ownPlays.get(id)?.sortKey ?? titles.get(id) ?? "",
      ...sums,
    })),
    streamedListening: [...listened.online.values()].map((sums) => ({
      countedPlays: sums.countedPlays,
      listenedMs: sums.listenedMs,
      lastPlayedAt: sums.latestPlayAt,
    })),
    streamedSongPlays: [...played.online].map(([videoId, sums]) => ({
      song: { kind: "yt" as const, videoId },
      sortKey: sortKey(songs.get(videoId)?.title ?? ""),
      ...sums,
    })),
  };
};

/** Each of [ids]' current credits, by song id, in credit order. */
const songArtists = (db: LibraryDatabase, ids: Iterable<number>): Map<number, number[]> => {
  const artists = new Map<number, number[]>();
  for (const row of db.all<{ trackId: number; artistId: number }>(sql`
    SELECT track_id AS "trackId", artist_id AS "artistId" FROM track_artists
    WHERE track_id IN (SELECT value FROM json_each(${JSON.stringify([...new Set(ids)])}))
    ORDER BY track_id, position`)) {
    const links = artists.get(row.trackId) ?? [];
    links.push(row.artistId);
    artists.set(row.trackId, links);
  }
  return artists;
};

/**
 * When each of the artists [ids] (a Library artist's id, or an online one's)
 * had their first counted play ever, streamed plays included, credited as
 * `playedEntityTotals` credits them; an artist never played isn't listed.
 * Reads each streamed video's first play through the play events' video index.
 */
export const playedArtistFirstPlays = (
  db: LibraryDatabase,
  ids: readonly (number | string)[],
): ArtistFirstPlay[] => {
  const wanted = new Set(ids);
  const firsts = new Map<number | string, number>();
  const played = (id: number | string, at: number) => {
    const first = firsts.get(id);
    if (wanted.has(id) && (first === undefined || at < first)) firsts.set(id, at);
  };
  const library = ids.filter((id): id is number => typeof id === "number");
  for (const first of library.length === 0 ? [] : artistFirstPlays(db, library))
    played(first.id, first.firstPlayAt);
  const streams = db.all<{ videoId: string; trackId: number | null; firstPlayAt: number }>(sql`
    WITH firsts AS (
      SELECT kept.video_id, kept.recording_key,
        (SELECT min(play_events.started_at) FROM play_events
          WHERE play_events.video_id = kept.video_id AND play_events.counted
            AND coalesce(play_events.recording_key, '') = kept.recording_key) AS first
      FROM streamed_totals AS kept WHERE kept.counted_plays > 0
    )
    SELECT video_id AS "videoId", first AS "firstPlayAt",
      ${streamedTrack(sql`firsts.video_id`, sql`nullif(firsts.recording_key, '')`)} AS "trackId"
    FROM firsts`);
  if (streams.length === 0) return [...firsts].map(([id, firstPlayAt]) => ({ id, firstPlayAt }));
  const downloaded = songArtists(
    db,
    streams.flatMap((entry) => (entry.trackId === null ? [] : [entry.trackId])),
  );
  const songs = streamedSongsOf(
    db,
    streams.flatMap((entry) => (entry.trackId === null ? [entry.videoId] : [])),
  );
  const resolve = playedLibrary(db, songs.values()).resolve;
  for (const entry of streams) {
    if (entry.trackId !== null) {
      for (const artist of downloaded.get(entry.trackId) ?? []) played(artist, entry.firstPlayAt);
      continue;
    }
    const song = songs.get(entry.videoId);
    if (song === undefined) continue;
    for (const artist of resolve(song).artists) played(artist.id, entry.firstPlayAt);
  }
  return [...firsts].map(([id, firstPlayAt]) => ({ id, firstPlayAt }));
};

/**
 * What a Recap of [window] is computed from (Core's `recap`), streamed plays
 * included and credited as Stats credits them: each song's counted plays (a
 * Library song by its id, a streamed song the Library hasn't by its video
 * id), each album's and artist's (their rows with them), the genres of the
 * Library's songs and known streamed songs, and the artists' first plays.
 */
export interface RecapPlays {
  readonly songs: readonly EntityPlayTotals[];
  readonly artists: readonly PlayedEntityTotal<PlayedArtist>[];
  readonly albums: readonly PlayedEntityTotal<PlayedAlbum>[];
  readonly songGenres: readonly RecapSongGenre[];
  readonly artistFirstPlays: readonly ArtistFirstPlay[];
}

export const recapPlays = (
  db: LibraryDatabase,
  window: StatsWindow,
  includeStreamedGenres = true,
): RecapPlays => {
  const songs = songPlayTotals(db, window).map(({ song, ...totals }) => ({
    ...totals,
    id: song.kind === "library" ? song.id : song.videoId,
  }));
  const { albums, artists } = playedEntityTotals(db, window);
  const genreIds = countedGenreSongIds(songs);
  return {
    songs,
    artists,
    albums,
    songGenres: songGenres(db, genreIds, includeStreamedGenres),
    artistFirstPlays:
      artists.length === 0
        ? []
        : playedArtistFirstPlays(
            db,
            artists.map((artist) => artist.id),
          ),
  };
};
