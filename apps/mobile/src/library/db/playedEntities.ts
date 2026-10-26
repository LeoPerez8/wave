import {
  albumPlayTotals,
  artistPlayTotals,
  rankEntityPlays,
  recentlyPlayedAlbums,
  sortKey,
  streamedCredits,
  type ArtistFirstPlay,
  type ArtistStatsInput,
  type EntityPlayTotals,
  type PlayedAlbumKey,
  type PlayedArtistKey,
  type PlayTotals,
  type RecapSongGenre,
  type SongListening,
  type SongPlayTotals,
  type StatsWindow,
  type YtAlbumSong,
} from "@wave/core";
import { sql } from "drizzle-orm";

import type { AlbumRow, ArtistRow } from "../LibraryStore.ts";
import { selectAlbums } from "./albums.ts";
import * as schema from "./schema.ts";
import { selectArtists } from "./artists.ts";
import { readCredits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import {
  artistFirstPlays,
  artistPlays,
  creditedPlayTotals,
  songGenres,
  songPlayTotals,
  streamedTrack,
  type ArtistPlays,
} from "./stats.ts";
import { streamedSongsOf } from "./streamedSongs.ts";

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
): StreamedListeningTotal[] => {
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
  return db.all<StreamedListeningTotal>(sql`WITH streamed AS (${source})
    SELECT video_id AS "videoId", ${streamedTrack(sql`streamed.video_id`, sql`nullif(streamed.recording_key, '')`)} AS "trackId",
      counted_plays AS "countedPlays", listened_ms AS "listenedMs", counted_listened_ms AS "countedListenedMs",
      coalesce(last_counted_at, 0) AS "latestPlayAt", last_played_at AS "lastPlayedAt" FROM streamed`);
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

/** Metadata needed by Core's credit resolver, without reading play history. */
const playedLibrary = (db: LibraryDatabase, releases: Iterable<YtAlbumSong> = []) => {
  const artists = selectArtists(db, {});
  const albums = selectAlbums(db, undefined);
  const credits = db
    .all<{ credit: string; stored: string | null }>(
      sql`
    SELECT DISTINCT artist_credit AS credit, artist_credits AS stored FROM tracks
    UNION SELECT album_artist_credit, album_artist_credits FROM albums`,
    )
    .flatMap(({ credit, stored }) => readCredits(credit, stored));
  return { artists, albums, resolve: streamedCredits({ artists, albums, credits, releases }) };
};

/** Stats and Home's album/artist totals share one resolution of every streamed song. */
export const playedEntityTotals = (
  db: LibraryDatabase,
  window: StatsWindow,
): PlayedEntityTotals => {
  const credits = creditedPlayTotals(db, window);
  const streams = streamedListeningTotals(db, window).filter((entry) => entry.countedPlays > 0);
  const songs = streamedSongsOf(
    db,
    streams.map((entry) => entry.videoId),
  );
  const library = playedLibrary(db, songs.values());
  const artists = new Map<number | string, PlayedEntityTotal<PlayedArtist>>();
  const albums = new Map<number | string, PlayedEntityTotal<PlayedAlbum>>();
  const artistRows = new Map(library.artists.map((row) => [row.id, row]));
  const albumRows = new Map(library.albums.map((row) => [row.id, row]));
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
  for (const totals of albumPlayTotals(credits))
    add(albums, albumRows.get(totals.id), totals.sortKey, totals);
  for (const totals of artistPlayTotals(credits))
    add(artists, artistRows.get(totals.id), totals.sortKey, totals);
  const downloaded = new Map<number, { albumId: number; artistId: number }[]>();
  for (const row of db.all<{ id: number; albumId: number; artistId: number }>(
    sql`
    SELECT tracks.id, tracks.album_id AS "albumId", track_artists.artist_id AS "artistId"
    FROM tracks JOIN track_artists ON track_artists.track_id = tracks.id
    WHERE tracks.id IN (SELECT value FROM json_each(${JSON.stringify([...new Set(streams.flatMap((entry) => (entry.trackId === null ? [] : [entry.trackId])))])}))`,
  )) {
    const links = downloaded.get(row.id) ?? [];
    links.push(row);
    downloaded.set(row.id, links);
  }
  for (const entry of streams) {
    const totals = { ...entry, listenedMs: entry.countedListenedMs };
    if (entry.trackId !== null) {
      const links = downloaded.get(entry.trackId) ?? [];
      for (const link of links) {
        const artist = artistRows.get(link.artistId);
        add(artists, artist, artist?.sort ?? "", totals);
      }
      const album = links[0] === undefined ? undefined : albumRows.get(links[0].albumId);
      add(albums, album, album?.titleSort ?? "", totals);
      continue;
    }
    const song = songs.get(entry.videoId);
    if (song === undefined) continue;
    const resolved = library.resolve(song);
    for (const artist of resolved.artists) {
      const item =
        typeof artist.id === "number"
          ? artistRows.get(artist.id)
          : { ...artist, id: artist.id, online: true as const, thumbPath: null, artworkPath: null };
      add(artists, item, sortKey(artist.name), totals);
    }
    const album = resolved.album;
    if (album !== null)
      add(
        albums,
        typeof album.id === "number"
          ? albumRows.get(album.id)
          : { ...album, id: album.id, online: true, albumArtist: album.artists.join(", ") },
        sortKey(album.title),
        totals,
      );
  }
  return {
    albums: rankEntityPlays([...albums.values()], Infinity),
    artists: rankEntityPlays([...artists.values()], Infinity),
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
  const songs = streamedSongsOf(
    db,
    credited.map((entry) => entry.videoId),
  );
  const resolve =
    credited.length === 0
      ? undefined
      : resolver([...songs.values()].some((song) => song.albumId == null && song.album !== null));
  return streams.flatMap((entry): StreamedAlbum[] => {
    const downloaded = entry.trackId === null ? undefined : trackAlbums.get(entry.trackId);
    if (downloaded !== undefined) return [{ entry, album: downloaded }];
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

/** Keep the artist's indexed Library read; add per-video summaries without scanning their events. */
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
  const listening = new Map<number, SongListening>(
    base.listening.map((song) => [song.trackId, song]),
  );
  const played = new Map<number, PlayTotals>(base.songPlays.map((song) => [song.id, song]));
  const streamedListening: StreamedListeningTotal[] = [];
  const online = new Set<string>();
  const credited = (entry: StreamedListeningTotal): boolean => {
    if (entry.trackId !== null) return ids.has(entry.trackId);
    const song = songs.get(entry.videoId);
    return (
      song !== undefined && library.resolve(song).artists.some((artist) => artist.id === artistId)
    );
  };
  for (const entry of streams) {
    if (!credited(entry)) continue;
    if (entry.trackId === null) {
      streamedListening.push(entry);
      online.add(entry.videoId);
      continue;
    }
    const previous = listening.get(entry.trackId);
    listening.set(entry.trackId, {
      trackId: entry.trackId,
      artistIds: previous?.artistIds ?? [artistId],
      inLibrary: true,
      countedPlays: (previous?.countedPlays ?? 0) + entry.countedPlays,
      listenedMs: (previous?.listenedMs ?? 0) + entry.listenedMs,
      lastPlayedAt: Math.max(previous?.lastPlayedAt ?? 0, entry.lastPlayedAt),
    });
  }
  const titles = new Map(
    db
      .all<{ id: number; titleSort: string }>(
        sql`
    SELECT id, title_sort AS "titleSort" FROM tracks WHERE id IN
      (SELECT value FROM json_each(${JSON.stringify([...new Set(streams.flatMap((entry) => (entry.trackId !== null && ids.has(entry.trackId) ? [entry.trackId] : [])))])}))`,
      )
      .map((row) => [row.id, row.titleSort]),
  );
  const streamedSongPlays = new Map<string, SongPlayTotals>();
  for (const entry of streamedListeningTotals(db, { from: null, to: now })) {
    if (entry.countedPlays === 0 || !credited(entry)) continue;
    if (entry.trackId === null) {
      if (!online.has(entry.videoId)) continue;
      const previous = streamedSongPlays.get(entry.videoId);
      streamedSongPlays.set(entry.videoId, {
        song: { kind: "yt", videoId: entry.videoId },
        sortKey: sortKey(songs.get(entry.videoId)?.title ?? ""),
        countedPlays: (previous?.countedPlays ?? 0) + entry.countedPlays,
        listenedMs: (previous?.listenedMs ?? 0) + entry.countedListenedMs,
        latestPlayAt: Math.max(previous?.latestPlayAt ?? 0, entry.latestPlayAt),
      });
    } else {
      const previous = played.get(entry.trackId);
      played.set(entry.trackId, {
        id: entry.trackId,
        sortKey: titles.get(entry.trackId) ?? "",
        countedPlays: (previous?.countedPlays ?? 0) + entry.countedPlays,
        listenedMs: (previous?.listenedMs ?? 0) + entry.countedListenedMs,
        latestPlayAt: Math.max(previous?.latestPlayAt ?? 0, entry.latestPlayAt),
      });
    }
  }
  return {
    ...base,
    listening: [...listening.values()],
    songPlays: [...played.values()],
    streamedListening,
    streamedSongPlays: [...streamedSongPlays.values()],
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
 * Library's songs (a streamed song's isn't known), and the artists' first plays.
 */
export interface RecapPlays {
  readonly songs: readonly EntityPlayTotals[];
  readonly artists: readonly PlayedEntityTotal<PlayedArtist>[];
  readonly albums: readonly PlayedEntityTotal<PlayedAlbum>[];
  readonly songGenres: readonly RecapSongGenre[];
  readonly artistFirstPlays: readonly ArtistFirstPlay[];
}

export const recapPlays = (db: LibraryDatabase, window: StatsWindow): RecapPlays => {
  const songs = songPlayTotals(db, window).map(({ song, ...totals }) => ({
    ...totals,
    id: song.kind === "library" ? song.id : song.videoId,
  }));
  const { albums, artists } = playedEntityTotals(db, window);
  const library = songs.flatMap((entry) =>
    typeof entry.id === "number" && entry.countedPlays > 0 ? [entry.id] : [],
  );
  return {
    songs,
    artists,
    albums,
    songGenres: library.length === 0 ? [] : songGenres(db, library),
    artistFirstPlays:
      artists.length === 0
        ? []
        : playedArtistFirstPlays(
            db,
            artists.map((artist) => artist.id),
          ),
  };
};
